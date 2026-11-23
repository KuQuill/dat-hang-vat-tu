// Sheet 1 (Thông tin) và Sheet 2 (Đặt hàng)
import { S, ctx, ACT, VIEWS, INPUTS, KEY, LS, IDB, DEMO, CONFIG, hooks, $, $$, esc, norm, uid, todayISO, fmtD, fmtDT, fmtN, parseNum, isNet, debounce,
         toast, modal, confirmBox, ROLE, siteByCode, siteById, siteOptions, groupOptions, matchMaterials, MATCH, khoFree, kindOf, D,
         filesToImages, pickFiles, uploadImages, MAX_IMG_PER_PR, parsePaste, canOrder } from './core.js';

/* ---------- Nháp ---------- */
const newRow = () => ({ key: uid(), name: '', spec: '', unit: '', qty: '', note: '', group: '', material_id: null, code: null, force_new: false });
function loadDraft() {
  const d = LS.get(KEY.draft, null);
  S.draft = d && Array.isArray(d.rows) ? d : { title: '', site_code: '', category: '', need_date: '', delivery_place: '', receiver_name: '', receiver_phone: '', note: '', rows: [], editing: null };
  for (const k of ['title', 'category', 'delivery_place', 'receiver_name', 'receiver_phone']) if (S.draft[k] == null) S.draft[k] = '';
  if (S.draft.editing === undefined) S.draft.editing = null;
  if (!S.draft.rows.length) S.draft.rows = [newRow(), newRow(), newRow()];
}
const saveDraft = debounce(() => LS.set(KEY.draft, S.draft), 300);
const saveDraftImages = () => IDB.set(KEY.draftImgs, S.draftImages.map(({ id, row, name, blob }) => ({ id, row, name, blob })));
const imgURL = im => im._url || (im._url = URL.createObjectURL(im.blob));
document.addEventListener('app:init', async () => {
  loadDraft();
  const imgs = await IDB.get(KEY.draftImgs);
  if (Array.isArray(imgs)) S.draftImages = imgs.filter(im => im && im.blob);
});
document.addEventListener('app:before-render', () => hideAC());

/* =====================================================================
   SHEET 1 — THÔNG TIN
   ===================================================================== */
VIEWS.info = {
  title: 'Thông tin',
  html() {
    const p = S.profile || {}; const d = S.draft;
    if (!d.site_code && p.site_id) { const s = siteById(p.site_id); if (s) { d.site_code = s.code; saveDraft(); } }
    const s = siteByCode(d.site_code);
    return `<div class="grid cols-2">
      <section class="card">
        <h2>🏗 Dự án / công trường</h2>
        <div class="form">
          <label class="f full"><span class="req">Dự án / công trường</span><select data-h="site_code" ${d.editing ? 'disabled' : ''}>${siteOptions(d.site_code, '— Chọn dự án —')}</select></label>
          ${s ? `<dl class="kv full"><dt>Địa chỉ</dt><dd>${esc(s.address || '—')}</dd><dt>Chỉ huy trưởng</dt><dd>${esc(s.manager || '—')}</dd></dl>` : ''}
          <label class="f full">Ghi chú cho phòng vật tư<textarea data-h="note" rows="2">${esc(d.note)}</textarea></label>
        </div>
        <div class="toolbar mt"><span class="muted small">Tự động lưu nháp trên máy</span><span class="spacer"></span>
          ${canOrder() ? '<button class="btn primary" data-act="tab" data-tab="order">Tiếp tục → Khai báo vật tư</button>' : '<span class="small muted">Quyền Phòng vật tư không lập PR</span>'}</div>
      </section>
      <section class="card">
        <h2>👤 Người đặt hàng</h2>
        <div class="form">
          <label class="f">Họ tên<input id="pf-name" value="${esc(p.full_name)}"></label>
          <label class="f">Email đăng nhập<input value="${esc(p.email || S.user.email)}" readonly></label>
          <label class="f">Quyền<input value="${esc(ROLE[p.role] || '')}" readonly></label>
          <label class="f full">Dự án / công trường của tôi<select id="pf-site">${siteOptions(p.site_id ? (siteById(p.site_id) || {}).code : '')}</select></label>
        </div>
        <p class="small muted">Người cùng công trường được xác nhận nhận hàng thay cho nhau.</p>
        <div class="toolbar"><span class="spacer"></span><button class="btn" data-act="save-profile">Lưu thông tin cá nhân</button></div>
      </section>
      <section class="card">
        <h2>🔑 Đổi mật khẩu</h2>
        <div class="form">
          <label class="f">Mật khẩu mới<input id="pw1" type="password" autocomplete="new-password" placeholder="Tối thiểu 8 ký tự"></label>
          <label class="f">Nhập lại mật khẩu mới<input id="pw2" type="password" autocomplete="new-password"></label>
        </div>
        <div class="toolbar mt"><span class="muted small">Nên đổi mật khẩu công ty cấp ở lần đăng nhập đầu.</span><span class="spacer"></span><button class="btn" data-act="change-pw">Đổi mật khẩu</button></div>
      </section>
      <section class="card">
        <h2>🔄 Đồng bộ & ứng dụng</h2>
        <dl class="kv">
          <dt>Lần cập nhật cuối</dt><dd>${S.lastSync ? esc(fmtDT(S.lastSync)) : 'Chưa đồng bộ'}</dd>
          <dt>Đơn chờ gửi</dt><dd>${S.outbox.length}</dd>
          <dt>Danh mục</dt><dd>${S.materials.length} mã vật tư · ${S.assets.filter(a => a.active !== false).length} tài sản</dd>
          <dt>Phiên bản</dt><dd>v${esc(CONFIG.APP_VERSION)}${DEMO ? ' (demo)' : ''}</dd>
        </dl>
        <p class="muted small">Bấm <b>⟳ Update</b> để gửi đơn đang chờ và tải dữ liệu mới nhất. Khi mất mạng, đơn (kể cả ảnh) được lưu lại và tự gửi khi có mạng.</p>
        <p class="muted small">📱 Cài lên điện thoại: mở trang bằng Chrome/Safari → menu → <b>Thêm vào màn hình chính</b>.</p>
        ${DEMO ? '<button class="btn sm danger" data-act="demo-reset">Xoá dữ liệu demo, tạo lại từ đầu</button>' : ''}
      </section>
    </div>`;
  },
};

