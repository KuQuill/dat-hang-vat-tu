// Sheet 5 — Đề xuất mua: Phòng vật tư gom phần "cần mua" → gửi Thu mua → Thu mua cập nhật NCC / giá / ngày về
import { S, ctx, ACT, VIEWS, INPUTS, hooks, $, $$, esc, todayISO, fmtD, fmtDT, fmtN, numInput, parseNum, round6,
         toast, modal, runAction, PP_ST, PR_ST, OPEN_ST, APPROVED_PR, badge, siteById, profName, isStaff, isPurch, D, khoFree, exportRows, parsePaste } from './core.js';

const money = v => v == null || v === '' ? '' : Number(v).toLocaleString('vi-VN') + ' ₫';

function buyCandidates() {
  const dd = D(); const out = [];
  for (const d of S.deliveries) {
    if (d.source !== 'mua' || !OPEN_ST.includes(d.status) || dd.link.has(d.id)) continue;
    const it = dd.item.get(d.item_id); if (!it) continue;
    const pr = dd.pr.get(it.pr_id); if (!pr || !APPROVED_PR.includes(pr.status)) continue;
    out.push({ d, it, pr, m: dd.mat.get(it.material_id) });
  }
  return out.sort((a, b) => a.m.code.localeCompare(b.m.code) || String(a.pr.need_date).localeCompare(String(b.pr.need_date)));
}

