// Sheet 3 — Theo dõi đơn hàng & nhận hàng
import { S, ctx, ACT, VIEWS, INPUTS, hooks, $, $$, esc, norm, todayISO, addDays, vnDate, fmtD, fmtDT, fmtN, numInput, parseNum, round6, debounce,
         toast, modal, runAction, PR_ST, IT_ST, COND, ISSUES, RESOLUTION, PP_ST, OPEN_ST, ACTIVE_PR, badge, siteById, siteOptions, profName,
         isStaff, D, kindOf, khoFree, stockFree, assetBusy, loadVisibleImages, imgTag, pickFiles, filesToImages, uploadImages, exportRows } from './core.js';

const CLOSED = ['da_ve', 'co_van_de', 'huy'];
const canConfirm = pr => !!S.profile && (pr.requested_by === S.user.id || isStaff() || (S.profile.site_id && S.profile.site_id === pr.site_id));

/* ---------- Gộp dữ liệu PR ---------- */
function enrich() {
  const t = todayISO(); const dd = D();
  const itemsBy = new Map(), attBy = new Map();
  for (const i of S.items) { if (!itemsBy.has(i.pr_id)) itemsBy.set(i.pr_id, []); itemsBy.get(i.pr_id).push(i); }
  for (const a of S.atts) { if (!attBy.has(a.pr_id)) attBy.set(a.pr_id, []); attBy.get(a.pr_id).push(a); }
  S._items = new Map();
  return S.prs.map(pr => {
    const active = ACTIVE_PR.includes(pr.status);
    const its = (itemsBy.get(pr.id) || []).sort((a, b) => a.line_no - b.line_no).map(i => {
      const m = dd.mat.get(i.material_id) || {};
      const batches = dd.delByItem.get(i.id) || [];
      const isLate = (st, eta) => active && OPEN_ST.includes(st) && ((eta && eta < t) || (!eta && pr.need_date && pr.need_date < t));
      const late = batches.length ? batches.some(b => isLate(b.status, b.eta)) : (active && i.status !== 'huy' && pr.need_date && pr.need_date < t);
      // tín hiệu mua mới
      let buyOpen = 0; const props = new Map();
      for (const b of batches) if (b.source === 'mua' && OPEN_ST.includes(b.status)) {
        const lid = dd.link.get(b.id);
        if (!lid) buyOpen += Number(b.qty);
        else { const ln = dd.line.get(lid); const pp = ln && dd.prop.get(ln.proposal_id); if (pp) props.set(pp.id, pp); }
      }
      const estimate = !batches.length && pr.status === 'cho_duyet' ? Math.max(0, round6(Number(i.qty) - khoFree(i.material_id))) : 0;
      const x = { ...i, code: m.code || '?', name: m.name || '(vật tư đã xoá)', spec: m.spec || '', batches, late, pr, kind: kindOf(i.material_id),
                  buyOpen: round6(buyOpen), props: [...props.values()], estimate };
      S._items.set(i.id, x);
      return x;
    });
    const live = its.filter(i => i.status !== 'huy');
    const etas = [];
    for (const i of live) { if (i.batches.length) i.batches.forEach(b => { if (OPEN_ST.includes(b.status) && b.eta) etas.push(b.eta); }); else if (i.eta) etas.push(i.eta); }
    etas.sort();
    const site = siteById(pr.site_id) || {};
    return { ...pr, its, atts: attBy.get(pr.id) || [], site_code: site.code || '?', site_name: site.name || '', requester: profName(pr.requested_by),
             done: live.filter(i => i.status === 'da_ve').length, total: live.length,
             issues: its.filter(i => i.status === 'co_van_de').length,
             toReceive: its.reduce((n, i) => n + i.batches.filter(b => b.status === 'dang_giao').length, 0),
             buy: its.reduce((n, i) => n + (i.buyOpen > 0 || i.estimate > 0 ? 1 : 0), 0),
             eta_min: etas[0] || null, eta_max: etas[etas.length - 1] || null, late: its.some(i => i.late), created_date: vnDate(pr.created_at) };
  }).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}
function applyFilters(list) {
  const f = S.filters, q = norm(f.q), d30 = addDays(todayISO(), -30);
  return list.filter(p => {
    if (f.site && p.site_code !== f.site) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.from && p.created_date < f.from) return false;
    if (f.to && p.created_date > f.to) return false;
    if (f.mine && p.requested_by !== S.user.id && !(S.profile.site_id && p.site_id === S.profile.site_id)) return false;
    if (f.late && !p.late) return false;
    if (f.kpi === 'pending' && p.status !== 'cho_duyet') return false;
    if (f.kpi === 'receive' && !p.toReceive) return false;
    if (f.kpi === 'issue' && p.status !== 'co_van_de') return false;
    if (f.kpi === 'late' && !p.late) return false;
    if (f.kpi === 'done' && !(p.status === 'da_ve' && vnDate(p.updated_at) >= d30)) return false;
    if (q) {
      const hay = norm([p.pr_no, p.title, p.site_code, p.site_name, p.requester, p.note, ...p.its.map(i => i.code + ' ' + i.name + ' ' + (i.supplier || '') + ' ' + (i.po_no || ''))].join(' '));
      if (!q.split(' ').every(w => hay.includes(w))) return false;
    }
    return true;
  });
}

VIEWS.track = {
  title: 'Theo dõi & nhận hàng',
  html() {
    const f = S.filters;
    return `<div id="kpis"></div>
      <div class="filters">
        <input data-filter="q" value="${esc(f.q)}" placeholder="🔍 Tìm số PR, tên PR, vật tư, người đặt, NCC, PO…">
        <select data-filter="site">${siteOptions(f.site, 'Tất cả công trường')}</select>
        <select data-filter="status"><option value="">Tất cả trạng thái</option>${Object.entries(PR_ST).map(([k, [l]]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input type="date" data-filter="from" value="${esc(f.from)}" title="Tạo từ ngày" aria-label="Tạo từ ngày">
        <input type="date" data-filter="to" value="${esc(f.to)}" title="Đến ngày" aria-label="Đến ngày">
        <div class="checks">
          <label><input type="checkbox" data-filter="mine" ${f.mine ? 'checked' : ''}> Đơn của tôi / công trường tôi</label>
          <label><input type="checkbox" data-filter="late" ${f.late ? 'checked' : ''}> Chỉ đơn trễ hạn</label>
          <span class="spacer"></span>
          <button class="btn sm" data-act="clear-filters">Bỏ lọc</button>
          <button class="btn sm" data-act="export-track">⬇ Xuất Excel</button>
        </div>
      </div>
      <div id="outbox"></div>
      <div id="track-table"></div>`;
  },
  after() { renderParts(); },
  refresh() { if ($('#kpis')) renderParts(); else hooks.render(); },
};