Object.assign(ACT, {
  'save-profile': async () => {
    try {
      await ctx.B.updateProfile({ full_name: $('#pf-name').value, phone: (S.profile || {}).phone || '', site_code: $('#pf-site').value });
      await hooks.pull(); toast('Đã lưu thông tin cá nhân', 'ok'); hooks.render();
    } catch (e) { toast(isNet(e) ? 'Không có kết nối mạng' : e.message, 'err'); }
  },
  'change-pw': async () => {
    const a = $('#pw1').value, b = $('#pw2').value;
    if (a.length < 8) return toast('Mật khẩu tối thiểu 8 ký tự', 'err');
    if (a !== b) return toast('Hai lần nhập mật khẩu không khớp', 'err');
    try { await ctx.B.changePassword(a); $('#pw1').value = $('#pw2').value = ''; toast('Đã đổi mật khẩu', 'ok'); }
    catch (e) { toast(isNet(e) ? 'Không có kết nối mạng' : e.message, 'err'); }
  },
});

/* =====================================================================
   SHEET 2 — ĐẶT HÀNG
   ===================================================================== */
function availText(r) {
  const q = parseNum(r.qty);
  if (r.material_id) {
    const m = D().mat.get(r.material_id); const free = khoFree(r.material_id); const unit = m ? m.unit : '';
    const tc = kindOf(r.material_id) === 'tung_cai';
    if (!(q > 0)) return `<span class="muted">Kho tổng còn trống: <b>${fmtN(free)}</b> ${esc(unit)}${tc ? ' (tài sản)' : ''}</span>`;
    if (q <= free) return `<span class="ok-text">✓ Kho tổng đủ (còn trống ${fmtN(free)} ${esc(unit)})</span>`;
    return `<span class="warn-text">⚠ Kho tổng còn ${fmtN(free)} → <b>cần mua mới ${fmtN(q - free)} ${esc(unit)}</b></span>`;
  }
  return r.name.trim() ? `<span class="warn-text">🛒 Chưa có trong kho → cần mua mới</span>` : '';
}
function rowStatus(r) {
  if (r.material_id) {
    const m = D().mat.get(r.material_id);
    return `<span class="badge b-green">✓ ${esc(m ? m.code : r.code)}</span><div class="small" data-av>${availText(r)}</div>`;
  }
  if (!r.name.trim()) return '';
  if (!r.force_new) {
    const best = matchMaterials(r.name + ' ' + r.spec, 1, MATCH)[0];
    if (best) return `<span class="badge b-amber">≈ Gần giống</span> <button class="linkbtn" data-act="pick-best" data-key="${r.key}" data-id="${best.m.id}">${esc(best.m.code)} ${esc(best.m.name)}</button>
      <div class="small muted">hoặc <button class="linkbtn" data-act="force-new" data-key="${r.key}">tạo mã mới</button></div>`;
  }
  const g = r.group || guessGroup(r.name + ' ' + r.spec); const gg = S.groups.find(x => x.code === g);
  return `<span class="badge b-blue">🆕 Mã mới tự động</span>
    <div class="grp"><select data-f="group" aria-label="Nhóm vật tư">${groupOptions(r.group, `Tự đoán: ${g}${gg ? ' — ' + gg.name : ''}`)}</select></div><div class="small" data-av>${availText(r)}</div>`;
}
function rowHTML(r, i) {
  const locked = !!r.material_id;
  const nImg = S.draftImages.filter(im => im.row === r.key).length;
  return `<tr data-row="${r.key}">
    <td class="c-idx">${i + 1}</td>
    <td class="c-code mono" data-code="${r.key}">${codeCell(r)}</td>
    <td class="c-name"><input data-f="name" value="${esc(r.name)}" placeholder="Gõ tên hoặc mã vật tư…" autocomplete="off"></td>
    <td class="c-spec"><input data-f="spec" value="${esc(r.spec)}" ${locked ? 'readonly' : ''}></td>
    <td class="c-unit"><input data-f="unit" value="${esc(r.unit)}" ${locked ? 'readonly' : ''}></td>
    <td class="c-qty"><input data-f="qty" value="${esc(r.qty)}" inputmode="decimal" class="right"></td>
    <td class="c-note"><input data-f="note" value="${esc(r.note)}"></td>
    <td class="c-st rowstat" data-st>${rowStatus(r)}</td>
    <td class="nowrap"><button class="btn sm ghost" data-act="add-img" data-key="${r.key}" title="Ảnh cho dòng này">📷${nImg ? `<span class="imgcount">${nImg}</span>` : ''}</button>
      <button class="btn sm ghost danger" data-act="del-row" data-key="${r.key}" title="Xoá dòng">✕</button></td>
  </tr>`;
}
function draftThumbsHTML() {
  if (!S.draftImages.length) return '<div class="muted small mt">Chưa có ảnh. Có thể chụp ảnh mẫu vật tư, bản vẽ, hiện trạng… để phòng vật tư dễ xử lý.</div>';
  const idx = new Map(S.draft.rows.map((r, i) => [r.key, i + 1]));
  return `<div class="thumbs">${S.draftImages.map(im => `<figure class="thumb"><img src="${imgURL(im)}" alt="${esc(im.name)}" data-act="view-local" data-id="${im.id}">
      <figcaption>${im.row ? 'Dòng ' + (idx.get(im.row) || '?') : 'Ảnh chung'} · ${esc(im.name)}</figcaption>
      <button class="x" data-act="del-img" data-id="${im.id}" title="Bỏ ảnh">✕</button></figure>`).join('')}</div>`;
}
VIEWS.order = {
  title: 'Đặt hàng',
  show: () => canOrder(),
  html() {
    const d = S.draft; const s = siteByCode(d.site_code);
    const ed = d.editing;
    return `<section class="card mb">
        ${ed ? `<div class="edit-banner">✏ Đang sửa <b class="mono">${esc(ed.pr_no)}</b> — gửi lại sẽ thành <b class="mono">${esc(ed.base_no)}.R${ed.revision + 1}</b> và chờ duyệt lại.
          <button class="btn sm" data-act="cancel-edit">Huỷ sửa</button></div>` : ''}
        <div class="form">
          <label class="f"><span class="req">Hạng mục thi công</span><select data-h="category" ${ed ? 'disabled' : ''}>${catOptions(d.category)}</select></label>
          <label class="f"><span class="req">Ngày cần có hàng</span><input type="date" data-h="need_date" min="${todayISO()}" value="${esc(d.need_date)}"></label>
          <label class="f full"><span class="req">Nơi nhận hàng</span><input data-h="delivery_place" value="${esc(d.delivery_place)}" placeholder="vd: Kho tạm cổng số 2, dự án SSD"></label>
          <label class="f"><span class="req">Người nhận hàng</span><input data-h="receiver_name" value="${esc(d.receiver_name)}" placeholder="Họ tên người nhận"></label>
          <label class="f"><span class="req">SĐT người nhận</span><input data-h="receiver_phone" value="${esc(d.receiver_phone)}" inputmode="tel" placeholder="vd: 0901 234 567"></label>
          <label class="f full">Diễn giải (không bắt buộc)<input data-h="title" value="${esc(d.title)}" maxlength="200" placeholder="vd: Ống cấp nước tầng 3"></label>
        </div>
        <div class="prcode mt">Số PR: <b class="mono" id="pr-code">${esc(prCodePreview())}</b></div>
        <div class="toolbar mt">
          <div class="small">Dự án: <b>${s ? esc(s.code + ' — ' + s.name) : '<span class="late-text">chưa chọn</span>'}</b>
            &nbsp;<button class="linkbtn" data-act="tab" data-tab="info">Đổi dự án</button></div>
          <span class="spacer"></span><span class="small muted">✓ có trong kho · ≈ gần giống · 🆕 mã mới · 🛒 cần mua mới</span>
        </div>
      </section>
      <div class="table-wrap"><table class="order-table">
        <thead><tr><th>#</th><th>Mã vật tư</th><th>Tên vật tư <span class="req"></span></th><th>Quy cách</th><th>ĐVT</th><th class="right">Số lượng <span class="req"></span></th><th>Ghi chú</th><th>Mã / tồn kho tổng</th><th></th></tr></thead>
        <tbody id="rows">${d.rows.map(rowHTML).join('')}</tbody>
      </table></div>
      <div class="toolbar mt">
        <button class="btn" data-act="add-row">＋ Thêm dòng</button>
        <button class="btn" data-act="paste">📋 Dán từ Excel</button>
        <button class="btn danger" data-act="clear-rows">Xoá hết</button>
      </div>
      <section class="card mt">
        <div class="toolbar"><h3>📷 Hình ảnh đính kèm</h3><span class="muted small">Tối đa ${MAX_IMG_PER_PR} ảnh, tự động nén. Ảnh theo từng dòng: bấm 📷 ở cuối dòng.</span>
          <span class="spacer"></span><button class="btn" data-act="add-img">＋ Thêm ảnh chung</button></div>
        <div id="draft-thumbs">${draftThumbsHTML()}</div>
      </section>
      <div class="toolbar mt">
        <span class="small muted">Nháp (kể cả ảnh) tự lưu trên máy. Phần kho tổng không đủ sẽ được phòng vật tư lập đề xuất mua.</span><span class="spacer"></span>
        <button class="btn primary" data-act="submit" id="btn-submit">${d.editing ? 'Gửi lại PR đã sửa' : 'Gửi đơn hàng (PR)'}</button>
      </div>`;
  },
};
function refreshRow(key) {
  const r = S.draft.rows.find(x => x.key === key); const tr = $(`tr[data-row="${key}"]`);
  if (!r || !tr) return;
  const tmp = document.createElement('tbody'); tmp.innerHTML = rowHTML(r, S.draft.rows.indexOf(r));
  tr.replaceWith(tmp.firstElementChild);
}
function refreshRowStatus(key) { const r = S.draft.rows.find(x => x.key === key); const td = $(`tr[data-row="${key}"] [data-st]`); if (r && td) td.innerHTML = rowStatus(r); }
function refreshAvail(key) { const r = S.draft.rows.find(x => x.key === key); const el = $(`tr[data-row="${key}"] [data-av]`); if (r && el) el.innerHTML = availText(r); }
const refreshDraftThumbs = () => { const el = $('#draft-thumbs'); if (el) el.innerHTML = draftThumbsHTML(); };
function pickMaterial(key, id) {
  const r = S.draft.rows.find(x => x.key === key); const m = D().mat.get(id);
  if (!r || !m) return;
  Object.assign(r, { material_id: m.id, code: m.code, name: m.name, spec: m.spec || '', unit: m.unit, force_new: false, group: '' });
  saveDraft(); refreshRow(key); refreshCodes();
  const q = $(`tr[data-row="${key}"] [data-f="qty"]`); if (q) q.focus();
}