VIEWS.purchase = {
  title: 'Đề xuất mua',
  show: () => isPurch(),
  html() {
    return `${isStaff() ? '<section class="card mb" id="buy-box"></section>' : ''}
      <section class="card">
        <div class="toolbar mb"><h3>📑 Danh sách đề xuất mua</h3><span class="spacer"></span>
          <select data-pfilter="status" class="w-auto"><option value="">Tất cả trạng thái</option>${Object.entries(PP_ST).map(([k, [l]]) => `<option value="${k}" ${S.pfilters.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          ${isStaff() ? '<button class="btn sm" data-act="pp-manual">＋ Đề xuất mua bổ sung kho</button>' : ''}
          <button class="btn sm" data-act="pp-export-all">⬇ Xuất Excel</button></div>
        <div id="pp-list"></div>
      </section>`;
  },
  after() { renderBuy(); renderProposals(); },
  refresh() { if ($('#pp-list')) VIEWS.purchase.after(); else hooks.render(); },
};

function renderBuy() {
  const box = $('#buy-box'); if (!box) return;
  const list = buyCandidates();
  for (const id of [...S.buySel]) if (!list.some(x => x.d.id === id)) S.buySel.delete(id);
  const groups = new Map();
  for (const x of list) { if (!groups.has(x.m.id)) groups.set(x.m.id, []); groups.get(x.m.id).push(x); }
  const sel = list.filter(x => S.buySel.has(x.d.id));
  box.innerHTML = `<div class="toolbar mb"><div><h3>🛒 Vật tư cần mua mới <span class="badge b-amber">${list.length} đợt</span></h3>
      <div class="small muted">Phần kho tổng không đủ khi duyệt PR. Tích chọn rồi bấm <b>Lập đề xuất</b> — các đợt cùng vật tư được gộp thành 1 dòng để Thu mua mua một lần.</div></div>
      <span class="spacer"></span><button class="btn primary" data-act="pp-create" ${sel.length ? '' : 'disabled'}>Lập đề xuất mua (${sel.length})</button></div>
    ${list.length ? `<div class="table-wrap"><table class="buy-table">
      <thead><tr><th><input type="checkbox" data-buyall ${list.length && list.every(x => S.buySel.has(x.d.id)) ? 'checked' : ''} aria-label="Chọn tất cả"></th><th>Vật tư</th><th>PR / công trường</th><th class="right">SL cần mua</th><th>Ngày cần</th><th>Kho tổng hiện trống</th></tr></thead>
      <tbody>${[...groups.values()].map(arr => { const m = arr[0].m; const total = round6(arr.reduce((s, x) => s + Number(x.d.qty), 0)); const free = khoFree(m.id);
        return `<tr class="item-row"><td><input type="checkbox" data-buygrp="${m.id}" ${arr.every(x => S.buySel.has(x.d.id)) ? 'checked' : ''} aria-label="Chọn cả nhóm"></td>
          <td colspan="2"><span class="mono">${esc(m.code)}</span> <b>${esc(m.name)}</b> <span class="small muted">${esc(m.spec || '')}</span></td>
          <td class="right"><b>${fmtN(total)}</b> ${esc(m.unit)}</td><td></td>
          <td class="small">${free > 0 ? `<span class="ok-text">${fmtN(free)} ${esc(m.unit)} — có thể đổi đợt sang “Kho tổng”</span>` : '<span class="muted">0</span>'}</td></tr>` +
          arr.map(x => `<tr class="batch"><td><input type="checkbox" data-buy="${x.d.id}" ${S.buySel.has(x.d.id) ? 'checked' : ''} aria-label="Chọn"></td>
            <td class="bl">↳ dòng ${x.it.line_no} · đợt ${x.d.batch_no}</td>
            <td><button class="linkbtn mono" data-act="goto-pr" data-id="${x.pr.id}">${esc(x.pr.pr_no)}</button> · ${esc((siteById(x.pr.site_id) || {}).code || '')} <span class="small muted">${esc(x.pr.title)}</span></td>
            <td class="right">${fmtN(x.d.qty)} ${esc(x.it.unit)}</td><td class="nowrap ${x.pr.need_date < todayISO() ? 'late-text' : ''}">${esc(fmtD(x.pr.need_date))}</td><td></td></tr>`).join(''); }).join('')}
      </tbody></table></div>` : '<div class="empty small">Không có vật tư nào cần mua. 👍</div>'}`;
}

function renderProposals() {
  const el = $('#pp-list'); if (!el) return;
  const dd = D(); const staff = isStaff(), purch = isPurch();
  const list = S.proposals.filter(p => !S.pfilters.status || p.status === S.pfilters.status);
  if (!list.length) { el.innerHTML = '<div class="empty small">Chưa có đề xuất mua nào.</div>'; return; }
  el.innerHTML = `<div class="table-wrap"><table class="pp-table">
    <thead><tr><th></th><th>Số đề xuất</th><th>Tiêu đề</th><th>Ngày lập</th><th>Người lập</th><th class="right">Số dòng</th><th class="right">Giá trị</th><th>Trạng thái</th></tr></thead>
    <tbody>${list.map(p => {
      const lines = S.lines.filter(l => l.proposal_id === p.id).sort((a, b) => a.line_no - b.line_no);
      const total = lines.reduce((s, l) => s + (l.unit_price != null ? Number(l.unit_price) * Number(l.qty) : 0), 0);
      const open = S.pexpanded.has(p.id);
      return `<tr class="pr-row ${open ? 'open' : ''}" data-act="pp-toggle" data-id="${p.id}" data-pp="${p.id}">
        <td><span class="caret">▶</span></td><td class="mono nowrap"><b>${esc(p.pp_no)}</b></td><td>${esc(p.title)}</td>
        <td class="nowrap">${esc(fmtD(p.created_at.slice(0, 10)))}</td><td>${esc(profName(p.created_by))}</td>
        <td class="right">${lines.length}</td><td class="right nowrap">${total ? money(total) : ''}</td><td>${badge(PP_ST, p.status)}</td></tr>
        ${open ? `<tr class="detail"><td colspan="8">${ppDetail(p, lines, staff, purch)}</td></tr>` : ''}`;
    }).join('')}</tbody></table></div>`;
}
function ppDetail(p, lines, staff, purch) {
  const dd = D(); const editable = purch && p.status !== 'huy';
  const stOpts = Object.entries(PP_ST).filter(([k]) => k !== 'huy' || staff).map(([k, [l]]) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${l}</option>`).join('');
  return `<div class="toolbar mb">
      <div class="small">${p.note ? `📝 ${esc(p.note)}<br>` : ''}${p.handled_by ? `Thu mua phụ trách: <b>${esc(profName(p.handled_by))}</b>` : '<span class="muted">Thu mua chưa nhận</span>'}${p.purchasing_note ? ` · “${esc(p.purchasing_note)}”` : ''} · cập nhật ${esc(fmtDT(p.updated_at))}</div>
      <span class="spacer"></span>
      ${editable ? `<select data-ppst="${p.id}" class="w-auto">${stOpts}</select><input data-ppnote="${p.id}" placeholder="Ghi chú thu mua" class="w180"><button class="btn sm primary" data-act="pp-status" data-id="${p.id}">Cập nhật trạng thái</button>` : ''}
      <button class="btn sm" data-act="pp-export" data-id="${p.id}">⬇ Xuất Excel</button>
    </div>
    ${editable ? '<p class="small muted mb-s">Thu mua: nhập NCC, đơn giá, ngày về dự kiến, số PO cho từng dòng rồi bấm <b>Lưu</b> — ngày về và NCC tự cập nhật vào các PR liên quan để công trường theo dõi.</p>' : ''}
    <div class="table-wrap"><table class="items">
      <thead><tr><th>#</th><th>Vật tư</th><th class="right">SL</th><th>Cho PR / công trường</th><th>Ngày cần</th><th>NCC</th><th class="right">Đơn giá</th><th>Ngày về dự kiến</th><th>Số PO</th><th>Ghi chú</th>${editable ? '<th></th>' : ''}</tr></thead>
      <tbody>${lines.map(l => { const m = dd.mat.get(l.material_id) || {};
        const prs = S.links.filter(x => x.line_id === l.id).map(x => { const d = S.deliveries.find(y => y.id === x.delivery_id); const it = d && dd.item.get(d.item_id); const pr = it && dd.pr.get(it.pr_id);
          return pr ? `<div class="nowrap"><button class="linkbtn mono" data-act="goto-pr" data-id="${pr.id}">${esc(pr.pr_no)}</button> · ${esc((siteById(pr.site_id) || {}).code || '')} · ${fmtN(d.qty)} <span class="small muted">${esc((PR_ST[pr.status] || [''])[0])}</span></div>` : ''; }).join('') || '<span class="small muted">Bổ sung kho tổng</span>';
        return editable ? `<tr data-line="${l.id}"><td>${l.line_no}</td><td><span class="mono">${esc(m.code)}</span> ${esc(m.name)}<div class="small muted">${esc(m.spec || '')}</div></td>
          <td class="right nowrap">${fmtN(l.qty)} ${esc(l.unit)}</td><td class="small">${prs}</td><td class="nowrap">${esc(fmtD(l.need_date))}</td>
          <td><input data-lf="supplier" value="${esc(l.supplier || '')}" class="w120"></td><td><input data-lf="unit_price" value="${numInput(l.unit_price)}" inputmode="decimal" class="w100 right"></td>
          <td><input type="date" data-lf="eta" value="${esc(l.eta || '')}"></td><td><input data-lf="po_no" value="${esc(l.po_no || '')}" class="w90"></td>
          <td><input data-lf="note" value="${esc(l.note || '')}" class="w120"></td><td><button class="btn sm" data-act="pp-line-save" data-id="${l.id}">Lưu</button></td></tr>`
        : `<tr><td>${l.line_no}</td><td><span class="mono">${esc(m.code)}</span> ${esc(m.name)}<div class="small muted">${esc(m.spec || '')}</div></td><td class="right nowrap">${fmtN(l.qty)} ${esc(l.unit)}</td>
          <td class="small">${prs}</td><td class="nowrap">${esc(fmtD(l.need_date))}</td><td>${esc(l.supplier || '')}</td><td class="right nowrap">${money(l.unit_price)}</td>
          <td class="nowrap">${esc(fmtD(l.eta))}</td><td class="mono">${esc(l.po_no || '')}</td><td class="small">${esc(l.note || '')}</td></tr>`; }).join('')}
      </tbody></table></div>`;
}
function exportPP(props) {
  const dd = D(); const rows = [];
  for (const p of props) for (const l of S.lines.filter(x => x.proposal_id === p.id).sort((a, b) => a.line_no - b.line_no)) {
    const m = dd.mat.get(l.material_id) || {};
    const prs = S.links.filter(x => x.line_id === l.id).map(x => { const d = S.deliveries.find(y => y.id === x.delivery_id); const it = d && dd.item.get(d.item_id); const pr = it && dd.pr.get(it.pr_id); return pr ? `${pr.pr_no} (${(siteById(pr.site_id) || {}).code}: ${fmtN(d.qty)})` : ''; }).join('; ');
    rows.push({ 'Số đề xuất': p.pp_no, 'Tiêu đề': p.title, 'Trạng thái': PP_ST[p.status][0], 'Dòng': l.line_no, 'Mã VT': m.code, 'Vật tư': m.name, 'Quy cách': m.spec || '',
      'Số lượng': Number(l.qty), 'ĐVT': l.unit, 'Cho PR': prs || 'Bổ sung kho tổng', 'Ngày cần': fmtD(l.need_date), 'NCC': l.supplier || '',
      'Đơn giá': l.unit_price ?? '', 'Thành tiền': l.unit_price != null ? Number(l.unit_price) * Number(l.qty) : '', 'Ngày về dự kiến': fmtD(l.eta), 'Số PO': l.po_no || '', 'Ghi chú': l.note || '' });
  }
  exportRows(rows, props.length === 1 ? props[0].pp_no : `de-xuat-mua-${todayISO()}`, 'Đề xuất mua');
}

INPUTS.push(e => {
  const t = e.target;
  if (t.dataset.buy) { t.checked ? S.buySel.add(t.dataset.buy) : S.buySel.delete(t.dataset.buy); renderBuy(); return true; }
  if (t.dataset.buygrp) { for (const x of buyCandidates().filter(x => x.m.id === t.dataset.buygrp)) t.checked ? S.buySel.add(x.d.id) : S.buySel.delete(x.d.id); renderBuy(); return true; }
  if ('buyall' in t.dataset) { for (const x of buyCandidates()) t.checked ? S.buySel.add(x.d.id) : S.buySel.delete(x.d.id); renderBuy(); return true; }
  if (t.dataset.pfilter) { S.pfilters[t.dataset.pfilter] = t.value; renderProposals(); return true; }
  return false;
});

Object.assign(ACT, {
  'pp-toggle': (b, e) => { if (e.target.closest('button,input,select,a')) return; const id = b.dataset.id; S.pexpanded.has(id) ? S.pexpanded.delete(id) : S.pexpanded.add(id); renderProposals(); },
  'goto-pr': b => { S.tab = 'track'; S.expanded.add(b.dataset.id); const pr = D().pr.get(b.dataset.id); S.filters = { ...S.filters, q: pr ? pr.pr_no : '', status: '', kpi: '' }; hooks.render(); },
  'pp-create': async () => {
    const sel = buyCandidates().filter(x => S.buySel.has(x.d.id)); if (!sel.length) return;
    const mats = new Set(sel.map(x => x.m.id)); const sites = [...new Set(sel.map(x => (siteById(x.pr.site_id) || {}).code))];
    const { action, data } = await modal({
      title: 'Lập đề xuất mua gửi Thu mua',
      body: `<p class="small">${sel.length} đợt · gộp thành <b>${mats.size} dòng</b> vật tư · công trường: ${esc(sites.join(', '))}</p>
        <div class="form"><label class="f full"><span class="req">Tiêu đề</span><input id="pp-title" value="Đề xuất mua vật tư ${fmtD(todayISO())} — ${esc(sites.join(', '))}"></label>
        <label class="f full">Ghi chú cho Thu mua<textarea id="pp-note" rows="2" placeholder="vd: Ưu tiên giao trước ngày 05/12"></textarea></label></div>`,
      actions: [{ label: 'Huỷ', value: null }, { label: 'Gửi Thu mua', value: 'ok', primary: true, validate: v => v.title.trim() ? null : 'Nhập tiêu đề' }],
      read: ov => ({ title: $('#pp-title', ov).value, note: $('#pp-note', ov).value }),
    });
    if (action !== 'ok') return;
    let res;
    const ok = await runAction(async () => { res = await ctx.B.createProposal(data.title, data.note, sel.map(x => x.d.id), []); }, null, () => S.buySel.clear());
    if (ok && res) { toast(`Đã gửi ${res.pp_no} cho Thu mua`, 'ok'); S.pexpanded.add(res.id); renderProposals(); }
  },
  'pp-manual': async () => {
    const { action, data } = await modal({
      title: 'Đề xuất mua bổ sung kho tổng',
      body: `<p class="small muted">Mỗi dòng: <b>Mã VT · Số lượng · Ngày cần (tuỳ chọn) · Ghi chú</b>. Ví dụ mua dự trữ cho kho tổng.</p>
        <div class="form"><label class="f full"><span class="req">Tiêu đề</span><input id="pm-title" value="Mua bổ sung kho tổng ${fmtD(todayISO())}"></label></div>
        <textarea id="pm-box" rows="8" placeholder="KC-0005\t300\nDC-0003\t50"></textarea>`,
      actions: [{ label: 'Huỷ', value: null }, { label: 'Gửi Thu mua', value: 'ok', primary: true, validate: v => !v.title.trim() ? 'Nhập tiêu đề' : !parsePaste(v.text).length ? 'Chưa có dòng nào' : null }],
      read: ov => ({ title: $('#pm-title', ov).value, text: $('#pm-box', ov).value }),
    });
    if (action !== 'ok') return;
    const manual = parsePaste(data.text).map(c => ({ code: c[0], qty: parseNum(c[1]), need_date: /^\d{4}-\d{2}-\d{2}$/.test(c[2] || '') ? c[2] : null, note: c[3] || '' }));
    let res;
    const ok = await runAction(async () => { res = await ctx.B.createProposal(data.title, null, [], manual); });
    if (ok && res) { toast(`Đã gửi ${res.pp_no} cho Thu mua`, 'ok'); S.pexpanded.add(res.id); renderProposals(); }
  },
  'pp-status': b => {
    const p = S.proposals.find(x => x.id === b.dataset.id);
    const st = $(`[data-ppst="${b.dataset.id}"]`).value, note = $(`[data-ppnote="${b.dataset.id}"]`).value;
    runAction(() => ctx.B.updateProposal(p.pp_no, st, note), `Đã cập nhật ${p.pp_no}: ${PP_ST[st][0]}`);
  },
  'pp-line-save': b => {
    const tr = b.closest('tr'); const v = k => $(`[data-lf="${k}"]`, tr).value;
    const price = v('unit_price').trim(); if (price && !(parseNum(price) >= 0)) return toast('Đơn giá không hợp lệ', 'err');
    runAction(() => ctx.B.updateProposalLine(b.dataset.id, { supplier: v('supplier'), unit_price: price === '' ? '' : parseNum(price), eta: v('eta'), po_no: v('po_no'), note: v('note') }), 'Đã lưu — ngày về đã cập nhật vào các PR liên quan');
  },
  'pp-export': b => exportPP(S.proposals.filter(p => p.id === b.dataset.id)),
  'pp-export-all': () => exportPP(S.proposals.filter(p => !S.pfilters.status || p.status === S.pfilters.status)),
});
