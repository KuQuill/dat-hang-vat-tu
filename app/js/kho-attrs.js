// Thuộc tính vật tư dùng để lọc / sắp xếp / báo cáo kho: độ dày, phân loại, mã phủ, họ vật liệu (tô màu).
// Ưu tiên giá trị đã khai báo (cột thickness / kind / coat_code); để trống thì tự đoán từ tên + quy cách,
// vd "MDF 17MM PHỦ MELAMINE 2 MẶT 104" → dày 17 · Melamine 2 mặt.

// Họ vật liệu → màu đánh dấu dòng (giống bảng kho xưởng)
export const FAMS = [
  ['mel', 'Melamine', '#3b82f6'], ['lam', 'Laminate', '#16a34a'], ['ven', 'Veneer', '#d97706'], ['men', 'Phủ men', '#8b5cf6'],
  ['pvc', 'Phủ film PVC', '#0d9488'], ['tho', 'Ván thô / thường', '#8a8a78'], ['go', 'Gỗ tự nhiên', '#a0672d'],
];
const FAM_OF_KIND = [[/^melamine/i, 'mel'], [/^laminate/i, 'lam'], [/^veneer/i, 'ven'], [/^phủ men/i, 'men'], [/^phủ film|pvc/i, 'pvc'], [/^ván (thô|thường)/i, 'tho'], [/^gỗ/i, 'go']];

const BOARD = /mdf|hdf|plywood|ván|pitech|okal|mfc|gỗ ghép|ghép/iu;
const T_UNIT = /(?<![\p{L}\d\-/.,])(\d+(?:[.,]\d+)?)\s*(?:mm|ly|li|zem)(?![\p{L}])/iu;          // 17mm, 12 ly, 0.8mm (không nhận "MS-503MM")
const T_M = /(?<![\p{L}\d\-/.,x×*])(\d{1,2}(?:[.,]5)?)\s?M(?![\p{L}\d])/u;                       // "PLYWOOD 12M" (M hoa)
const T_m = /(?<![\p{L}\d\-/.,x×*])(\d{1,2}(?:[.,]5)?)\s?m(?![\p{L}\d²³])/iu;                    // "pitech 12m" (chỉ với ván)
function guessThk(s) {
  let m = T_UNIT.exec(s); if (m) return m[1].replace(',', '.');
  const board = BOARD.test(s);
  for (const re of board ? [T_M, T_m] : [T_M]) {
    const all = [...s.matchAll(new RegExp(re.source, re.flags + 'g'))].map(x => parseFloat(x[1].replace(',', '.'))).filter(v => v >= 2 && v <= 40);
    if (all.length) return String(all[0]);
  }
  return '';
}
function guessKind(s) {
  let k = '';
  const board = BOARD.test(s);
  if (/mela|melamin|(^|[^\p{L}])min([^\p{L}]|$)/iu.test(s)) k = 'Melamine';
  else if (/lamin|lamit|(^|[^\p{L}])LK ?\d/iu.test(s)) k = 'Laminate';
  else if (/vene?n?er/iu.test(s)) k = 'Veneer';
  else if (board && /(^|[^\p{L}])men([^\p{L}]|$)/iu.test(s)) k = 'Phủ men';   // "gạch men" không tính
  else if (board && /film|(^|[^\p{L}])pvc/iu.test(s)) k = 'Phủ film PVC';
  else if (/gỗ ghép|finger/iu.test(s)) return 'Gỗ ghép';
  else if (/gỗ xẻ/iu.test(s)) return 'Gỗ xẻ';
  // ván có ghi "1 mặt / 2M" mà không nói loại phủ: thường là mã melamine (104, 609, VHT360…)
  else if (board && /(?<![\p{L}\d])[12]\s?(?:mặt|M)(?![\p{L}\d])/iu.test(s)) k = 'Melamine';
  else if (board) return 'Ván thô';
  if (!k) return '';
  if (/2\s*mặt/iu.test(s)) return `${k} 2 mặt`;
  const ones = [...s.matchAll(/(?<![\p{L}\d])1\s?(?:mặt|M)(?![\p{L}\d])/giu)].length;
  if (ones >= 2) return `${k} 2 mặt`;
  if (/(?<![\p{L}\d])2\s?M(?![\p{L}\d])/u.test(s)) return `${k} 2 mặt`;
  if (ones === 1) return `${k} 1 mặt`;
  return k;
}
const guessCoat = s => { const m = /(?:^|[^\p{L}])(LK ?\d{3,5}[A-Z0-9]*)/u.exec(s); return m ? m[1].replace(' ', '') : ''; };

const cache = new WeakMap();
export function attrsOf(m) {
  const sig = [m.name, m.spec, m.thickness, m.kind, m.coat_code].join('|');
  const c = cache.get(m); if (c && c.sig === sig) return c;
  const s = `${m.name || ''} ${m.spec || ''}`;
  const thk = (m.thickness || '').trim() || guessThk(s);
  const kind = (m.kind || '').trim() || guessKind(s);
  const coat = (m.coat_code || '').trim() || guessCoat(s);
  const fam = (FAM_OF_KIND.find(([re]) => re.test(kind)) || [])[1] || '';
  const out = { sig, thk, kind, coat, fam, guessed: { thk: !m.thickness && !!thk, kind: !m.kind && !!kind, coat: !m.coat_code && !!coat } };
  cache.set(m, out); return out;
}