function renderParts() {
  const all = enrich(); const d30 = addDays(todayISO(), -30);
  const k = {
    pending: all.filter(p => p.status === 'cho_duyet').length,
    receive: all.filter(p => p.toReceive).length,
    issue: all.filter(p => p.status === 'co_van_de').length,
    late: all.filter(p => p.late).length,
    done: all.filter(p => p.status === 'da_ve' && vnDate(p.updated_at) >= d30).length,
  };
  const kp = (id, v, l, cls) => `<button class="kpi ${S.filters.kpi === id ? 'active' : ''}" data-act="kpi" data-kpi="${id}"><div class="v ${v && cls ? cls : ''}">${v}</div><div class="l">${l}</div></button>`;
  $('#kpis').innerHTML = `<div class="kpis">${kp('pending', k.pending, 'Chờ duyệt')}${kp('receive', k.receive, 'Đang giao — chờ nhận hàng')}${kp('issue', k.issue, 'Có vấn đề nhận hàng', 'late-text')}${kp('late', k.late, 'Trễ hạn', 'late-text')}${kp('done', k.done, 'Nhận đủ trong 30 ngày')}</div>`;

  $('#outbox').innerHTML = S.outbox.length ? `<section class="card mb"><h3>⏳ Đơn chờ gửi (${S.outbox.length})</h3>
      ${S.outbox.map(o => `<div class="toolbar ob-row"><span>${esc(o.label || '')} <span class="muted small">· lưu lúc ${esc(fmtDT(o.created_at))}</span></span>
        ${o.error ? `<span class="badge b-red" title="${esc(o.error)}">Lỗi: ${esc(o.error)}</span>` : ''}<span class="spacer"></span>
        <button class="btn sm" data-act="ob-edit" data-id="${o.id}">Mở lại để sửa</button><button class="btn sm danger" data-act="ob-del" data-id="${o.id}">Xoá</button></div>`).join('')}
      <p class="small muted">Tự gửi khi có mạng, hoặc bấm ⟳ Update.</p></section>` : '';

  const list = applyFilters(all); const MAX = 300;
  if (!list.length) { $('#track-table').innerHTML = `<div class="card empty">${all.length ? 'Không có đơn nào khớp bộ lọc.' : 'Chưa có đơn hàng nào. Bấm ⟳ Update để tải dữ liệu.'}</div>`; return; }
  $('#track-table').innerHTML = `<div class="small muted mb-s">${list.length} phiếu${list.length > MAX ? ` (hiển thị ${MAX} phiếu mới nhất — hãy lọc thêm)` : ''} · bấm vào dòng để xem chi tiết, nhận hàng, ảnh</div>
    <div class="table-wrap"><table class="pr-table">
      <thead><tr><th></th><th>Số PR / Tên PR</th><th>Ngày tạo</th><th>Công trường</th><th>Người đặt</th><th>Ngày cần</th><th>Tiến độ</th><th>Ngày về dự kiến</th><th>Trạng thái</th></tr></thead>
      <tbody>${list.slice(0, MAX).map(prRowHTML).join('')}</tbody></table></div>`;
  loadVisibleImages();
}
function prRowHTML(p) {
  const open = S.expanded.has(p.id);
  const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
  const eta = p.eta_min ? (p.eta_min === p.eta_max ? fmtD(p.eta_min) : `${fmtD(p.eta_min)} → ${fmtD(p.eta_max)}`) : (p.status === 'da_ve' ? '—' : '<span class="muted">chưa có</span>');
  const flags = [p.toReceive && canConfirm(p) ? `<span class="badge b-teal">${p.toReceive} đợt chờ nhận</span>` : '', p.buy && isStaff() ? `<span class="badge b-amber">🛒 ${p.buy} dòng cần mua</span>` : ''].join(' ');
  return `<tr class="pr-row ${open ? 'open' : ''} ${p.late ? 'late' : ''}" data-act="toggle" data-id="${p.id}">
      <td><span class="caret">▶</span></td>
      <td><div class="mono nowrap"><b>${esc(p.pr_no)}</b>${p.atts.length ? ` <span class="muted small" title="Có ảnh">📷${p.atts.length}</span>` : ''}</div>${p.title && p.title !== p.pr_no ? `<div class="pr-title" title="${esc(p.title)}">${esc(p.title)}</div>` : ''}${flags ? `<div>${flags}</div>` : ''}</td>
      <td class="nowrap">${esc(fmtD(p.created_date))}</td>
      <td class="nowrap" title="${esc(p.site_name)}">${esc(p.site_code)}</td>
      <td>${esc(p.requester)}</td>
      <td class="nowrap ${p.late && p.need_date < todayISO() ? 'late-text' : ''}">${esc(fmtD(p.need_date))}</td>
      <td class="nowrap"><div class="small">${p.done}/${p.total} dòng nhận đủ${p.issues ? ` · <span class="late-text">${p.issues} có vấn đề</span>` : ''}</div><div class="progress"><i style="width:${pct}%"></i></div></td>
      <td class="nowrap ${p.late ? 'late-text' : ''}">${eta}${p.late ? ' ⚠' : ''}</td>
      <td>${badge(PR_ST, p.status)}</td>
    </tr>${open ? `<tr class="detail"><td colspan="9">${prDetailHTML(p)}</td></tr>` : ''}`;
}

/* ---------- Đợt giao (bản sửa tạm của phòng vật tư) ---------- */
function batchesFor(it) {
  if (S.batchEdits.has(it.id)) return S.batchEdits.get(it.id);
  return it.batches;
}
function editBatches(itemId) {
  if (!S.batchEdits.has(itemId)) {
    const it = S._items.get(itemId);
    const src = it.batches.length ? it.batches : [{ id: null, qty: it.qty, source: 'mua', status: 'cho_xu_ly' }];
    S.batchEdits.set(itemId, src.map(b => ({ ...b, qty: String(b.qty ?? ''), supplier: b.supplier || '', po_no: b.po_no || '', eta: b.eta || '' })));
  }
  return S.batchEdits.get(itemId);
}
const sumOf = bs => round6(bs.filter(b => b.status !== 'huy').reduce((s, b) => s + (parseNum(b.qty) || 0), 0));
function sumHTML(it) {
  const bs = batchesFor(it); if (!bs.length) return '';
  const sum = sumOf(bs), okk = sum === round6(Number(it.qty));
  return bs.length > 1 || !okk ? `<div class="small ${okk ? 'muted' : 'late-text'}">Tổng các đợt: ${fmtN(sum)}/${fmtN(it.qty)}${okk ? '' : ' ⚠'}</div>` : '';
}

