// Đọc file Excel (.xlsx/.xlsm/.xls) ngay trên trình duyệt: giá trị ô (SheetJS) + hình ảnh gắn theo dòng (JSZip).
// Hỗ trợ 2 kiểu ảnh của Excel: ảnh nổi đặt trong ô (Insert → Picture) và ảnh "Place in cell" (Excel 365).
const load = (src, test) => new Promise((res, rej) => {
  if (test()) return res();
  const s = document.createElement('script'); s.src = src; s.onload = res;
  s.onerror = () => { s.remove(); rej(new Error('Không tải được thư viện đọc Excel (kiểm tra mạng)')); };
  document.head.appendChild(s);
});
export const loadXlsxLibs = () => Promise.all([
  load('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', () => window.XLSX),
  load('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', () => window.JSZip),
]);

const xml = s => new DOMParser().parseFromString(s, 'application/xml');
const tags = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
// Đường dẫn tương đối trong gói zip: base "xl/worksheets/sheet1.xml" + "../drawings/drawing1.xml"
function resolve(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/'); parts.pop();
  for (const p of target.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); }
  return parts.join('/');
}
const relsPath = p => { const a = p.split('/'); const f = a.pop(); return [...a, '_rels', f + '.rels'].join('/'); };
async function rels(zip, part) {
  const f = zip.file(relsPath(part)); if (!f) return {};
  const out = {};
  for (const r of tags(xml(await f.async('string')), 'Relationship')) out[r.getAttribute('Id')] = { target: resolve(part, r.getAttribute('Target')), type: r.getAttribute('Type') || '' };
  return out;
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff' };
async function media(zip, path) {
  const f = zip.file(path); if (!f) return null;
  const ext = path.split('.').pop().toLowerCase(); if (!MIME[ext]) return null; // bỏ qua emf/wmf (trình duyệt không hiển thị được)
  return new Blob([await f.async('uint8array')], { type: MIME[ext] });
}
const rowOfRef = ref => Number(String(ref).replace(/^[A-Z]+/i, '')) - 1;

// Ảnh "Place in cell": ô có thuộc tính vm → metadata → rich value → richValueRel → media
async function richImages(zip) {
  const meta = zip.file('xl/metadata.xml'), rv = zip.file('xl/richData/rdrichvalue.xml'), rel = zip.file('xl/richData/richValueRel.xml');
  if (!meta || !rv || !rel) return null;
  const md = xml(await meta.async('string'));
  const types = tags(md, 'metadataType').map(t => t.getAttribute('name'));
  const fut = tags(md, 'futureMetadata').find(f => f.getAttribute('name') === 'XLRICHVALUE');
  const futIdx = fut ? tags(fut, 'bk').map(bk => { const r = tags(bk, 'rvb')[0]; return r ? Number(r.getAttribute('i')) : null; }) : [];
  const vmBlock = tags(md, 'valueMetadata')[0];
  const vm = vmBlock ? [...vmBlock.children].map(bk => { const rc = tags(bk, 'rc')[0]; if (!rc) return null;
    return types[Number(rc.getAttribute('t')) - 1] === 'XLRICHVALUE' ? futIdx[Number(rc.getAttribute('v'))] : null; }) : [];
  // cấu trúc rich value: tìm vị trí khoá _rvRel:LocalImageIdentifier
  const stF = zip.file('xl/richData/rdrichvaluestructure.xml');
  const structs = stF ? tags(xml(await stF.async('string')), 's').map(s => tags(s, 'k').findIndex(k => k.getAttribute('n') === '_rvRel:LocalImageIdentifier')) : [];
  const relIdx = tags(xml(await rv.async('string')), 'rv').map(r => { const pos = structs[Number(r.getAttribute('s'))]; const v = tags(r, 'v')[pos >= 0 ? pos : 0]; return v ? Number(v.textContent) : null; });
  const relDoc = xml(await rel.async('string'));
  const relIds = tags(relDoc, 'rel').map(r => r.getAttributeNS(R_NS, 'id') || r.getAttribute('r:id'));
  const rr = await rels(zip, 'xl/richData/richValueRel.xml');
  // vm (1-based) → đường dẫn media
  return i => { const rvI = vm[i - 1]; if (rvI == null) return null; const ri = relIdx[rvI]; if (ri == null) return null; const t = rr[relIds[ri]]; return t ? t.target : null; };
}

// Trả về Map(tên sheet → Map(chỉ số dòng 0-based → Blob ảnh đầu tiên của dòng))
async function readImages(buf) {
  const zip = await window.JSZip.loadAsync(buf);
  const wbF = zip.file('xl/workbook.xml'); if (!wbF) return new Map();
  const wbRels = await rels(zip, 'xl/workbook.xml');
  const rich = await richImages(zip).catch(() => null);
  const out = new Map();
  for (const sh of tags(xml(await wbF.async('string')), 'sheet')) {
    const rid = sh.getAttributeNS(R_NS, 'id') || sh.getAttribute('r:id'); const t = wbRels[rid]; if (!t) continue;
    const sheetF = zip.file(t.target); if (!sheetF) continue;
    const byRow = new Map(); const put = async (row, path) => { if (row < 0 || byRow.has(row) || !path) return; const b = await media(zip, path); if (b) byRow.set(row, b); };
    const sheetXml = await sheetF.async('string');
    if (rich && sheetXml.includes(' vm="')) for (const c of tags(xml(sheetXml), 'c')) { const v = c.getAttribute('vm'); if (v) await put(rowOfRef(c.getAttribute('r')), rich(Number(v))); }
    const sRels = await rels(zip, t.target);
    for (const d of Object.values(sRels).filter(r => /\/drawing$/.test(r.type))) {
      const dF = zip.file(d.target); if (!dF) continue;
      const dXml = xml(await dF.async('string')); const dRels = await rels(zip, d.target);
      for (const a of [...tags(dXml, 'twoCellAnchor'), ...tags(dXml, 'oneCellAnchor')]) {
        const blip = tags(a, 'blip')[0]; if (!blip) continue;
        const emb = blip.getAttributeNS(R_NS, 'embed') || blip.getAttribute('r:embed'); const m = dRels[emb]; if (!m) continue;
        const from = tags(a, 'from')[0], to = tags(a, 'to')[0];
        const fr = from ? Number(tags(from, 'row')[0].textContent) : -1, tr = to ? Number(tags(to, 'row')[0].textContent) : fr;
        await put(Math.floor((fr + tr) / 2), m.target); // ảnh trải 2 dòng → lấy dòng giữa
      }
    }
    out.set(sh.getAttribute('name'), byRow);
  }
  return out;
}

// Đọc toàn bộ workbook: [{ name, rows: mảng 2 chiều (dòng 0 = dòng 1 của Excel), images: Map }]
export async function readWorkbook(file) {
  await loadXlsxLibs();
  const buf = await file.arrayBuffer();
  const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
  let imgs = new Map(), imgErr = null;
  try { imgs = await readImages(buf); } catch (e) { imgErr = /\.xls$/i.test(file.name) ? 'File .xls (Excel 97-2003) không đọc được ảnh — hãy lưu lại thành .xlsx' : 'Không đọc được ảnh trong file'; }
  const sheets = wb.SheetNames.map(name => {
    const ws = wb.Sheets[name]; if (!ws || !ws['!ref']) return { name, rows: [], images: new Map() };
    const rng = window.XLSX.utils.decode_range(ws['!ref']);
    const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true, range: { s: { r: 0, c: 0 }, e: rng.e } })
      .map(r => r.map(v => v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v));
    return { name, rows, images: imgs.get(name) || new Map() };
  }).filter(s => s.rows.length);
  return { sheets, imgErr };
}