/* Gợi ý vật tư khi gõ */
const AC = { input: null, key: null, list: [], idx: -1 };
function showAC(input, key) {
  const q = input.value.trim(); const el = $('#ac');
  if (q.length < 2) return hideAC();
  AC.list = matchMaterials(q, 8, 0.25); AC.input = input; AC.key = key; AC.idx = -1;
  if (!AC.list.length) return hideAC();
  el.innerHTML = AC.list.map(({ m }, i) => `<div class="ac-item" data-i="${i}" role="option"><b class="mono">${esc(m.code)}</b> ${esc(m.name)}
      <div class="meta">${esc(m.spec || '')}${m.spec ? ' · ' : ''}${esc(m.unit)} · Kho tổng trống: <b>${fmtN(khoFree(m.id))}</b></div></div>`).join('');
  const r = input.getBoundingClientRect();
  el.style.left = (r.left + window.scrollX) + 'px'; el.style.top = (r.bottom + window.scrollY + 2) + 'px';
  el.style.width = Math.max(r.width, 340) + 'px'; el.style.display = 'block';
}
function hideAC() { const el = $('#ac'); if (el) el.style.display = 'none'; AC.input = null; AC.list = []; AC.idx = -1; }
function moveAC(d) {
  if (!AC.list.length) return;
  AC.idx = (AC.idx + d + AC.list.length) % AC.list.length;
  $$('#ac .ac-item').forEach((x, i) => x.classList.toggle('sel', i === AC.idx));
  const sel = $('#ac .ac-item.sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
}
document.addEventListener('mousedown', e => {
  const it = e.target.closest('.ac-item');
  if (it) { e.preventDefault(); const x = AC.list[+it.dataset.i]; if (x) pickMaterial(AC.key, x.m.id); hideAC(); }
});
document.addEventListener('keydown', e => {
  if (e.target.dataset && e.target.dataset.f === 'name' && $('#ac').style.display === 'block') {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveAC(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveAC(-1); }
    else if (e.key === 'Enter' && AC.idx >= 0) { e.preventDefault(); pickMaterial(AC.key, AC.list[AC.idx].m.id); hideAC(); }
    else if (e.key === 'Escape') hideAC();
  }
});
document.addEventListener('focusout', e => { if (e.target.dataset && e.target.dataset.f === 'name') setTimeout(() => { if (document.activeElement !== AC.input) hideAC(); }, 120); });
window.addEventListener('resize', hideAC);

INPUTS.push(e => {
  const t = e.target; const tr = t.closest('tr[data-row]');
  if (tr && t.dataset.f) {
    const r = S.draft.rows.find(x => x.key === tr.dataset.row); if (!r) return true;
    const f = t.dataset.f;
    if (f === 'name') {
      r.name = t.value;
      if (r.material_id && e.type === 'input') { r.material_id = null; r.code = null; $$('[data-f="spec"],[data-f="unit"]', tr).forEach(x => x.readOnly = false); }
      r.force_new = false;
      if (e.type === 'input') showAC(t, r.key);
    } else r[f] = t.value;
    saveDraft();
    if (f === 'name' || f === 'spec' || f === 'group') { if (f !== 'group') refreshRowStatus(r.key); refreshCodes(); }
    if (f === 'qty') refreshAvail(r.key);
    return true;
  }
  if (t.dataset.h) {
    S.draft[t.dataset.h] = t.value; saveDraft();
    if (t.dataset.h === 'site_code' && e.type === 'change') hooks.render();
    if (t.dataset.h === 'category') { const el = $('#pr-code'); if (el) el.textContent = prCodePreview(); }
    return true;
  }
  return false;
});

async function addDraftImages(rowKey) {
  const room = MAX_IMG_PER_PR - S.draftImages.length;
  if (room <= 0) return toast(`Tối đa ${MAX_IMG_PER_PR} ảnh cho một PR`, 'err');
  let files = await pickFiles(true);
  if (files.length > room) { toast(`Chỉ thêm được ${room} ảnh nữa`, 'err'); files = files.slice(0, room); }
  const imgs = await filesToImages(files, { row: rowKey || null });
  if (!imgs.length) return;
  S.draftImages.push(...imgs); saveDraftImages();
  refreshDraftThumbs(); if (rowKey) refreshRow(rowKey);
}

async function pasteFromExcel() {
  const { action, data } = await modal({
    title: 'Dán danh sách vật tư từ Excel',
    body: `<p class="muted small">Copy các cột theo thứ tự: <b>Tên vật tư (hoặc mã) · Quy cách · ĐVT · Số lượng · Ghi chú</b> rồi dán vào ô dưới.</p>
           <textarea id="paste-box" rows="10" placeholder="Thép thanh vằn D16\tCB400\ttấn\t5"></textarea>`,
    actions: [{ label: 'Huỷ', value: null }, { label: 'Thêm vào đơn', value: 'ok', primary: true }],
    read: ov => $('#paste-box', ov).value,
  });
  if (action !== 'ok' || !data.trim()) return;
  const rows = parsePaste(data);
  S.draft.rows = S.draft.rows.filter(r => r.name.trim() || String(r.qty).trim());
  for (const c of rows) {
    const r = newRow(); Object.assign(r, { name: c[0] || '', spec: c[1] || '', unit: c[2] || '', qty: c[3] || '', note: c[4] || '' });
    const exact = S.materials.find(m => m.code.toLowerCase() === r.name.toLowerCase());
    if (exact) Object.assign(r, { material_id: exact.id, code: exact.code, name: exact.name, spec: exact.spec || '', unit: r.unit || exact.unit });
    S.draft.rows.push(r);
  }
  saveDraft(); hooks.render(); toast(`Đã thêm ${rows.length} dòng`, 'ok');
}

async function submitOrder() {
  const d = S.draft; const errs = [];
  if (!siteByCode(d.site_code)) errs.push('Chưa chọn dự án / công trường (Sheet 1)');
  if (!d.category) errs.push('Chưa chọn hạng mục thi công');
  if (!d.delivery_place.trim()) errs.push('Chưa nhập nơi nhận hàng');
  if (!d.receiver_name.trim()) errs.push('Chưa nhập tên người nhận hàng');
  if (!d.receiver_phone.trim()) errs.push('Chưa nhập số điện thoại người nhận');
  else if (!/^[0-9 +().-]{8,20}$/.test(d.receiver_phone.trim())) errs.push('Số điện thoại người nhận không hợp lệ');
  if (!d.need_date) errs.push('Chưa chọn ngày cần có hàng');
  else if (d.need_date < todayISO()) errs.push('Ngày cần có hàng đã qua');
  const rows = d.rows.filter(r => r.name.trim() || String(r.qty).trim());
  if (!rows.length) errs.push('Chưa có dòng vật tư nào');
  rows.forEach((r, i) => {
    const q = parseNum(r.qty);
    if (!r.name.trim()) errs.push(`Dòng ${i + 1}: thiếu tên vật tư`);
    if (q == null || Number.isNaN(q) || q <= 0) errs.push(`Dòng ${i + 1}: số lượng không hợp lệ`);
    if (r.material_id && kindOf(r.material_id) === 'tung_cai' && q > 0 && !Number.isInteger(q)) errs.push(`Dòng ${i + 1}: tài sản/thiết bị phải đặt số nguyên`);
  });
  const showErrs = async list => {
    await modal({ title: 'Đơn hàng chưa đủ thông tin', body: `<ul>${list.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`, actions: [{ label: 'Đã hiểu', value: 'ok', primary: true }] });
    if (list.some(e => e.includes('Sheet 1'))) { S.tab = 'info'; hooks.render(); }
  };
  if (errs.length) return showErrs(errs);

  const amb = rows.map(r => ({ r, list: r.material_id || r.force_new ? [] : matchMaterials(r.name + ' ' + r.spec, 4, MATCH) })).filter(x => x.list.length);
  if (amb.length) {
    const { action, data } = await modal({
      title: 'Kiểm tra vật tư trùng với kho',
      body: `<p class="muted small">Các dòng dưới đây giống vật tư đã có trong kho. Chọn mã đúng để tránh tạo mã trùng.</p>` +
        amb.map(({ r, list }) => `<div class="resolve"><div><b>Dòng ${rows.indexOf(r) + 1}:</b> “${esc(r.name)}${r.spec ? ' ' + esc(r.spec) : ''}”</div>
          ${list.map(({ m }, i) => `<label><input type="radio" name="rs-${r.key}" value="${m.id}" ${i === 0 ? 'checked' : ''}>
            <span><b class="mono">${esc(m.code)}</b> ${esc(m.name)} <span class="muted">${esc(m.spec || '')} · ${esc(m.unit)} · kho trống ${fmtN(khoFree(m.id))}</span></span></label>`).join('')}
          <label><input type="radio" name="rs-${r.key}" value="__new"><span>🆕 Không phải — tạo mã mới</span></label></div>`).join(''),
      actions: [{ label: 'Quay lại', value: null }, { label: 'Xác nhận', value: 'ok', primary: true }],
      read: ov => Object.fromEntries(amb.map(({ r }) => [r.key, ($(`input[name="rs-${r.key}"]:checked`, ov) || {}).value])),
    });
    if (action !== 'ok') return;
    for (const { r } of amb) {
      const v = data[r.key];
      if (v === '__new') r.force_new = true;
      else if (v) { const m = D().mat.get(v); Object.assign(r, { material_id: m.id, code: m.code, name: m.name, spec: m.spec || '', unit: r.unit || m.unit }); }
    }
    saveDraft(); $$('#rows tr[data-row]').forEach(tr => refreshRow(tr.dataset.row));
  }
  const noUnit = rows.map((r, i) => (!r.material_id && !r.unit.trim()) ? `Dòng ${i + 1}: vật tư mới “${r.name.trim()}” cần có đơn vị tính` : null).filter(Boolean);
  if (noUnit.length) return showErrs(noUnit);

  const payload = {
    title: d.title.trim(), site_code: d.site_code, category: d.category, need_date: d.need_date, note: d.note, delivery_place: d.delivery_place.trim(), receiver_name: d.receiver_name.trim(), receiver_phone: d.receiver_phone.trim(),
    items: rows.map(r => r.material_id
      ? { material_id: r.material_id, qty: parseNum(r.qty), unit: r.unit.trim() || null, note: r.note.trim() || null }
      : { name: r.name.trim(), spec: r.spec.trim() || null, unit: r.unit.trim(), group: r.group || null, qty: parseNum(r.qty), note: r.note.trim() || null, force_new: !!r.force_new }),
  };
  const wasEdit = !!d.editing;
  const lineOf = im => (im.row ? (rows.findIndex(r => r.key === im.row) + 1) || null : null);
  const imgs = S.draftImages.filter(im => !im.row || rows.some(r => r.key === im.row));
  const btn = $('#btn-submit'); if (btn) { btn.disabled = true; btn.textContent = imgs.length ? 'Đang tải ảnh và gửi…' : 'Đang gửi…'; }
  try {
    payload.attachments = await uploadImages(imgs, im => ({ line: lineOf(im) }));
    const res = d.editing ? await ctx.B.updatePR(d.editing.pr_no, payload) : await ctx.B.createPR(payload);
    await clearDraftAfterSend();
    await hooks.pull().catch(() => {});
    hooks.render();
    const { action } = await modal({
      title: `✅ Đã ${wasEdit ? 'gửi lại' : 'tạo'} ${res.pr_no} — Chờ duyệt`,
      body: `<p>${res.title && res.title !== res.pr_no ? `<b>${esc(res.title)}</b><br>` : ''}Dự án <b>${esc(res.site)}</b> · cần ngày <b>${esc(fmtD(res.need_date))}</b>${res.images ? ` · ${res.images} ảnh` : ''}</p>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>Mã</th><th>Vật tư</th><th class="right">SL</th><th>ĐVT</th><th>Kho tổng</th></tr></thead><tbody>
        ${res.items.map(it => { const free = khoFree(it.id); return `<tr><td>${it.line}</td><td class="mono nowrap">${it.created ? '🆕 ' : ''}${esc(it.code)}</td>
          <td>${esc(it.name)}${it.input_name && norm(it.input_name) !== norm(it.name) && !it.created ? `<div class="small muted">bạn gõ: “${esc(it.input_name)}”</div>` : ''}</td>
          <td class="right">${fmtN(it.qty)}</td><td>${esc(it.unit)}</td>
          <td class="small">${free >= it.qty ? '<span class="ok-text">Đủ</span>' : `<span class="warn-text">Cần mua ${fmtN(it.qty - free)}</span>`}</td></tr>`; }).join('')}
        </tbody></table></div>`,
      actions: [{ label: 'Đặt đơn khác', value: 'new' }, { label: '⬇ Xuất PDF để ký', value: 'pdf' }, { label: 'Xem ở Theo dõi', value: 'track', primary: true }],
    });
    if (action === 'pdf' && ACT['pr-pdf']) ACT['pr-pdf']({ dataset: { id: res.id } });
    if (action === 'track') { S.tab = 'track'; S.filters = { ...S.filters, q: res.pr_no, status: '', kpi: '' }; LS.set(KEY.tab, S.tab); hooks.render(); }
  } catch (e) {
    if (isNet(e) && !d.editing) {
      const id = uid();
      await IDB.set(KEY.obImgs(id), imgs.map(im => ({ blob: im.blob, name: im.name, line: lineOf(im) })));
      delete payload.attachments;
      S.outbox.push({ id, created_at: new Date().toISOString(), payload, error: null, label: `${payload.title} · ${d.site_code} · ${rows.length} dòng${imgs.length ? ` · ${imgs.length} ảnh` : ''}` });
      LS.set(KEY.outbox, S.outbox); await clearDraftAfterSend(); hooks.render();
      toast('Mất kết nối — đơn đã được lưu, sẽ tự gửi khi có mạng / bấm Update', 'ok');
    } else {
      toast('Không gửi được: ' + e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = 'Gửi đơn hàng (PR)'; }
    }
  }
}
async function clearDraftAfterSend() {
  S.draft.rows = [newRow(), newRow(), newRow()]; S.draft.note = ''; S.draft.title = ''; S.draft.editing = null; LS.set(KEY.draft, S.draft);
  S.draftImages.forEach(im => im._url && URL.revokeObjectURL(im._url)); S.draftImages = []; await IDB.del(KEY.draftImgs);
}

// Đoán nhóm vật tư theo từ khoá (giống máy chủ) → dùng để hiện mã mới dự kiến
function guessGroup(q) {
  const n = ' ' + norm(q) + ' ';
  for (const g of [...S.groups].filter(g => g.active !== false).sort((a, b) => a.priority - b.priority))
    if ((g.keywords || []).some(k => n.includes(' ' + k + ' '))) return g.code;
  return 'K';
}
// Mã mới dự kiến cho các dòng vật tư chưa có trong kho (đánh số tiếp theo trong nhóm)
function predictedCodes() {
  const out = new Map(); const next = new Map();
  for (const r of S.draft.rows) {
    if (r.material_id || !r.name.trim()) continue;
    if (!r.force_new && matchMaterials(r.name + ' ' + r.spec, 1, MATCH).length) continue;
    const g = r.group || guessGroup(r.name + ' ' + r.spec);
    if (!next.has(g)) {
      let mx = Number((S.groups.find(x => x.code === g) || {}).seq) || 0;
      for (const m of S.materials) if (m.code.startsWith(g + '-')) mx = Math.max(mx, parseInt(m.code.slice(g.length + 1), 10) || 0);
      next.set(g, mx);
    }
    next.set(g, next.get(g) + 1);
    out.set(r.key, `${g}-${String(next.get(g)).padStart(4, '0')}`);
  }
  return out;
}
function codeCell(r, pc) {
  if (r.material_id) { const m = D().mat.get(r.material_id); return `<b>${esc(m ? m.code : r.code || '')}</b>`; }
  const c = (pc || predictedCodes()).get(r.key);
  return c ? `<span class="new-code" title="Mã tự động cấp khi gửi PR">🆕 ${esc(c)}</span><div class="small muted">dự kiến</div>` : '<span class="muted">—</span>';
}
function refreshCodes() { const pc = predictedCodes(); for (const r of S.draft.rows) { const el = $(`[data-code="${r.key}"]`); if (el) el.innerHTML = codeCell(r, pc); } }

function catOptions(sel) {
  return '<option value="">— Chọn hạng mục thi công —</option>' + (S.workCats || []).filter(g => g.active !== false || g.code === sel)
    .map(g => `<option value="${esc(g.code)}" ${g.code === sel ? 'selected' : ''}>${esc(g.code)} — ${esc(g.name)}</option>`).join('');
}
function prCodePreview() {
  const d = S.draft;
  if (d.editing) return `${d.editing.base_no}.R${d.editing.revision + 1} (sau khi gửi lại)`;
  const s = siteByCode(d.site_code);
  if (!s || !d.category) return 'chọn dự án và hạng mục thi công để tạo số PR';
  const prefix = `${s.code}.${d.category}.PR`.toUpperCase();
  let n = 0;
  for (const p of S.prs) { const b = (p.base_no || '').toUpperCase(); if (b.startsWith(prefix)) n = Math.max(n, parseInt(b.slice(prefix.length), 10) || 0); }
  return `${s.code}.${d.category}.PR${String(n + 1).padStart(2, '0')}.R1 (dự kiến)`;
}
// Nạp PR (đã thu hồi) vào form để sửa
function loadPRForEdit(prId) {
  const pr = S.prs.find(x => x.id === prId); if (!pr) return toast('Không tìm thấy PR', 'err');
  const site = siteById(pr.site_id) || {};
  const its = S.items.filter(i => i.pr_id === pr.id).sort((a, b) => a.line_no - b.line_no);
  S.draft = { title: pr.title && pr.title !== pr.pr_no ? pr.title : '', site_code: site.code || '', category: pr.category || '', need_date: pr.need_date < todayISO() ? '' : pr.need_date,
    delivery_place: pr.delivery_place || '', receiver_name: pr.receiver_name || '', receiver_phone: pr.receiver_phone || '', note: pr.note || '',
    editing: { id: pr.id, pr_no: pr.pr_no, base_no: pr.base_no || pr.pr_no.replace(/\.R\d+$/, ''), revision: pr.revision || 1 },
    rows: its.map(i => { const m = D().mat.get(i.material_id) || {}; return Object.assign(newRow(), { material_id: i.material_id, code: m.code, name: m.name || '', spec: m.spec || '', unit: i.unit, qty: String(i.qty), note: i.note || '' }); }) };
  if (!S.draft.rows.length) S.draft.rows = [newRow()];
  S.draftImages = []; saveDraftImages(); LS.set(KEY.draft, S.draft);
  S.tab = 'order'; LS.set(KEY.tab, S.tab); hooks.render(); window.scrollTo(0, 0);
  toast(`Đang sửa ${pr.pr_no} — sửa xong bấm "Gửi lại PR đã sửa"`, '');
}

Object.assign(ACT, {
  'load-pr-edit': b => loadPRForEdit(b.dataset.id),
  'cancel-edit': async () => {
    if (!(await confirmBox('Huỷ sửa?', '<p>Nội dung đang sửa sẽ bị bỏ. PR vẫn ở trạng thái <b>đã thu hồi</b> — có thể tiếp tục sửa hoặc huỷ phiếu ở màn hình Theo dõi.</p>', 'Huỷ sửa', true))) return;
    S.draft.editing = null; S.draft.rows = [newRow(), newRow(), newRow()]; S.draft.title = ''; LS.set(KEY.draft, S.draft); hooks.render();
  },
  'add-row': () => { const r = newRow(); S.draft.rows.push(r); saveDraft(); const tmp = document.createElement('tbody'); tmp.innerHTML = rowHTML(r, S.draft.rows.length - 1); $('#rows').appendChild(tmp.firstElementChild); $(`tr[data-row="${r.key}"] [data-f="name"]`).focus(); },
  'del-row': b => {
    const k = b.dataset.key; S.draft.rows = S.draft.rows.filter(r => r.key !== k); if (!S.draft.rows.length) S.draft.rows.push(newRow());
    if (S.draftImages.some(im => im.row === k)) { S.draftImages = S.draftImages.filter(im => im.row !== k); saveDraftImages(); }
    saveDraft(); hooks.render();
  },
  'clear-rows': async () => {
    if (!(await confirmBox('Xoá hết các dòng?', '<p>Toàn bộ vật tư đang nhập và ảnh đính kèm sẽ bị xoá.</p>', 'Xoá hết', true))) return;
    S.draft.rows = [newRow(), newRow(), newRow()]; S.draftImages = []; saveDraftImages(); saveDraft(); hooks.render();
  },
  paste: () => pasteFromExcel(),
  'add-img': b => addDraftImages(b.dataset.key || null),
  'del-img': b => { const im = S.draftImages.find(x => x.id === b.dataset.id); S.draftImages = S.draftImages.filter(x => x.id !== b.dataset.id); saveDraftImages(); refreshDraftThumbs(); if (im && im.row) refreshRow(im.row); },
  'view-local': b => { const im = S.draftImages.find(x => x.id === b.dataset.id); if (im) modal({ title: im.name, wide: true, body: `<img class="viewer" src="${imgURL(im)}" alt="">`, actions: [{ label: 'Đóng', value: null }] }); },
  'pick-best': b => pickMaterial(b.dataset.key, b.dataset.id),
  'force-new': b => { const r = S.draft.rows.find(x => x.key === b.dataset.key); if (r) { r.force_new = true; saveDraft(); refreshRowStatus(r.key); refreshCodes(); } },
  submit: () => submitOrder(),
  'ob-edit': async b => {
    const o = S.outbox.find(x => x.id === b.dataset.id); if (!o) return;
    const p = o.payload;
    S.draft = { title: p.title || '', site_code: p.site_code, category: p.category || '', editing: null, need_date: p.need_date, delivery_place: p.delivery_place || '', receiver_name: p.receiver_name || '', receiver_phone: p.receiver_phone || '', note: p.note || '',
      rows: p.items.map(it => { const r = newRow(); const m = it.material_id && D().mat.get(it.material_id);
        return Object.assign(r, m ? { material_id: m.id, code: m.code, name: m.name, spec: m.spec || '', unit: it.unit || m.unit } : { name: it.name || '', spec: it.spec || '', unit: it.unit || '', group: it.group || '', force_new: !!it.force_new },
          { qty: String(it.qty ?? ''), note: it.note || '' }); }) };
    const imgs = (await IDB.get(KEY.obImgs(o.id))) || [];
    S.draftImages = imgs.map(im => ({ id: uid(), row: im.line ? (S.draft.rows[im.line - 1] || {}).key || null : null, name: im.name, blob: im.blob }));
    saveDraftImages(); IDB.del(KEY.obImgs(o.id));
    S.outbox = S.outbox.filter(x => x.id !== o.id); LS.set(KEY.outbox, S.outbox); LS.set(KEY.draft, S.draft);
    S.tab = 'order'; hooks.render(); toast('Đã mở lại đơn — sửa xong bấm Gửi', '');
  },
  'ob-del': async b => {
    if (!(await confirmBox('Xoá đơn chờ gửi?', '<p>Đơn này chưa được gửi lên hệ thống và sẽ bị xoá khỏi máy.</p>', 'Xoá', true))) return;
    S.outbox = S.outbox.filter(o => o.id !== b.dataset.id); LS.set(KEY.outbox, S.outbox); IDB.del(KEY.obImgs(b.dataset.id)); hooks.renderChrome(); hooks.refresh();
  },
});