function sourceLabel(b, it) {
  const dd = D();
  if (b.source === 'kho') {
    if (b.asset_id) { const a = dd.assetById.get(b.asset_id); return `🏬 Kho tổng · <span class="mono">${esc(a ? a.asset_code : '?')}</span>${a && a.serial ? ` (${esc(a.serial)})` : ''}`; }
    const s = dd.stockById.get(b.stock_id);
    return `🏬 Kho tổng${s ? ` · ${esc(COND[s.condition][0])}${s.location_detail ? ' · ' + esc(s.location_detail) : ''}` : ''}`;
  }
  const lid = dd.link.get(b.id); const ln = lid && dd.line.get(lid); const pp = ln && dd.prop.get(ln.proposal_id);
  return `🛒 Mua mới${pp ? ` · <button class="linkbtn" data-act="goto-pp" data-id="${pp.id}">${esc(pp.pp_no)}</button> ${badge(PP_ST, pp.status)}` : (OPEN_ST.includes(b.status) ? ' · <span class="warn-text">chưa đề xuất</span>' : '')}`;
}
function sourceEditor(b, it, k) {
  const dd = D();
  let sel = '';
  if (b.source === 'kho') {
    if (it.kind === 'tung_cai') {
      const opts = S.assets.filter(a => a.material_id === it.material_id && !a.site_id && a.active !== false && (!assetBusy(a.id, b.id) || a.id === b.asset_id));
      sel = `<select data-b="asset_id"><option value="">— Chọn tài sản —</option>${opts.map(a => `<option value="${a.id}" ${a.id === b.asset_id ? 'selected' : ''}>${esc(a.asset_code)}${a.serial ? ' · ' + esc(a.serial) : ''} · ${esc(COND[a.condition][0])}</option>`).join('')}</select>`;
    } else {
      const opts = S.stock.filter(s => s.material_id === it.material_id && !s.site_id);
      sel = `<select data-b="stock_id"><option value="">— Chọn dòng tồn —</option>${opts.map(s => `<option value="${s.id}" ${s.id === b.stock_id ? 'selected' : ''}>${esc(COND[s.condition][0])} · trống ${fmtN(stockFree(s.id, b.id))} ${esc(it.unit)}${s.location_detail ? ' · ' + esc(s.location_detail) : ''}</option>`).join('')}</select>`;
    }
  }
  const lid = b.id && dd.link.get(b.id); const ln = lid && dd.line.get(lid); const pp = ln && dd.prop.get(ln.proposal_id);
  return `<select data-b="source"><option value="kho" ${b.source === 'kho' ? 'selected' : ''}>🏬 Kho tổng</option><option value="mua" ${b.source !== 'kho' ? 'selected' : ''}>🛒 Mua mới</option></select>${sel}
    ${pp ? `<div class="small"><button class="linkbtn" data-act="goto-pp" data-id="${pp.id}">${esc(pp.pp_no)}</button> ${badge(PP_ST, pp.status)}</div>` : ''}`;
}
function receiptHTML(b, it) {
  if (!b.confirmed_at && !b.resolution) return '';
  const parts = [];
  if (b.confirmed_at) {
    const iss = (b.receipt_issues || []).map(x => ISSUES[x] || x);
    parts.push(`${iss.length ? '⚠' : '✔'} Nhận <b>${fmtN(b.qty_actual)}</b>/${fmtN(b.resolution === 'giao_bu' ? b.qty_actual : b.qty)} ${esc(it.unit)} ngày ${esc(fmtD(b.received_date))} · ${esc(profName(b.confirmed_by))}
      ${iss.length ? ` — <span class="late-text">${esc(iss.join(', '))}</span>` : ''}${b.receipt_note ? `: “${esc(b.receipt_note)}”` : ''}${b.serials ? ` · Biển số/seri: ${esc(b.serials)}` : ''}`);
  }
  if (b.resolution) parts.push(`↳ Phòng vật tư xử lý: <b>${esc(RESOLUTION[b.resolution])}</b> — “${esc(b.resolution_note || '')}” · ${esc(profName(b.resolved_by))} ${esc(fmtDT(b.resolved_at))}`);
  return `<div class="receipt ${b.status === 'co_van_de' ? 'issue' : ''}">${parts.join('<br>')}</div>`;
}

