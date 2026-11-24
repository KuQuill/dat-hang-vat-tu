// Xuất PDF phiếu đề nghị cấp vật tư (A4, có ô ký) để ký và gửi lên nhóm
import { S, CONFIG, D, ACT, esc, fmtD, fmtDT, fmtN, siteById, profName, PR_ST, toast, vnDate, allocText, allocCode } from './core.js';

let lib = null;
const loadLib = () => lib || (lib = new Promise((res, rej) => {
  if (window.html2pdf) return res();
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
  s.onload = res; s.onerror = () => { lib = null; rej(new Error('Không tải được thư viện PDF (kiểm tra mạng)')); };
  document.head.appendChild(s);
}));

const cell = 'border:1px solid #444;padding:5px 6px;vertical-align:top;color:#000;background:#fff;text-align:left;font-size:12.5px;';
const head = cell + 'background:#e9ecdd;font-weight:700;';
export function docHTML(pr) {
  const dd = D(); const site = siteById(pr.site_id) || {};
  const wc = (S.workCats || []).find(w => w.code === pr.category);
  const its = S.items.filter(i => i.pr_id === pr.id).sort((a, b) => a.line_no - b.line_no);
  const requester = profName(pr.requested_by);
  const info = [
    ['Dự án / công trường', `${esc(site.code || '')} — ${esc(site.name || '')}`],
    ['Hạng mục thi công', wc ? `${esc(wc.code)} — ${esc(wc.name)}` : esc(pr.category || '')],
    ['Người đề nghị', esc(requester)],
    ['Ngày cần có hàng', `<b>${esc(fmtD(pr.need_date))}</b>`],
    ['Nơi nhận hàng', esc(pr.delivery_place || '')],
    ['Người nhận hàng', `${esc(pr.receiver_name || '')}${pr.receiver_phone ? ' — SĐT: ' + esc(pr.receiver_phone) : ''}`],
  ];
  const hasAlloc = its.some(i => i.alloc && i.alloc.length);
  if (hasAlloc) {
    const by = new Map(); for (const i of its) for (const a of (i.alloc || [])) by.set(allocCode(a), (by.get(allocCode(a)) || 0) + 1);
    info.push(['Dùng cho các dự án', [...by].sort().map(([c, n]) => `<b>${esc(c)}</b> (${n} dòng)`).join(', ')]);
  }
  if (pr.title && pr.title !== pr.pr_no) info.push(['Diễn giải', esc(pr.title)]);
  if (pr.note) info.push(['Ghi chú', esc(pr.note)]);
  const sig = (t, name) => `<td style="width:50%;text-align:center;vertical-align:top;padding:4px">
      <div style="font-weight:700">${t}</div><div style="font-style:italic;font-size:11px">(Ký, ghi rõ họ tên)</div>
      <div style="height:78px"></div><div style="font-weight:600">${esc(name || '')}</div></td>`;
  return `<div style="font-family:'Times New Roman',Times,serif;font-size:13px;color:#000;background:#fff;width:190mm;padding:2mm">
    <table style="width:100%;border-collapse:collapse"><tr>
      <td style="vertical-align:top;width:62px"><img src="${new URL('icons/logo-1024.png', location.href).href}" alt="" style="width:54px;height:54px;display:block"></td>
      <td style="vertical-align:top"><div style="font-weight:700;font-size:15px;color:#44502a">${esc(CONFIG.COMPANY)}</div>
        <div style="font-size:12px">Dự án: ${esc(site.name || site.code || '')}</div></td>
      <td style="vertical-align:top;text-align:right;font-size:12px">Số: <b style="font-size:14px">${esc(pr.pr_no)}</b><br>Ngày lập: ${esc(fmtD(vnDate(pr.created_at)))}
        ${(pr.revision || 1) > 1 ? `<br>Lần sửa: R${pr.revision}` : ''}</td></tr></table>
    <div style="text-align:center;margin:14px 0 4px;font-size:18px;font-weight:700">PHIẾU ĐỀ NGHỊ CẤP VẬT TƯ${site.is_workshop ? ' – XƯỞNG' : ''}</div>
    <div style="text-align:center;font-style:italic;margin-bottom:12px">(Purchase Request)</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:10px">${info.map(([k, v]) => `<tr><td style="width:34%;padding:3px 0;color:#222">${k}:</td><td style="padding:3px 0">${v}</td></tr>`).join('')}</table>
    <table style="width:100%;border-collapse:collapse;font-size:12.5px">
      <thead><tr style="background:#e9ecdd">
        <th style="${head}width:6%">STT</th><th style="${head}width:14%">Mã vật tư</th><th style="${head}">Tên vật tư</th><th style="${head}width:16%">Quy cách</th>
        <th style="${head}width:8%">ĐVT</th><th style="${head}width:10%;text-align:right">Số lượng</th>${hasAlloc ? `<th style="${head}width:20%">Dùng cho dự án</th>` : ''}<th style="${head}width:${hasAlloc ? 12 : 16}%">Ghi chú</th></tr></thead>
      <tbody>${its.map(i => { const m = dd.mat.get(i.material_id) || {}; return `<tr style="page-break-inside:avoid">
        <td style="${cell}text-align:center">${i.line_no}</td><td style="${cell}">${esc(m.code || '')}</td><td style="${cell}">${esc(m.name || '')}</td>
        <td style="${cell}">${esc(m.spec || '')}</td><td style="${cell}">${esc(i.unit)}</td><td style="${cell}text-align:right">${fmtN(i.qty)}</td>${hasAlloc ? `<td style="${cell}">${esc(allocText(i.alloc, i.qty))}</td>` : ''}<td style="${cell}">${esc(i.note || '')}</td></tr>`; }).join('')}
      </tbody></table>
    <div style="margin-top:6px;font-size:12px">Tổng số: <b>${its.length}</b> dòng vật tư · Trạng thái trên hệ thống: ${esc((PR_ST[pr.status] || [pr.status])[0])}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:22px;page-break-inside:avoid"><tr>
      ${sig('Người đặt hàng', requester)}${sig('Chỉ huy trưởng', site.manager)}</tr></table>
    <div style="margin-top:16px;font-size:10.5px;color:#555;text-align:right">In từ hệ thống đặt hàng vật tư lúc ${esc(fmtDT(new Date().toISOString()))}</div>
  </div>`;
}

export async function exportPRPdf(prId) {
  const pr = S.prs.find(p => p.id === prId || p.pr_no === prId);
  if (!pr) return toast('Không tìm thấy PR', 'err');
  toast('Đang tạo file PDF…', '');
  try {
    await loadLib();
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff';
    wrap.innerHTML = docHTML(pr);
    document.body.appendChild(wrap);
    try {
      await window.html2pdf().set({
        margin: [10, 10, 12, 10], filename: `${pr.pr_no}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      }).from(wrap.firstElementChild).save();
    } finally { wrap.remove(); }
    toast(`Đã xuất ${pr.pr_no}.pdf`, 'ok');
  } catch (e) {
    // Dự phòng: mở bản in để chọn "Lưu thành PDF"
    const w = window.open('', '_blank');
    if (!w) return toast(e.message, 'err');
    w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(pr.pr_no)}</title><style>@page{size:A4;margin:10mm}body{margin:0}</style></head><body>${docHTML(pr)}<script>print()<\/script></body></html>`);
    w.document.close();
  }
}
ACT['pr-pdf'] = b => exportPRPdf(b.dataset.id);