function prDetailHTML(p) {
  const staff = isStaff();
  const editable = staff && ['da_duyet', 'da_dat', 'dang_giao', 'co_van_de', 'da_ve'].includes(p.status);
  const owner = p.requested_by === S.user.id;
  const canCancel = (owner && ['cho_duyet', 'thu_hoi', 'tu_choi'].includes(p.status)) || (staff && !['da_ve', 'huy'].includes(p.status));
  const canRecall = (owner || staff) && ['cho_duyet', 'tu_choi', 'da_duyet', 'da_dat'].includes(p.status)
    && !p.its.some(i => i.batches.some(b => ['dang_giao', 'da_ve', 'co_van_de'].includes(b.status)));
  const canAddImg = p.requested_by === S.user.id || staff || (S.profile.site_id && S.profile.site_id === p.site_id);
  const conf = canConfirm(p) && !['cho_duyet', 'tu_choi', 'huy'].includes(p.status);
  const bOpts = sel => OPEN_ST.map(k => `<option value="${k}" ${k === sel ? 'selected' : ''}>${IT_ST[k][0]}</option>`).join('');
  const lineOfItem = new Map(p.its.map(i => [i.id, i.line_no]));
  const delNo = new Map(p.its.flatMap(i => i.batches.map(b => [b.id, `${i.line_no}.${b.batch_no}`])));
  const cols = editable ? 10 : 9;

  const rows = p.its.map(it => {
    const bs = batchesFor(it); const dirty = S.batchEdits.has(it.id);
    const buy = it.estimate > 0 ? `<span class="badge b-amber" title="Ước tính theo tồn kho hiện tại">🛒 Dự kiến cần mua ${fmtN(it.estimate)}</span>`
      : it.buyOpen > 0 ? `<span class="badge b-amber">🛒 Cần mua ${fmtN(it.buyOpen)} — chưa đề xuất</span>`
      : it.props.map(pp => `<button class="linkbtn small" data-act="goto-pp" data-id="${pp.id}">🛒 ${esc(pp.pp_no)}</button> ${badge(PP_ST, pp.status)}`).join(' ');
    const itemRow = `<tr class="item-row">
      <td>${it.line_no}</td>
      <td><span class="mono">${esc(it.code)}</span> ${esc(it.name)}<div class="small muted">${esc(it.spec)}${it.note ? ' · ' + esc(it.note) : ''}</div></td>
      <td class="nowrap"><b>${fmtN(it.qty)}</b> ${esc(it.unit)}${Number(it.qty_received) > 0 && it.status !== 'da_ve' ? `<div class="small muted">đã nhận ${fmtN(it.qty_received)}</div>` : ''}<div id="sum-${it.id}">${sumHTML(it)}</div></td>
      <td class="small">${buy || (it.batches.length ? '' : `<span class="muted">Kho tổng trống ${fmtN(khoFree(it.material_id))}</span>`)}</td>
      <td class="small">${esc(it.supplier || '')}</td><td class="mono small">${esc(it.po_no || '')}</td>
      <td class="nowrap ${it.late ? 'late-text' : ''}">${esc(fmtD(it.eta)) || '<span class="muted">—</span>'}${it.late ? ' ⚠' : ''}</td>
      <td class="nowrap">${esc(fmtD(it.received_date))}</td>
      <td>${badge(IT_ST, it.status)}${bs.length > 1 ? `<div class="small muted">${bs.length} đợt</div>` : ''}</td>
      ${editable ? `<td class="nowrap">${it.status !== 'huy' ? `<button class="btn sm" data-act="split" data-item="${it.id}">＋ Chia đợt</button>
        <button class="btn sm ${dirty ? 'primary' : ''}" id="save-${it.id}" data-act="save-batches" data-item="${it.id}">${dirty ? 'Lưu*' : 'Lưu'}</button>` : ''}</td>` : ''}
    </tr>`;
    return itemRow + bs.map((b, k) => {
      const open = OPEN_ST.includes(b.status) || !b.status;
      const confirmBtn = conf && b.id && open && !S.batchEdits.has(it.id) ? `<button class="btn sm ok" data-act="receive" data-id="${b.id}">✔ Nhận hàng</button>` : '';
      const resolveBtn = staff && b.status === 'co_van_de' ? `<button class="btn sm danger" data-act="resolve" data-id="${b.id}">Xử lý</button>` : '';
      const main = editable && open ? `<tr class="batch" data-item="${it.id}" data-idx="${k}">
          <td></td><td class="bl">↳ Đợt ${k + 1}</td>
          <td class="nowrap"><input data-b="qty" value="${esc(b.qty)}" inputmode="decimal" class="right w80"> ${esc(it.unit)}</td>
          <td class="src">${sourceEditor(b, it, k)}</td>
          <td><input data-b="supplier" value="${esc(b.supplier || '')}" placeholder="NCC" class="w120"></td>
          <td><input data-b="po_no" value="${esc(b.po_no || '')}" placeholder="PO" class="w90"></td>
          <td><input type="date" data-b="eta" value="${esc(b.eta || '')}"></td>
          <td class="small muted">chờ người nhận xác nhận</td>
          <td><select data-b="status">${bOpts(b.status || 'cho_xu_ly')}</select></td>
          <td class="nowrap">${confirmBtn}${bs.filter(x => OPEN_ST.includes(x.status) || !x.status).length > 1 ? `<button class="btn sm ghost danger" data-act="del-batch" data-item="${it.id}" data-idx="${k}" title="Gộp đợt này vào đợt khác">✕</button>` : ''}</td>
        </tr>`
        : `<tr class="batch ${b.status === 'huy' ? 'cancelled' : ''}">
          <td></td><td class="bl">↳ Đợt ${k + 1}${b.note ? `<div class="small muted">${esc(b.note)}</div>` : ''}</td><td class="nowrap">${fmtN(b.qty)} ${esc(it.unit)}</td>
          <td class="small">${sourceLabel(b, it)}</td><td class="small">${esc(b.supplier || '')}</td><td class="mono small">${esc(b.po_no || '')}</td>
          <td class="nowrap ${OPEN_ST.includes(b.status) && b.eta && b.eta < todayISO() ? 'late-text' : ''}">${esc(fmtD(b.eta)) || '<span class="muted">—</span>'}</td>
          <td class="nowrap">${esc(fmtD(b.received_date))}</td><td>${badge(IT_ST, b.status)}</td>
          ${editable ? `<td class="nowrap">${resolveBtn}</td>` : `<td class="nowrap">${confirmBtn}${resolveBtn}</td>`}
        </tr>`;
      const rc = receiptHTML(b, it);
      return main + (rc ? `<tr class="batch receipt-row"><td></td><td colspan="${cols - 1}">${rc}</td></tr>` : '');
    }).join('');
  }).join('');

  return `<div class="toolbar mb">
      <div><b class="mono">${esc(p.pr_no)}</b>${p.title && p.title !== p.pr_no ? ` — <b>${esc(p.title)}</b>` : ''}<div class="small muted">${p.delivery_place ? `📍 Nơi nhận: ${esc(p.delivery_place)} · ` : ''}${p.note ? `📝 ${esc(p.note)} · ` : ''}Nguồn: ${p.source === 'bot' ? 'Bot Telegram' : 'Web app'}
        ${p.approved_by ? ` · ${p.status === 'tu_choi' ? 'Từ chối' : 'Duyệt'} bởi ${esc(profName(p.approved_by))} lúc ${esc(fmtDT(p.approved_at))}` : ''}
        ${p.reject_reason ? ` · <span class="late-text">Lý do: ${esc(p.reject_reason)}</span>` : ''}</div></div>
      <span class="spacer"></span>
      ${staff && p.status === 'cho_duyet' ? `<button class="btn sm ok" data-act="approve" data-pr="${esc(p.pr_no)}" title="Duyệt và tự lập kế hoạch giao: lấy kho tổng trước, phần thiếu → cần mua">✅ Duyệt</button><button class="btn sm danger" data-act="reject" data-pr="${esc(p.pr_no)}">❌ Từ chối</button>` : ''}
      ${editable && p.status !== 'da_ve' ? `<button class="btn sm" data-act="bulk" data-pr="${esc(p.pr_no)}">Cập nhật nhanh cả phiếu…</button>` : ''}
      ${canRecall ? `<button class="btn sm" data-act="recall" data-pr="${esc(p.pr_no)}" data-id="${p.id}" title="Thu hồi để sửa khi đặt nhầm">↩ Thu hồi & sửa</button>` : ''}
      ${p.status === 'thu_hoi' && (owner || staff) ? `<button class="btn sm primary" data-act="load-pr-edit" data-id="${p.id}">✏ Tiếp tục sửa</button>` : ''}
      ${canAddImg ? `<button class="btn sm" data-act="pr-add-img" data-pr="${esc(p.pr_no)}">📷 Thêm ảnh</button>` : ''}
      ${canCancel ? `<button class="btn sm danger" data-act="cancel" data-pr="${esc(p.pr_no)}">Huỷ phiếu</button>` : ''}
    </div>
    ${p.atts.length ? `<div class="thumbs mb">${p.atts.map(a => `<figure class="thumb">${imgTag(a.path, a.file_name || '')}
        <figcaption>${a.delivery_id ? 'Nhận hàng ' + (delNo.get(a.delivery_id) || '') : a.item_id ? 'Dòng ' + (lineOfItem.get(a.item_id) || '?') : 'Ảnh chung'} · ${esc(profName(a.uploaded_by))}</figcaption></figure>`).join('')}</div>` : ''}
    ${editable ? '<p class="small muted mb-s">Phòng vật tư: chọn nguồn (kho tổng / mua mới), NCC, PO, ngày về cho từng đợt rồi bấm <b>Lưu</b>. Chuyển trạng thái <b>Đang giao</b> khi đã xuất hàng — người đặt sẽ bấm <b>Nhận hàng</b> để xác nhận.</p>' : ''}
    ${conf && !editable ? '<p class="small muted mb-s">Khi hàng tới công trường, bấm <b>✔ Nhận hàng</b> ở từng đợt: nhập số lượng thực nhận, đánh dấu nếu thiếu / sai chủng loại / kém chất lượng và chụp ảnh.</p>' : ''}
    <div class="table-wrap"><table class="items">
      <thead><tr><th>#</th><th>Vật tư / đợt giao</th><th>Số lượng</th><th>Nguồn hàng</th><th>NCC</th><th>Số PO</th><th>Ngày về dự kiến</th><th>Ngày nhận</th><th>Trạng thái</th>${editable ? '<th></th>' : '<th></th>'}</tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

/* ---------- Thao tác ---------- */
function saveBatches(itemId) {
  const it = S._items.get(itemId); if (!it) return;
  const bs = batchesFor(it);
  const rows = bs.map(b => CLOSED.includes(b.status) ? { id: b.id } : {
    id: b.id || null, qty: parseNum(b.qty), source: b.source || 'mua', stock_id: b.source === 'kho' ? b.stock_id || null : null,
    asset_id: b.source === 'kho' ? b.asset_id || null : null, supplier: b.supplier || null, po_no: b.po_no || null, eta: b.eta || null, status: b.status || 'cho_xu_ly' });
  for (const r of rows) if ('qty' in r && !(r.qty > 0)) return toast('Số lượng mỗi đợt phải lớn hơn 0', 'err');
  const sum = sumOf(bs);
  if (sum !== round6(Number(it.qty))) return toast(`Tổng các đợt (${fmtN(sum)}) phải bằng số lượng đặt (${fmtN(it.qty)} ${it.unit})`, 'err');
  return runAction(() => ctx.B.saveDeliveries(itemId, rows), `Đã lưu dòng ${it.line_no} — ${it.pr.pr_no}`, () => S.batchEdits.delete(itemId));
}

INPUTS.push(e => {
  const t = e.target;
  if (t.dataset.b) {
    const tr = t.closest('tr[data-item][data-idx]'); if (!tr) return true;
    const id = tr.dataset.item, idx = +tr.dataset.idx; const bs = editBatches(id); const b = bs[idx]; if (!b) return true;
    b[t.dataset.b] = t.value;
    if (t.dataset.b === 'source' || t.dataset.b === 'stock_id' || t.dataset.b === 'asset_id') {
      if (t.dataset.b === 'source' && t.value === 'kho') {
        const it = S._items.get(id);
        if (it.kind === 'tung_cai') { b.qty = '1'; const a = S.assets.find(a => a.material_id === it.material_id && !a.site_id && a.active !== false && !assetBusy(a.id, b.id)); b.asset_id = a ? a.id : ''; }
        else { const s = S.stock.filter(s => s.material_id === it.material_id && !s.site_id).sort((x, y) => stockFree(y.id, b.id) - stockFree(x.id, b.id))[0]; b.stock_id = s ? s.id : ''; }
      }
      renderParts(); return true;
    }
    const it = S._items.get(id); const el = $('#sum-' + CSS.escape(id)); if (it && el) el.innerHTML = sumHTML(it);
    const sv = $('#save-' + CSS.escape(id)); if (sv) { sv.classList.add('primary'); sv.textContent = 'Lưu*'; }
    return true;
  }
  if (t.dataset.filter) { S.filters[t.dataset.filter] = t.type === 'checkbox' ? t.checked : t.value; onFilter(); return true; }
  return false;
});
const onFilter = debounce(() => renderParts(), 200);

async function receiveDialog(id) {
  const d = S.deliveries.find(x => x.id === id); if (!d) return;
  const it = S._items.get(d.item_id); const pr = it.pr;
  const needSerial = it.kind === 'tung_cai' && d.source === 'mua';
  let photos = [];
  const { action, data } = await modal({
    title: `Nhận hàng — ${pr.pr_no} · dòng ${it.line_no} · đợt ${d.batch_no}`,
    body: `<p><b>${esc(it.code)} ${esc(it.name)}</b> ${esc(it.spec)}<br><span class="small muted">Số lượng đợt này: <b>${fmtN(d.qty)} ${esc(it.unit)}</b> · ${sourceLabel(d, it)}</span></p>
      <div class="form">
        <label class="f"><span class="req">Số lượng thực nhận (${esc(it.unit)})</span><input id="rc-qty" inputmode="decimal" value="${numInput(d.qty)}"></label>
        <label class="f"><span class="req">Ngày nhận</span><input id="rc-date" type="date" max="${todayISO()}" value="${todayISO()}"></label>
        ${needSerial ? `<label class="f full">Biển số / số seri (mỗi chiếc cách nhau dấu phẩy)<input id="rc-serial" placeholder="vd: 51C-123.45, 51C-678.90"></label>` : ''}
      </div>
      <fieldset class="issues"><legend>Kiểm tra số lượng & chất lượng</legend>
        <label><input type="radio" name="rc-ok" value="ok" checked> ✔ Đủ số lượng, đúng chủng loại, đạt chất lượng</label>
        <label><input type="radio" name="rc-ok" value="issue"> ⚠ Có vấn đề:</label>
        <div class="issue-list">${Object.entries(ISSUES).map(([k, l]) => `<label><input type="checkbox" name="rc-issue" value="${k}"> ${l}</label>`).join('')}</div>
      </fieldset>
      <label class="f full mt"><span id="rc-note-lbl">Ghi chú</span><textarea id="rc-note" rows="3" placeholder="vd: Giao nhầm dây CV 4.0 thay vì CV 2.5 / Thiếu 2 cuộn / Thép bị gỉ nhiều…"></textarea></label>
      <div class="toolbar mt"><button class="btn sm" id="rc-photo" type="button">📷 Chụp / chọn ảnh hàng nhận</button><span class="small muted" id="rc-photo-n"></span></div>
      <div class="thumbs" id="rc-thumbs"></div>`,
    actions: [{ label: 'Huỷ', value: null }, { label: 'Xác nhận nhận hàng', value: 'ok', primary: true, validate: v => {
      const q = parseNum(v.qty);
      if (q == null || Number.isNaN(q) || q < 0) return 'Số lượng thực nhận không hợp lệ';
      if (v.date > todayISO()) return 'Ngày nhận không được sau hôm nay';
      if (v.mode === 'issue' && !v.issues.length && q === Number(d.qty)) return 'Chọn loại vấn đề';
      if ((v.issues.length || q !== Number(d.qty)) && !v.note.trim()) return 'Ghi chú vấn đề về số lượng / chất lượng';
      return null;
    } }],
    read: ov => ({ qty: $('#rc-qty', ov).value, date: $('#rc-date', ov).value, serials: needSerial ? $('#rc-serial', ov).value : null,
                   mode: ($('input[name=rc-ok]:checked', ov) || {}).value, note: $('#rc-note', ov).value,
                   issues: $('input[name=rc-ok]:checked', ov).value === 'issue' ? $$('input[name=rc-issue]:checked', ov).map(x => x.value) : [] }),
    onOpen: ov => {
      const qtyEl = $('#rc-qty', ov);
      const sync = () => {
        const q = parseNum(qtyEl.value); const short = q != null && q < Number(d.qty), over = q != null && q > Number(d.qty);
        if (short || over) { $('input[name=rc-ok][value=issue]', ov).checked = true; }
        $('input[name=rc-issue][value=thieu]', ov).checked = short || ($('input[name=rc-issue][value=thieu]', ov).checked && !over && q !== Number(d.qty));
        $('input[name=rc-issue][value=thua]', ov).checked = over;
        const issue = $('input[name=rc-ok]:checked', ov).value === 'issue';
        $('.issue-list', ov).classList.toggle('disabled', !issue);
        $('#rc-note-lbl', ov).className = issue ? 'req' : '';
      };
      qtyEl.addEventListener('input', sync);
      ov.addEventListener('change', e => { if (e.target.name === 'rc-issue' && e.target.checked) $('input[name=rc-ok][value=issue]', ov).checked = true; if (e.target.name === 'rc-ok' && e.target.value === 'ok') { $$('input[name=rc-issue]', ov).forEach(x => x.checked = false); qtyEl.value = numInput(d.qty); } sync(); });
      $('#rc-photo', ov).addEventListener('click', async () => {
        const imgs = await filesToImages(await pickFiles(true, true), {});
        photos = photos.concat(imgs).slice(0, 10);
        $('#rc-thumbs', ov).innerHTML = photos.map(im => `<figure class="thumb"><img src="${URL.createObjectURL(im.blob)}" alt=""></figure>`).join('');
        $('#rc-photo-n', ov).textContent = photos.length ? `${photos.length} ảnh` : '';
      });
      sync();
    },
  });
  if (action !== 'ok') return;
  const ok = await runAction(() => ctx.B.confirmReceipt(id, { qty: parseNum(data.qty), issues: data.issues, note: data.note, date: data.date, serials: data.serials }),
    data.issues.length || parseNum(data.qty) !== Number(d.qty) ? 'Đã ghi nhận — phòng vật tư sẽ xử lý vấn đề' : 'Đã xác nhận nhận hàng');
  if (ok && photos.length) {
    try { const files = await uploadImages(photos, () => ({ delivery_id: id })); await ctx.B.addAttachments(pr.pr_no, files); await hooks.pull(); hooks.refresh(); toast(`Đã đính kèm ${files.length} ảnh`, 'ok'); }
    catch (e) { toast('Đã xác nhận nhưng chưa tải được ảnh: ' + e.message, 'err'); }
  }
}

async function resolveDialog(id) {
  const d = S.deliveries.find(x => x.id === id); if (!d) return;
  const it = S._items.get(d.item_id);
  const partial = Number(d.qty_actual) > 0 && Number(d.qty_actual) < Number(d.qty);
  const iss = (d.receipt_issues || []).map(x => ISSUES[x] || x).join(', ');
  const { action, data } = await modal({
    title: `Xử lý vấn đề — ${it.pr.pr_no} · dòng ${it.line_no} · đợt ${d.batch_no}`,
    body: `<p><b>${esc(it.code)} ${esc(it.name)}</b><br>Đợt giao ${fmtN(d.qty)} ${esc(it.unit)} · thực nhận <b>${fmtN(d.qty_actual)}</b>
        <br><span class="late-text">${esc(iss)}</span>${d.receipt_note ? ` — “${esc(d.receipt_note)}”` : ''}<br><span class="small muted">Báo bởi ${esc(profName(d.confirmed_by))} ngày ${esc(fmtD(d.received_date))}</span></p>
      <fieldset class="issues"><legend>Cách xử lý</legend>
        <label><input type="radio" name="rs-act" value="chap_nhan" checked> <b>Chấp nhận</b> — ghi nhận như đã nhận ${fmtN(d.qty_actual)} ${esc(it.unit)}, đóng vấn đề</label>
        <label class="${partial ? '' : 'disabled'}"><input type="radio" name="rs-act" value="giao_bu" ${partial ? '' : 'disabled'}> <b>Giao bù phần thiếu</b> — chốt ${fmtN(d.qty_actual)}, tạo đợt mới ${partial ? fmtN(round6(d.qty - d.qty_actual)) : ''} ${esc(it.unit)}</label>
        <label class="${d.stock_moved ? 'disabled' : ''}"><input type="radio" name="rs-act" value="giao_lai" ${d.stock_moved ? 'disabled' : ''}> <b>Trả lại, giao lại</b> — huỷ đợt này (sai hàng / kém chất lượng), tạo đợt mới ${fmtN(d.qty)} ${esc(it.unit)}</label>
      </fieldset>
      <div class="form mt">
        <label class="f full"><span class="req">Ghi chú xử lý</span><textarea id="rs-note" rows="2" placeholder="vd: Đã liên hệ kho đổi sang dây CV 2.5, giao lại ngày mai"></textarea></label>
        <label class="f">Ngày về dự kiến đợt mới<input type="date" id="rs-eta" min="${todayISO()}"></label>
      </div>`,
    actions: [{ label: 'Huỷ', value: null }, { label: 'Xác nhận xử lý', value: 'ok', primary: true, validate: v => v.note.trim() ? null : 'Ghi chú cách xử lý' }],
    read: ov => ({ act: $('input[name=rs-act]:checked', ov).value, note: $('#rs-note', ov).value, eta: $('#rs-eta', ov).value }),
  });
  if (action === 'ok') runAction(() => ctx.B.resolveIssue(id, data.act, data.note, data.eta), 'Đã xử lý vấn đề');
}

Object.assign(ACT, {
  toggle: (b, e) => { if (e.target.closest('button,input,select,a,label')) return; const id = b.dataset.id; S.expanded.has(id) ? S.expanded.delete(id) : S.expanded.add(id); renderParts(); },
  kpi: b => { S.filters.kpi = S.filters.kpi === b.dataset.kpi ? '' : b.dataset.kpi; renderParts(); },
  'clear-filters': () => { S.filters = { q: '', site: '', status: '', from: '', to: '', mine: false, late: false, kpi: '' }; hooks.render(); },
  approve: b => runAction(() => ctx.B.approvePR(b.dataset.pr, true), `Đã duyệt ${b.dataset.pr} — đã lập kế hoạch giao`),
  reject: async b => {
    const { action, data } = await modal({ title: `Từ chối ${b.dataset.pr}`, body: '<label class="f">Lý do từ chối<textarea id="rj" rows="3"></textarea></label>',
      actions: [{ label: 'Huỷ', value: null }, { label: 'Từ chối', value: 'ok', danger: true, validate: v => v.trim() ? null : 'Cần ghi lý do từ chối' }], read: ov => $('#rj', ov).value });
    if (action === 'ok') runAction(() => ctx.B.approvePR(b.dataset.pr, false, data), `Đã từ chối ${b.dataset.pr}`);
  },
  cancel: async b => {
    const { action, data } = await modal({ title: `Huỷ ${b.dataset.pr}?`, body: '<p>Các đợt chưa nhận sẽ chuyển sang Huỷ, hàng đang giữ ở kho tổng được nhả ra.</p><label class="f">Lý do (không bắt buộc)<input id="cc"></label>',
      actions: [{ label: 'Không', value: null }, { label: 'Huỷ phiếu', value: 'ok', danger: true }], read: ov => $('#cc', ov).value });
    if (action === 'ok') runAction(() => ctx.B.cancelPR(b.dataset.pr, data), `Đã huỷ ${b.dataset.pr}`);
  },
  'pr-add-img': async b => {
    const imgs = await filesToImages(await pickFiles(true), {}); if (!imgs.length) return;
    runAction(async () => { const files = await uploadImages(imgs); await ctx.B.addAttachments(b.dataset.pr, files); }, `Đã thêm ${imgs.length} ảnh vào ${b.dataset.pr}`);
  },
  recall: async b => {
    const { action, data } = await modal({ title: `Thu hồi ${b.dataset.pr} để sửa?`,
      body: `<p>PR sẽ chuyển sang <b>Đã thu hồi – đang sửa</b>. Kế hoạch giao và hàng đang giữ ở kho tổng được nhả ra. Sau khi sửa và gửi lại, PR thành bản <b>R</b> tiếp theo và chờ duyệt lại.</p>
        <label class="f">Lý do (không bắt buộc)<input id="rc-reason" placeholder="vd: Đặt nhầm số lượng / nhầm quy cách"></label>`,
      actions: [{ label: 'Không', value: null }, { label: 'Thu hồi & sửa', value: 'ok', primary: true }], read: ov => $('#rc-reason', ov).value });
    if (action !== 'ok') return;
    const ok = await runAction(() => ctx.B.recallPR(b.dataset.pr, data), `Đã thu hồi ${b.dataset.pr}`);
    if (ok && ACT['load-pr-edit']) ACT['load-pr-edit']({ dataset: { id: b.dataset.id } });
  },
  receive: b => receiveDialog(b.dataset.id),
  resolve: b => resolveDialog(b.dataset.id),
  split: async b => {
    const id = b.dataset.item; const it = S._items.get(id); if (!it) return;
    const had = S.batchEdits.has(id); const bs = editBatches(id);
    const idx = bs.map((x, i) => i).reverse().find(i => OPEN_ST.includes(bs[i].status || 'cho_xu_ly') && (parseNum(bs[i].qty) || 0) > (it.kind === 'tung_cai' ? 1 : 0));
    if (idx == null) { if (!had) S.batchEdits.delete(id); return toast('Không còn đợt nào chưa nhận để chia', 'err'); }
    const src = bs[idx]; const srcQty = parseNum(src.qty);
    const { action, data } = await modal({
      title: `Chia đợt giao — dòng ${it.line_no}: ${it.name}`,
      body: `<p class="small">Tổng đặt <b>${fmtN(it.qty)} ${esc(it.unit)}</b>. Tách từ <b>Đợt ${idx + 1}</b> (hiện ${fmtN(srcQty)} ${esc(it.unit)}) sang một đợt mới.</p>
        <div class="form"><label class="f"><span class="req">Số lượng đợt mới (${esc(it.unit)})</span><input id="sp-qty" inputmode="decimal" value="${it.kind === 'tung_cai' ? Math.floor(srcQty / 2) || 1 : round6(srcQty / 2)}"></label>
        <label class="f">Nguồn đợt mới<select id="sp-src"><option value="mua">🛒 Mua mới</option><option value="kho" ${src.source === 'kho' ? 'selected' : ''}>🏬 Kho tổng</option></select></label>
        <label class="f">Ngày về dự kiến đợt mới<input type="date" id="sp-eta"></label></div>`,
      actions: [{ label: 'Huỷ', value: null }, { label: 'Chia', value: 'ok', primary: true,
        validate: v => { const q = parseNum(v.qty); return !(q > 0) ? 'Số lượng phải lớn hơn 0' : q >= srcQty ? `Phải nhỏ hơn ${fmtN(srcQty)}` : (it.kind === 'tung_cai' && !Number.isInteger(q)) ? 'Tài sản chia theo số nguyên' : null; } }],
      read: ov => ({ qty: $('#sp-qty', ov).value, eta: $('#sp-eta', ov).value, src: $('#sp-src', ov).value }),
    });
    if (action !== 'ok') { if (!had) S.batchEdits.delete(id); return; }
    const q = parseNum(data.qty);
    src.qty = String(round6(srcQty - q));
    const nb = { id: null, qty: String(q), source: data.src, stock_id: data.src === 'kho' && src.source === 'kho' ? src.stock_id : null, asset_id: null,
                 supplier: src.supplier, po_no: src.po_no, eta: data.eta || '', status: 'cho_xu_ly' };
    if (data.src === 'kho' && !nb.stock_id && it.kind !== 'tung_cai') { const s = S.stock.filter(s => s.material_id === it.material_id && !s.site_id).sort((x, y) => stockFree(y.id) - stockFree(x.id))[0]; nb.stock_id = s ? s.id : null; }
    bs.splice(idx + 1, 0, nb);
    renderParts(); toast('Đã chia — kiểm tra nguồn hàng rồi bấm Lưu', '');
  },
  'del-batch': b => {
    const id = b.dataset.item, idx = +b.dataset.idx; const bs = editBatches(id);
    const [rm] = bs.splice(idx, 1);
    const target = bs.find((x, i) => i >= Math.max(0, idx - 1) && OPEN_ST.includes(x.status || 'cho_xu_ly')) || bs.find(x => OPEN_ST.includes(x.status || 'cho_xu_ly'));
    if (target) target.qty = String(round6((parseNum(target.qty) || 0) + (parseNum(rm.qty) || 0)));
    renderParts(); toast('Đã gộp số lượng vào đợt khác — bấm Lưu để ghi lại', '');
  },
  'save-batches': b => saveBatches(b.dataset.item),
  bulk: async b => {
    const { action, data } = await modal({
      title: `Cập nhật nhanh cả phiếu — ${b.dataset.pr}`,
      body: `<p class="muted small">Áp dụng cho mọi đợt <b>chưa nhận</b> của tất cả các dòng. Chỉ những ô có nhập mới được áp dụng.</p><div class="form">
        <label class="f">Nhà cung cấp<input id="bk-sup"></label><label class="f">Số PO<input id="bk-po"></label>
        <label class="f">Ngày về dự kiến<input type="date" id="bk-eta"></label>
        <label class="f">Trạng thái<select id="bk-st"><option value="">(giữ nguyên)</option>${OPEN_ST.map(k => `<option value="${k}">${IT_ST[k][0]}</option>`).join('')}</select></label></div>`,
      actions: [{ label: 'Huỷ', value: null }, { label: 'Áp dụng', value: 'ok', primary: true }],
      read: ov => ({ supplier: $('#bk-sup', ov).value, po: $('#bk-po', ov).value, eta: $('#bk-eta', ov).value, status: $('#bk-st', ov).value }),
    });
    if (action === 'ok') runAction(() => ctx.B.updateItems(b.dataset.pr, null, data), `Đã cập nhật ${b.dataset.pr}`, () => { for (const [k, v] of S._items) if (v.pr.pr_no === b.dataset.pr) S.batchEdits.delete(k); });
  },
  'goto-pp': b => { S.tab = 'purchase'; S.pexpanded.add(b.dataset.id); hooks.render(); setTimeout(() => { const el = $(`[data-pp="${b.dataset.id}"]`); if (el) el.scrollIntoView({ block: 'center' }); }, 50); },
  'export-track': () => {
    const rows = [];
    for (const p of applyFilters(enrich())) for (const i of p.its) {
      const bs = i.batches.length ? i.batches : [null];
      bs.forEach(b => rows.push({
        'Số PR': p.pr_no, 'Tên PR': p.title, 'Ngày tạo': fmtD(p.created_date), 'Công trường': p.site_code, 'Người đặt': p.requester, 'Ngày cần': fmtD(p.need_date),
        'Trạng thái PR': (PR_ST[p.status] || [p.status])[0], 'Dòng': i.line_no, 'Mã VT': i.code, 'Vật tư': i.name, 'Quy cách': i.spec, 'SL đặt': Number(i.qty), 'ĐVT': i.unit,
        'Đợt': b ? b.batch_no : '', 'SL đợt': b ? Number(b.qty) : '', 'Nguồn': b ? (b.source === 'kho' ? 'Kho tổng' : 'Mua mới') : '',
        'NCC': (b ? b.supplier : i.supplier) || '', 'Số PO': (b ? b.po_no : i.po_no) || '', 'Ngày về dự kiến': fmtD(b ? b.eta : i.eta),
        'Ngày nhận': fmtD(b ? b.received_date : i.received_date), 'SL thực nhận': b && b.qty_actual != null ? Number(b.qty_actual) : '',
        'Vấn đề': b ? (b.receipt_issues || []).map(x => ISSUES[x]).join(', ') : '', 'Ghi chú nhận hàng': b ? b.receipt_note || '' : '',
        'Xử lý': b && b.resolution ? RESOLUTION[b.resolution] + ': ' + (b.resolution_note || '') : '',
        'Trạng thái': (IT_ST[b ? b.status : i.status] || [''])[0], 'Trễ hạn': i.late ? 'Có' : '',
      }));
    }
    exportRows(rows, `theo-doi-don-hang-${todayISO()}`, 'Theo dõi');
  },
});
