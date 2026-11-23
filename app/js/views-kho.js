// Sheet 4 — Kho & tài sản: vật tư theo số lượng · tài sản từng chiếc (QR) · nhóm vật tư
import { S, ctx, ACT, VIEWS, INPUTS, CONFIG, hooks, $, $$, esc, norm, todayISO, fmtD, fmtDT, fmtN, numInput, parseNum, round6, debounce,
         toast, modal, confirmBox, runAction, COND, KIND, USABLE, OPEN_ST, badge, siteById, locLabel, profName, isStaff, D, groupName,
         stockFree, khoFree, locOptions, condOptions, groupOptions, subgroupOptions, matchMaterials, MATCH, loadVisibleImages, imgTag,
         pickFiles, compressImage, exportRows, downloadText, parsePaste } from './core.js';

const locFilter = (siteId, f) => !f || (f === 'kho' ? !siteId : (siteById(siteId) || {}).code === f);
const locCell = (siteId, detail) => `${siteId ? `<b>${esc((siteById(siteId) || {}).code || '?')}</b> <span class="small muted">${esc((siteById(siteId) || {}).name || '')}</span>` : '<b>Kho tổng</b>'}${detail ? `<div class="small muted">${esc(detail)}</div>` : ''}`;
const matCell = m => `<span class="mono">${esc(m.code)}</span>${m.is_new ? ' <span class="badge b-blue" title="Mã mới, chờ rà soát">mới</span>' : ''} ${esc(m.name)}<div class="small muted">${esc(m.spec || '')}${m.spec ? ' · ' : ''}${esc(groupName(m.group_code))}${m.subgroup_id && D().sub.get(m.subgroup_id) ? ' › ' + esc(D().sub.get(m.subgroup_id).name) : ''}</div>`;

VIEWS.kho = {
  title: 'Kho & tài sản',
  html() {
    return `<div class="subtabs">
        <button class="subtab" data-act="kho-tab" data-k="stock" aria-selected="${S.khoTab === 'stock'}">📦 Vật tư (theo số lượng)</button>
        <button class="subtab" data-act="kho-tab" data-k="assets" aria-selected="${S.khoTab === 'assets'}">🚜 Tài sản – thiết bị (từng chiếc)</button>
        <span class="spacer"></span>
        ${isStaff() ? '<button class="btn sm" data-act="groups">🗂 Nhóm vật tư</button>' : ''}
      </div>
      <div id="kho-body">${S.khoTab === 'assets' ? assetsShell() : stockShell()}</div>`;
  },
  after() { S.khoTab === 'assets' ? renderAssets() : renderStock(); },
  refresh() { if ($('#kho-body')) VIEWS.kho.after(); else hooks.render(); },
};

/* =====================================================================
   VẬT TƯ THEO SỐ LƯỢNG
   ===================================================================== */
function stockShell() {
  const f = S.sfilters; const staff = isStaff();
  return `<div id="stock-kpis"></div>
    <div class="filters f4">
      <input data-sfilter="q" value="${esc(f.q)}" placeholder="🔍 Tìm mã, tên, quy cách, vị trí…">
      <select data-sfilter="group">${groupOptions(f.group, 'Tất cả nhóm', 'so_luong')}</select>
      <select data-sfilter="loc">${locOptions(f.loc, true)}</select>
      <select data-sfilter="cond">${condOptions(f.cond, 'Mọi tình trạng')}</select>
      <div class="checks">
        <label><input type="checkbox" data-sfilter="has" ${f.has ? 'checked' : ''}> Chỉ dòng có tồn</label>
        <label><input type="checkbox" data-sfilter="low" ${f.low ? 'checked' : ''}> Dưới mức tối thiểu</label>
        <span class="spacer"></span>
        ${staff ? `<button class="btn sm" data-act="stock-new">＋ Vật tư mới</button><button class="btn sm" data-act="stock-import">📋 Nhập từ Excel</button><button class="btn sm" data-act="stock-template">⬇ File mẫu</button>` : ''}
        <button class="btn sm" data-act="stock-export">⬇ Xuất Excel</button>
      </div>
    </div>
    ${staff ? '' : '<p class="small muted mb-s">Chỉ phòng vật tư / quản trị được cập nhật tồn kho.</p>'}
    <div id="stock-table"></div>`;
}
function stockRows() {
  const f = S.sfilters, q = norm(f.q), dd = D();
  const rows = S.stock.map(s => ({ s, m: dd.mat.get(s.material_id) })).filter(x => x.m);
  if (!f.has && (!f.loc || f.loc === 'kho')) {
    const withRow = new Set(S.stock.filter(s => !s.site_id).map(s => s.material_id));
    for (const m of S.materials) if (m.active !== false && (dd.grp.get(m.group_code) || {}).kind !== 'tung_cai' && !withRow.has(m.id)) rows.push({ s: null, m });
  }
  return rows.filter(({ s, m }) => {
    if ((dd.grp.get(m.group_code) || {}).kind === 'tung_cai') return false;
    if (f.group && m.group_code !== f.group) return false;
    if (s && !locFilter(s.site_id, f.loc)) return false;
    if (f.cond && (!s || s.condition !== f.cond)) return false;
    if (f.has && !(s && Number(s.qty) > 0)) return false;
    if (f.low && !(s && !s.site_id && s.min_qty != null && Number(s.qty) < Number(s.min_qty))) return false;
    if (q) { const hay = norm([m.code, m.name, m.spec, s && s.location_detail, s && locLabel(s.site_id)].join(' ')); if (!q.split(' ').every(w => hay.includes(w))) return false; }
    return true;
  }).sort((a, b) => a.m.code.localeCompare(b.m.code) || (a.s && a.s.site_id ? 1 : 0) - (b.s && b.s.site_id ? 1 : 0));
}
function renderStock() {
  if (!$('#stock-table')) return;
  const dd = D(); const staff = isStaff();
  const kho = S.stock.filter(s => !s.site_id);
  const low = kho.filter(s => s.min_qty != null && Number(s.qty) < Number(s.min_qty)).length;
  const held = kho.filter(s => (dd.openKhoByStock.get(s.id) || 0) > 0).length;
  const last = S.stock.reduce((m, s) => (!m || s.updated_at > m.updated_at ? s : m), null);
  $('#stock-kpis').innerHTML = `<div class="kpis">
    <div class="kpi"><div class="v">${kho.filter(s => Number(s.qty) > 0).length}</div><div class="l">Dòng có tồn ở kho tổng</div></div>
    <div class="kpi"><div class="v">${S.stock.filter(s => s.site_id && Number(s.qty) > 0).length}</div><div class="l">Dòng đang ở công trường</div></div>
    <div class="kpi"><div class="v">${held}</div><div class="l">Dòng đang giữ hàng cho PR</div></div>
    <button class="kpi ${S.sfilters.low ? 'active' : ''}" data-act="stock-low"><div class="v ${low ? 'late-text' : ''}">${low}</div><div class="l">Dưới mức tồn tối thiểu</div></button>
    <div class="kpi"><div class="v v-sm">${last ? esc(fmtDT(last.updated_at)) : '—'}</div><div class="l">Cập nhật gần nhất${last ? ' · ' + esc(profName(last.updated_by)) : ''}</div></div></div>`;
  const list = stockRows(); const MAX = 500;
  if (!list.length) { $('#stock-table').innerHTML = '<div class="card empty">Không có dòng tồn kho nào khớp bộ lọc.</div>'; return; }
  $('#stock-table').innerHTML = `<div class="small muted mb-s">${list.length} dòng${list.length > MAX ? ` (hiển thị ${MAX})` : ''} · "Đang giữ" = đã dành cho PR đã duyệt, chưa xuất</div>
    <div class="table-wrap"><table class="stock-table">
      <thead><tr><th>Ảnh</th><th>Vật tư</th><th>ĐVT</th><th>Vị trí</th><th>Tình trạng</th><th class="right">Tồn</th><th class="right">Đang giữ</th><th class="right">Còn trống</th><th class="right">Tối thiểu</th><th>Cập nhật</th>${staff ? '<th></th>' : ''}</tr></thead>
      <tbody>${list.slice(0, MAX).map(({ s, m }) => {
        if (!s) return `<tr class="muted-row"><td><div class="sthumb noimg">—</div></td><td>${matCell(m)}</td><td>${esc(m.unit)}</td><td><b>Kho tổng</b></td><td></td><td class="right muted">0</td><td></td><td></td><td></td><td class="small muted">chưa khai báo</td>
          ${staff ? `<td><button class="btn sm" data-act="stock-declare" data-mid="${m.id}">Khai báo tồn</button></td>` : ''}</tr>`;
        const reserved = round6(dd.openKhoByStock.get(s.id) || 0); const free = round6(Number(s.qty) - reserved);
        const lowRow = !s.site_id && s.min_qty != null && Number(s.qty) < Number(s.min_qty);
        return `<tr>
          <td>${imgTag(s.image_path || m.image_path, m.name, 'sthumb')}</td>
          <td>${matCell(m)}${s.note ? `<div class="small">📝 ${esc(s.note)}</div>` : ''}</td><td>${esc(m.unit)}</td>
          <td>${locCell(s.site_id, s.location_detail)}</td><td>${badge(COND, s.condition)}</td>
          <td class="right ${lowRow ? 'stock-low' : ''}"><b>${fmtN(s.qty)}</b></td>
          <td class="right">${reserved ? fmtN(reserved) : ''}</td><td class="right">${s.site_id || !USABLE.includes(s.condition) ? '' : fmtN(free)}</td>
          <td class="right muted">${s.min_qty != null ? fmtN(s.min_qty) : ''}${lowRow ? ' <span class="stock-low">⚠</span>' : ''}</td>
          <td class="small muted nowrap">${esc(fmtDT(s.updated_at))}</td>
          ${staff ? `<td class="nowrap"><button class="btn sm" data-act="stock-edit" data-id="${s.id}" title="Sửa số tồn, tối thiểu, vị trí">✏</button>
            <button class="btn sm" data-act="stock-img" data-id="${s.id}" title="Ảnh vật tư">📷</button>
            <button class="btn sm" data-act="stock-move" data-id="${s.id}" title="Điều chuyển / đổi tình trạng">⇄</button></td>` : ''}</tr>`;
      }).join('')}</tbody></table></div>`;
  loadVisibleImages();
}

async function stockEdit(id) {
  const s = S.stock.find(x => x.id === id); const m = D().mat.get(s.material_id);
  const reserved = round6(D().openKhoByStock.get(s.id) || 0);
  const { action, data } = await modal({
    title: `Sửa tồn — ${m.code} ${m.name}`,
    body: `<p class="small muted">${esc(locLabel(s.site_id))} · ${esc(COND[s.condition][0])}${reserved ? ` · đang giữ ${fmtN(reserved)} ${esc(m.unit)} cho PR` : ''}</p>
      <div class="form"><label class="f"><span class="req">Số lượng tồn (${esc(m.unit)})</span><input id="se-qty" inputmode="decimal" value="${numInput(s.qty)}"></label>
      <label class="f">Tồn tối thiểu<input id="se-min" inputmode="decimal" value="${numInput(s.min_qty)}"></label>
      <label class="f">Vị trí chi tiết<input id="se-loc" value="${esc(s.location_detail || '')}" placeholder="vd: Bãi A, kệ 3"></label>
      <label class="f">Ghi chú<input id="se-note" value="${esc(s.note || '')}"></label></div>`,
    actions: [{ label: 'Huỷ', value: null }, { label: 'Lưu', value: 'ok', primary: true, validate: v => {
      const q = parseNum(v.qty); if (q == null || Number.isNaN(q) || q < 0) return 'Số lượng tồn không hợp lệ';
      if (q < reserved) return `Đang giữ ${fmtN(reserved)} cho PR, không thể thấp hơn`;
      if (v.min.trim() && Number.isNaN(parseNum(v.min))) return 'Tồn tối thiểu không hợp lệ'; return null; } }],
    read: ov => ({ qty: $('#se-qty', ov).value, min: $('#se-min', ov).value, loc: $('#se-loc', ov).value, note: $('#se-note', ov).value }),
  });
  if (action !== 'ok') return;
  const f = { min_qty: data.min.trim() === '' ? '' : parseNum(data.min), location_detail: data.loc, note: data.note };
  if (parseNum(data.qty) !== Number(s.qty)) f.qty = parseNum(data.qty);
  runAction(() => ctx.B.updateStock(id, f), 'Đã cập nhật tồn kho');
}
async function stockMove(id) {
  const s = S.stock.find(x => x.id === id); const m = D().mat.get(s.material_id); const free = s.site_id ? Number(s.qty) : stockFree(s.id);
  const { action, data } = await modal({
    title: `Điều chuyển — ${m.code} ${m.name}`,
    body: `<p class="small">Từ <b>${esc(locLabel(s.site_id))}</b> · ${esc(COND[s.condition][0])} · có thể chuyển tối đa <b>${fmtN(free)} ${esc(m.unit)}</b></p>
      <div class="form"><label class="f"><span class="req">Số lượng</span><input id="mv-qty" inputmode="decimal" value="${numInput(free)}"></label>
      <label class="f"><span class="req">Đến vị trí</span><select id="mv-site">${locOptions(s.site_id ? (siteById(s.site_id) || {}).code : 'kho')}</select></label>
      <label class="f">Tình trạng sau khi chuyển<select id="mv-cond">${condOptions(s.condition)}</select></label>
      <label class="f">Vị trí chi tiết nơi đến<input id="mv-loc"></label>
      <label class="f full">Ghi chú<input id="mv-note" placeholder="vd: Trả giàn giáo về kho sau khi xong tầng 3 / Chuyển sang hàng hỏng"></label></div>`,
    actions: [{ label: 'Huỷ', value: null }, { label: 'Điều chuyển', value: 'ok', primary: true, validate: v => {
      const q = parseNum(v.qty); if (!(q > 0)) return 'Số lượng phải lớn hơn 0'; if (q > free) return `Tối đa ${fmtN(free)}`;
      if ((v.site === 'kho' ? '' : v.site) === ((siteById(s.site_id) || {}).code || '') && v.cond === s.condition) return 'Vị trí và tình trạng mới trùng với hiện tại'; return null; } }],
    read: ov => ({ qty: $('#mv-qty', ov).value, site: $('#mv-site', ov).value, cond: $('#mv-cond', ov).value, loc: $('#mv-loc', ov).value, note: $('#mv-note', ov).value }),
  });
  if (action === 'ok') runAction(() => ctx.B.moveStock(id, { qty: parseNum(data.qty), site: data.site === 'kho' ? '' : data.site, condition: data.cond, location: data.loc, note: data.note }), 'Đã điều chuyển');
}
async function pickOneImage() { const [f] = await pickFiles(false, true); if (!f) return null; if (!/^image\//.test(f.type)) { toast('Không phải file ảnh', 'err'); return null; } return compressImage(f, 1200, 0.8); }
async function stockNew() {
  const { action, data } = await modal({
    title: 'Thêm vật tư mới (quản lý theo số lượng)',
    body: `<div class="form">
      <label class="f full"><span class="req">Tên vật tư</span><input id="sn-name"></label>
      <label class="f">Quy cách<input id="sn-spec"></label><label class="f"><span class="req">ĐVT</span><input id="sn-unit"></label>
      <label class="f">Nhóm<select id="sn-group">${groupOptions('', 'Tự đoán nhóm', 'so_luong')}</select></label>
      <label class="f">Nhóm con<select id="sn-sub"><option value="">—</option></select></label>
      <label class="f">Số lượng tồn<input id="sn-qty" inputmode="decimal" value="0"></label>
      <label class="f">Vị trí<select id="sn-site">${locOptions('kho')}</select></label>
      <label class="f">Tình trạng<select id="sn-cond">${condOptions('moi')}</select></label>
      <label class="f">Vị trí chi tiết<input id="sn-loc"></label><label class="f">Tồn tối thiểu<input id="sn-min" inputmode="decimal"></label>
      <div class="f full"><button class="btn sm" id="sn-img" type="button">📷 Chọn ảnh vật tư</button> <span class="small muted" id="sn-img-n"></span></div></div>`,
    onOpen: ov => {
      const g = $('#sn-group', ov); g.addEventListener('change', () => { $('#sn-sub', ov).innerHTML = subgroupOptions(g.value, '', '—'); });
      $('#sn-img', ov).addEventListener('click', async () => { ov._img = await pickOneImage(); $('#sn-img-n', ov).textContent = ov._img ? 'Đã chọn 1 ảnh' : ''; });
    },
    actions: [{ label: 'Huỷ', value: null }, { label: 'Thêm', value: 'ok', primary: true,
      validate: v => !v.name.trim() ? 'Nhập tên vật tư' : !v.unit.trim() ? 'Nhập đơn vị tính' : Number.isNaN(parseNum(v.qty)) ? 'Số lượng không hợp lệ' : null }],
    read: ov => ({ name: $('#sn-name', ov).value, spec: $('#sn-spec', ov).value, unit: $('#sn-unit', ov).value, group: $('#sn-group', ov).value, subgroup: $('#sn-sub', ov).value,
                   qty: $('#sn-qty', ov).value, site: $('#sn-site', ov).value, condition: $('#sn-cond', ov).value, location: $('#sn-loc', ov).value, min_qty: $('#sn-min', ov).value, img: ov._img }),
  });
  if (action !== 'ok') return;
  const similar = matchMaterials(data.name + ' ' + data.spec, 3, MATCH);
  if (similar.length && !(await confirmBox('Đã có vật tư tương tự', `<ul>${similar.map(({ m }) => `<li><b class="mono">${esc(m.code)}</b> ${esc(m.name)} ${esc(m.spec || '')} (${esc(m.unit)})</li>`).join('')}</ul><p>Vẫn tạo mã mới?</p>`, 'Vẫn tạo mã mới'))) return;
  await runAction(async () => {
    const r = await ctx.B.setStock([{ ...data, img: undefined, site: data.site === 'kho' ? '' : data.site, qty: parseNum(data.qty) ?? 0, force_new: true }], 'set', 'Thêm vật tư mới');
    if (r.errors.length) throw new Error(r.errors[0].error);
    if (data.img && r.ids[0]) await ctx.B.updateStock(r.ids[0], { image_path: await ctx.B.uploadImage(data.img) });
    toast(`Đã tạo mã ${r.created[0] || ''}`, 'ok');
  });
}
async function stockDeclare(mid) {
  const m = D().mat.get(mid);
  const { action, data } = await modal({
    title: `Khai báo tồn — ${m.code} ${m.name}`,
    body: `<div class="form"><label class="f"><span class="req">Số lượng (${esc(m.unit)})</span><input id="sd-qty" inputmode="decimal"></label>
      <label class="f">Vị trí<select id="sd-site">${locOptions('kho')}</select></label><label class="f">Tình trạng<select id="sd-cond">${condOptions('moi')}</select></label>
      <label class="f">Vị trí chi tiết<input id="sd-loc"></label><label class="f">Tồn tối thiểu<input id="sd-min" inputmode="decimal"></label></div>`,
    actions: [{ label: 'Huỷ', value: null }, { label: 'Lưu', value: 'ok', primary: true, validate: v => { const q = parseNum(v.qty); return q == null || Number.isNaN(q) || q < 0 ? 'Số lượng không hợp lệ' : null; } }],
    read: ov => ({ qty: $('#sd-qty', ov).value, site: $('#sd-site', ov).value, cond: $('#sd-cond', ov).value, loc: $('#sd-loc', ov).value, min: $('#sd-min', ov).value }),
  });
  if (action === 'ok') runAction(async () => {
    const r = await ctx.B.setStock([{ material_id: mid, qty: parseNum(data.qty), site: data.site === 'kho' ? '' : data.site, condition: data.cond, location: data.loc, min_qty: data.min }], 'set', 'Khai báo tồn');
    if (r.errors.length) throw new Error(r.errors[0].error);
  }, 'Đã khai báo tồn');
}
const STOCK_COLS = 'Mã VT · Tên vật tư · Quy cách · ĐVT · Nhóm · Số lượng · Vị trí (Kho tổng / mã CT) · Vị trí chi tiết · Tình trạng · Tồn tối thiểu';
async function stockImport() {
  const { action, data } = await modal({
    title: 'Nhập tồn kho từ Excel', wide: true,
    body: `<div class="form mb"><label class="f">Kiểu nhập<select id="si-mode"><option value="set">Kiểm kê: đặt số tồn = số lượng nhập</option><option value="add">Nhập/xuất: cộng thêm (số âm = trừ)</option></select></label>
        <label class="f">Lý do / ghi chú<input id="si-reason" placeholder="vd: Kiểm kê cuối tháng 11"></label></div>
      <p class="muted small">Copy từ Excel các cột: <b>${STOCK_COLS}</b>. Có mã → cập nhật mã đó. Không có mã → tìm vật tư trùng tên, không có thì <b>tự cấp mã mới</b> (cần tên + ĐVT). Vị trí để trống = Kho tổng. Tình trạng: Mới / Đã qua sử dụng / Hỏng / Đang sửa.</p>
      <textarea id="si-box" rows="12" placeholder="KC-0002\tThép thanh vằn D16\tCB400-V\ttấn\tKC\t12\tKho tổng\tBãi thép A\tMới\t5"></textarea>`,
    actions: [{ label: 'Huỷ', value: null }, { label: 'Nhập tồn kho', value: 'ok', primary: true, validate: v => parseStock(v.text).length ? null : 'Chưa có dòng dữ liệu nào' }],
    read: ov => ({ mode: $('#si-mode', ov).value, reason: $('#si-reason', ov).value, text: $('#si-box', ov).value }),
  });
  if (action !== 'ok') return;
  const rows = parseStock(data.text);
  try {
    const r = await ctx.B.setStock(rows, data.mode, data.reason);
    await hooks.pull().catch(() => {}); renderStock();
    importResult(r.ok, rows.length, r.created, r.errors);
  } catch (e) { toast(e.message, 'err'); }
}
function parseStock(text) {
  const lines = parsePaste(text);
  if (lines.length && /^ma/.test(norm(lines[0][0])) && Number.isNaN(parseNum(lines[0][5]))) lines.shift();
  return lines.map(c => ({ code: c[0] || '', name: c[1] || '', spec: c[2] || '', unit: c[3] || '', group: c[4] || '', qty: c[5] ?? '', site: c[6] || '', location: c[7] || '', condition: c[8] || '', min_qty: c[9] ?? '' }));
}
function importResult(ok, total, created, errors) {
  return modal({ title: 'Kết quả nhập', body: `<p>Đã ghi <b>${ok}</b>/${total} dòng.</p>
    ${created.length ? `<p>🆕 Tạo mới ${created.length} mã: <span class="mono">${created.map(esc).join(', ')}</span></p>` : ''}
    ${errors.length ? `<p class="late-text">Lỗi ${errors.length} dòng (đã bỏ qua):</p><ul>${errors.map(e => `<li>Dòng ${e.row}: ${esc(e.error)}</li>`).join('')}</ul>` : ''}`,
    actions: [{ label: 'Đóng', value: 'ok', primary: true }] });
}

/* =====================================================================
   TÀI SẢN – THIẾT BỊ (TỪNG CHIẾC)
   ===================================================================== */
const qrSel = new Set();
function assetsShell() {
  const f = S.afilters; const staff = isStaff();
  return `<div id="asset-kpis"></div>
    <div class="filters f4">
      <input data-afilter="q" value="${esc(f.q)}" placeholder="🔍 Tìm mã tài sản, loại, biển số / seri…">
      <select data-afilter="group">${groupOptions(f.group, 'Tất cả nhóm', 'tung_cai')}</select>
      <select data-afilter="loc">${locOptions(f.loc, true)}</select>
      <select data-afilter="cond">${condOptions(f.cond, 'Mọi tình trạng')}</select>
      <div class="checks"><span class="small muted">Quét mã QR dán trên thiết bị bằng camera điện thoại để mở thẳng thông tin tài sản.</span><span class="spacer"></span>
        ${staff ? `<button class="btn sm" data-act="asset-new">＋ Thêm tài sản</button><button class="btn sm" data-act="asset-import">📋 Nhập từ Excel</button>` : ''}
        <button class="btn sm" data-act="asset-qr">🏷 In tem QR</button>
        <button class="btn sm" data-act="asset-export">⬇ Xuất Excel</button></div>
    </div>
    <div id="asset-table"></div>`;
}
function assetList() {
  const f = S.afilters, q = norm(f.q), dd = D();
  return S.assets.filter(a => {
    const m = dd.mat.get(a.material_id); if (!m) return false;
    if (f.group && m.group_code !== f.group) return false;
    if (!locFilter(a.site_id, f.loc)) return false;
    if (f.cond && a.condition !== f.cond) return false;
    if (q) { const hay = norm([a.asset_code, a.serial, m.code, m.name, m.spec, a.location_detail, locLabel(a.site_id), a.note].join(' ')); if (!q.split(' ').every(w => hay.includes(w))) return false; }
    return true;
  }).sort((a, b) => (b.active !== false) - (a.active !== false) || a.asset_code.localeCompare(b.asset_code));
}
function busyPR(assetId) {
  const d = S.deliveries.find(x => x.asset_id === assetId && OPEN_ST.includes(x.status)); if (!d) return null;
  const it = D().item.get(d.item_id); return it ? D().pr.get(it.pr_id) : null;
}
function renderAssets() {
  if (!$('#asset-table')) return;
  const act = S.assets.filter(a => a.active !== false);
  $('#asset-kpis').innerHTML = `<div class="kpis">
    <div class="kpi"><div class="v">${act.length}</div><div class="l">Tài sản đang quản lý</div></div>
    <button class="kpi" data-act="asset-loc" data-v="kho"><div class="v">${act.filter(a => !a.site_id).length}</div><div class="l">Ở kho tổng</div></button>
    <div class="kpi"><div class="v">${act.filter(a => a.site_id).length}</div><div class="l">Ở công trường</div></div>
    <button class="kpi" data-act="asset-cond" data-v="hong"><div class="v ${act.some(a => a.condition === 'hong') ? 'late-text' : ''}">${act.filter(a => a.condition === 'hong').length}</div><div class="l">Hỏng</div></button>
    <button class="kpi" data-act="asset-cond" data-v="dang_sua"><div class="v">${act.filter(a => a.condition === 'dang_sua').length}</div><div class="l">Đang sửa</div></button></div>`;
  const list = assetList(); const staff = isStaff(); const dd = D();
  if (!list.length) { $('#asset-table').innerHTML = '<div class="card empty">Chưa có tài sản nào khớp bộ lọc.</div>'; return; }
  $('#asset-table').innerHTML = `<div class="small muted mb-s">${list.length} tài sản · tích chọn để in tem QR (không chọn = in tất cả đang lọc)</div>
    <div class="table-wrap"><table class="asset-table">
      <thead><tr><th><input type="checkbox" data-qrall ${list.every(a => qrSel.has(a.id)) ? 'checked' : ''} aria-label="Chọn tất cả"></th><th>Ảnh</th><th>Mã tài sản</th><th>Loại thiết bị</th><th>Biển số / seri</th><th>Vị trí</th><th>Tình trạng</th><th>Đang giao cho</th><th></th></tr></thead>
      <tbody>${list.map(a => { const m = dd.mat.get(a.material_id); const pr = busyPR(a.id);
        return `<tr class="${a.active === false ? 'muted-row' : ''}">
          <td><input type="checkbox" data-qr="${a.id}" ${qrSel.has(a.id) ? 'checked' : ''} aria-label="Chọn ${esc(a.asset_code)}"></td>
          <td>${imgTag(a.image_path || m.image_path, a.asset_code, 'sthumb')}</td>
          <td class="nowrap"><button class="linkbtn mono" data-act="asset-open" data-id="${a.id}"><b>${esc(a.asset_code)}</b></button>${a.active === false ? ' <span class="badge b-gray">đã thanh lý</span>' : ''}</td>
          <td>${matCell(m)}</td><td class="mono">${esc(a.serial || '')}</td>
          <td>${locCell(a.site_id, a.location_detail)}</td><td>${badge(COND, a.condition)}</td>
          <td class="small">${pr ? `<span class="badge b-teal">${esc(pr.pr_no)}</span>` : ''}</td>
          <td class="nowrap"><button class="btn sm" data-act="asset-open" data-id="${a.id}" title="Chi tiết, lịch sử, QR">ⓘ</button>
            ${staff && a.active !== false ? `<button class="btn sm" data-act="asset-move" data-id="${a.id}" title="Điều chuyển / đổi tình trạng">⇄</button><button class="btn sm" data-act="asset-img" data-id="${a.id}" title="Ảnh">📷</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>`;
  loadVisibleImages();
}

let qrLib = null;
const loadQR = () => qrLib || (qrLib = new Promise((res, rej) => { if (window.QRCode) return res(); const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; s.onload = res; s.onerror = () => { qrLib = null; rej(new Error('Không tải được thư viện QR (kiểm tra mạng)')); }; document.head.appendChild(s); }));
const assetUrl = code => `${location.origin}${location.pathname}#asset=${encodeURIComponent(code)}`;
async function qrDataURL(text, size = 220) {
  await loadQR();
  const div = document.createElement('div');
  new window.QRCode(div, { text, width: size, height: size, correctLevel: window.QRCode.CorrectLevel.M });
  const c = div.querySelector('canvas'); return c ? c.toDataURL('image/png') : (div.querySelector('img') || {}).src;
}
const ACTION_VI = { tao: 'Khai báo', dieu_chuyen: 'Điều chuyển', tinh_trang: 'Đổi tình trạng', nhan: 'Công trường nhận', cap_nhat: 'Cập nhật' };
async function assetOpen(id) {
  const a = S.assets.find(x => x.id === id); if (!a) return toast('Không tìm thấy tài sản', 'err');
  const m = D().mat.get(a.material_id); const pr = busyPR(a.id);
  const ovP = modal({
    title: `${a.asset_code} — ${m.name}`, wide: true,
    body: `<div class="asset-detail">
        <div>${imgTag(a.image_path || m.image_path, a.asset_code, 'bigthumb')}<div id="ad-qr" class="qrbox"><span class="small muted">Đang tạo mã QR…</span></div></div>
        <div><dl class="kv">
          <dt>Mã tài sản</dt><dd class="mono"><b>${esc(a.asset_code)}</b></dd><dt>Loại</dt><dd>${esc(m.code)} · ${esc(m.name)} ${esc(m.spec || '')}</dd>
          <dt>Biển số / seri</dt><dd class="mono">${esc(a.serial || '—')}</dd><dt>Vị trí</dt><dd>${esc(locLabel(a.site_id))}${a.location_detail ? ' · ' + esc(a.location_detail) : ''}</dd>
          <dt>Tình trạng</dt><dd>${badge(COND, a.condition)}${a.active === false ? ' <span class="badge b-gray">đã thanh lý</span>' : ''}</dd>
          <dt>Đang giao cho</dt><dd>${pr ? esc(pr.pr_no + ' — ' + pr.title) : '—'}</dd><dt>Ghi chú</dt><dd>${esc(a.note || '—')}</dd></dl>
          <h3 class="mt">Lịch sử</h3><div id="ad-hist" class="small muted">Đang tải…</div></div></div>`,
    actions: [...(isStaff() && a.active !== false ? [{ label: 'Sửa thông tin', value: 'edit' }, { label: 'Điều chuyển / tình trạng', value: 'move' }] : []), { label: 'Đóng', value: null, primary: true }],
    onOpen: async ov => {
      loadVisibleImages();
      try { $('#ad-qr', ov).innerHTML = `<img src="${await qrDataURL(assetUrl(a.asset_code), 180)}" alt="QR ${esc(a.asset_code)}"><div class="small muted">Quét để mở tài sản này</div>`; }
      catch (e) { $('#ad-qr', ov).textContent = e.message; }
      try {
        const h = await ctx.B.assetHistory(a.id);
        $('#ad-hist', ov).innerHTML = h.length ? `<table class="hist"><tbody>${h.map(x => `<tr><td class="nowrap">${esc(fmtDT(x.created_at))}</td><td><b>${esc(ACTION_VI[x.action] || x.action)}</b>
          ${x.from_site !== x.to_site ? ` ${esc(locLabel(x.from_site))} → ${esc(locLabel(x.to_site))}` : ''}${x.from_condition && x.from_condition !== x.to_condition ? ` · ${esc((COND[x.from_condition] || [''])[0])} → ${esc((COND[x.to_condition] || [''])[0])}` : ''}
          ${x.note ? ` · ${esc(x.note)}` : ''}</td><td class="nowrap">${esc(profName(x.changed_by))}</td></tr>`).join('')}</tbody></table>` : 'Chưa có lịch sử';
      } catch (e) { $('#ad-hist', ov).textContent = 'Không tải được lịch sử: ' + e.message; }
    },
  });
  const { action } = await ovP;
  if (action === 'move') assetMove(id); else if (action === 'edit') assetEdit(id);
}
async function assetEdit(id) {
  const a = S.assets.find(x => x.id === id);
  const { action, data } = await modal({
    title: `Sửa thông tin — ${a.asset_code}`,
    body: `<div class="form"><label class="f">Biển số / seri<input id="ae-serial" value="${esc(a.serial || '')}"></label>
      <label class="f">Vị trí chi tiết<input id="ae-loc" value="${esc(a.location_detail || '')}"></label>
      <label class="f full">Ghi chú<input id="ae-note" value="${esc(a.note || '')}"></label>
      <label class="f full"><span><input type="checkbox" id="ae-off"> Thanh lý / ngừng quản lý tài sản này</span></label></div>`,
    actions: [{ label: 'Huỷ', value: null }, { label: 'Lưu', value: 'ok', primary: true }],
    read: ov => ({ serial: $('#ae-serial', ov).value, location_detail: $('#ae-loc', ov).value, note: $('#ae-note', ov).value, off: $('#ae-off', ov).checked }),
  });
  if (action !== 'ok') return;
  if (data.off && !(await confirmBox('Thanh lý tài sản?', `<p>${esc(a.asset_code)} sẽ không còn được giao cho PR nào.</p>`, 'Thanh lý', true))) return;
  const p = { id, serial: data.serial, location_detail: data.location_detail, note: data.note }; if (data.off) p.active = false;
  runAction(() => ctx.B.saveAsset(p), 'Đã lưu tài sản');
}
async function assetMove(id) {
  const a = S.assets.find(x => x.id === id);
  if (busyPR(a.id)) return toast('Tài sản đang được giữ / đang giao cho một PR, không điều chuyển được', 'err');
  const { action, data } = await modal({
    title: `Điều chuyển / đổi tình trạng — ${a.asset_code}`,
    body: `<p class="small">Hiện ở <b>${esc(locLabel(a.site_id))}</b> · ${esc(COND[a.condition][0])}</p>
      <div class="form"><label class="f">Đến vị trí<select id="am-site">${locOptions(a.site_id ? (siteById(a.site_id) || {}).code : 'kho')}</select></label>
      <label class="f">Tình trạng<select id="am-cond">${condOptions(a.condition)}</select></label>
      <label class="f">Vị trí chi tiết<input id="am-loc" value="${esc(a.location_detail || '')}"></label>
      <label class="f full">Ghi chú<input id="am-note" placeholder="vd: Đưa về xưởng sửa chữa / Điều sang công trường BD02"></label></div>`,
    actions: [{ label: 'Huỷ', value: null }, { label: 'Lưu', value: 'ok', primary: true, validate: v => {
      const same = (v.site === 'kho' ? null : v.site) === (a.site_id ? (siteById(a.site_id) || {}).code : null) && v.cond === a.condition && v.loc === (a.location_detail || '');
      return same ? 'Chưa thay đổi gì' : null; } }],
    read: ov => ({ site: $('#am-site', ov).value, cond: $('#am-cond', ov).value, loc: $('#am-loc', ov).value, note: $('#am-note', ov).value }),
  });
  if (action === 'ok') runAction(() => ctx.B.moveAsset(id, { site: data.site === 'kho' ? '' : data.site, condition: data.cond, location: data.loc, note: data.note }), 'Đã cập nhật vị trí / tình trạng');
}
async function assetNew() {
  const types = S.materials.filter(m => (D().grp.get(m.group_code) || {}).kind === 'tung_cai' && m.active !== false);
  const { action, data } = await modal({
    title: 'Thêm tài sản / thiết bị',
    body: `<div class="form">
      <label class="f full"><span class="req">Loại thiết bị</span><select id="an-type"><option value="">— Loại mới —</option>${types.map(m => `<option value="${m.id}">${esc(m.code)} · ${esc(m.name)} ${esc(m.spec || '')}</option>`).join('')}</select></label>
      <div class="full form" id="an-newtype">
        <label class="f"><span class="req">Tên loại</span><input id="an-name" placeholder="vd: Xe đào Komatsu PC200"></label><label class="f">Quy cách<input id="an-spec"></label>
        <label class="f">Nhóm<select id="an-group">${groupOptions('', 'Tự đoán nhóm', 'tung_cai')}</select></label><label class="f">Nhóm con<select id="an-sub"><option value="">—</option></select></label></div>
      <label class="f">Biển số / seri<input id="an-serial"></label>
      <label class="f">Vị trí<select id="an-site">${locOptions('kho')}</select></label>
      <label class="f">Tình trạng<select id="an-cond">${condOptions('moi')}</select></label>
      <label class="f">Vị trí chi tiết<input id="an-loc"></label>
      <label class="f full">Ghi chú<input id="an-note"></label>
      <div class="f full"><button class="btn sm" id="an-img" type="button">📷 Chọn ảnh</button> <span class="small muted" id="an-img-n"></span></div></div>`,
    onOpen: ov => {
      const t = $('#an-type', ov); t.addEventListener('change', () => { $('#an-newtype', ov).style.display = t.value ? 'none' : ''; });
      const g = $('#an-group', ov); g.addEventListener('change', () => { $('#an-sub', ov).innerHTML = subgroupOptions(g.value, '', '—'); });
      $('#an-img', ov).addEventListener('click', async () => { ov._img = await pickOneImage(); $('#an-img-n', ov).textContent = ov._img ? 'Đã chọn 1 ảnh' : ''; });
    },
    actions: [{ label: 'Huỷ', value: null }, { label: 'Thêm', value: 'ok', primary: true, validate: v => !v.material_id && !v.name.trim() ? 'Chọn loại hoặc nhập tên loại mới' : null }],
    read: ov => ({ material_id: $('#an-type', ov).value, name: $('#an-name', ov).value, spec: $('#an-spec', ov).value, group: $('#an-group', ov).value || 'MM', subgroup: $('#an-sub', ov).value,
                   serial: $('#an-serial', ov).value, site: $('#an-site', ov).value, condition: $('#an-cond', ov).value, location_detail: $('#an-loc', ov).value, note: $('#an-note', ov).value, img: ov._img }),
  });
  if (action !== 'ok') return;
  await runAction(async () => {
    const p = { ...data, img: undefined, site: data.site === 'kho' ? '' : data.site, unit: 'chiếc', force_new: !data.material_id };
    if (!p.material_id) delete p.material_id;
    if (data.img) p.image_path = await ctx.B.uploadImage(data.img);
    const r = await ctx.B.saveAsset(p);
    toast(`Đã thêm tài sản ${r.asset_code}`, 'ok');
  });
}
const ASSET_COLS = 'Mã VT (loại) · Tên loại · Quy cách · Nhóm · Biển số / seri · Vị trí (Kho tổng / mã CT) · Vị trí chi tiết · Tình trạng · Ghi chú';
async function assetImport() {
  const { action, data } = await modal({
    title: 'Nhập danh sách tài sản từ Excel', wide: true,
    body: `<p class="muted small">Mỗi dòng là <b>một chiếc</b>. Các cột: <b>${ASSET_COLS}</b>. Có mã loại → dùng loại đó; không có → tìm loại trùng tên, không có thì tạo loại mới.</p>
      <textarea id="ai-box" rows="12" placeholder="CG-0001\tXe đào Komatsu PC200\tgầu 0.8 m3\tCG\t51C-111.22\tKho tổng\tBãi xe\tMới\t"></textarea>`,
    actions: [{ label: 'Huỷ', value: null }, { label: 'Nhập', value: 'ok', primary: true, validate: v => parsePaste(v).length ? null : 'Chưa có dòng dữ liệu nào' }],
    read: ov => $('#ai-box', ov).value,
  });
  if (action !== 'ok') return;
  let lines = parsePaste(data);
  if (lines.length && /^ma/.test(norm(lines[0][0])) && /ten/.test(norm(lines[0][1]))) lines = lines.slice(1);
  let ok = 0; const created = [], errors = [];
  for (let k = 0; k < lines.length; k++) {
    const c = lines[k];
    try {
      const r = await ctx.B.saveAsset({ code: c[0] || '', name: c[1] || '', spec: c[2] || '', group: c[3] || 'MM', serial: c[4] || '', site: c[5] || '', location_detail: c[6] || '', condition: c[7] || '', note: c[8] || '', unit: 'chiếc' });
      ok++; created.push(r.asset_code);
    } catch (e) { errors.push({ row: k + 1, error: e.message }); }
  }
  await hooks.pull().catch(() => {}); renderAssets();
  importResult(ok, lines.length, created, errors);
}
async function printQR() {
  const list = assetList().filter(a => a.active !== false && (!qrSel.size || qrSel.has(a.id)));
  if (!list.length) return toast('Không có tài sản nào để in', 'err');
  const w = window.open('', '_blank'); if (!w) return toast('Trình duyệt chặn cửa sổ mới — cho phép popup rồi thử lại', 'err');
  w.document.write('<p style="font-family:sans-serif">Đang tạo tem…</p>');
  try {
    const dd = D(); const tags = [];
    for (const a of list) { const m = dd.mat.get(a.material_id); tags.push({ a, m, qr: await qrDataURL(assetUrl(a.asset_code), 240) }); }
    w.document.open();
    w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Tem QR tài sản</title><style>
      body{font-family:"Segoe UI",Arial,sans-serif;margin:10mm;color:#000}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}
      .tag{border:1px dashed #999;border-radius:3mm;padding:4mm;display:flex;gap:3mm;align-items:center;break-inside:avoid}
      .tag img{width:28mm;height:28mm} .code{font:700 15pt Consolas,monospace} .name{font-size:9pt} .serial{font:9pt Consolas,monospace} .co{font-size:7.5pt;color:#555;margin-top:1mm}
      @media print{.noprint{display:none}}</style></head><body>
      <p class="noprint"><button onclick="print()">🖨 In tem</button> ${tags.length} tem · khổ A4, 3 cột</p>
      <div class="grid">${tags.map(({ a, m, qr }) => `<div class="tag"><img src="${qr}" alt=""><div><div class="code">${esc(a.asset_code)}</div><div class="name">${esc(m.name)}</div>${a.serial ? `<div class="serial">${esc(a.serial)}</div>` : ''}<div class="co">${esc(CONFIG.COMPANY)}</div></div></div>`).join('')}</div>
      </body></html>`);
    w.document.close();
  } catch (e) { w.close(); toast(e.message, 'err'); }
}

/* =====================================================================
   NHÓM VẬT TƯ
   ===================================================================== */
function groupsHTML() {
  const kindOpts = sel => Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`).join('');
  return `<p class="small muted">Mã nhóm (1–4 chữ in hoa) là tiền tố của mã vật tư, vd <span class="mono">KC-0001</span>. <b>Từng chiếc</b>: quản lý từng thiết bị (mã tài sản, biển số, QR).
      <b>Theo dõi tại CT</b>: sau khi công trường nhận, số lượng được ghi vào tồn kho của công trường (dùng cho đồ luân chuyển như giàn giáo). Từ khoá giúp tự đoán nhóm khi tạo mã mới.</p>
    <div class="table-wrap"><table class="groups-table"><thead><tr><th>Mã</th><th>Tên nhóm</th><th>Cách quản lý</th><th>Theo dõi tại CT</th><th>Từ khoá (cách nhau dấu phẩy)</th><th>Nhóm con</th><th></th></tr></thead><tbody>
    ${S.groups.map(g => `<tr data-g="${esc(g.code)}">
      <td class="mono"><b>${esc(g.code)}</b><div class="small muted">${S.materials.filter(m => m.group_code === g.code).length} mã</div></td>
      <td><input data-gf="name" value="${esc(g.name)}"></td><td><select data-gf="kind">${kindOpts(g.kind)}</select></td>
      <td class="center"><input type="checkbox" data-gf="track_site" ${g.track_site ? 'checked' : ''}></td>
      <td><input data-gf="keywords" value="${esc((g.keywords || []).join(', '))}"></td>
      <td class="small">${S.subgroups.filter(s => s.group_code === g.code).map(s => `<span class="chip">${esc(s.name)}</span>`).join(' ')}
        <div class="row-add"><input data-sub="${esc(g.code)}" placeholder="+ nhóm con"><button class="btn sm" data-act="sub-add" data-g="${esc(g.code)}">Thêm</button></div></td>
      <td><button class="btn sm" data-act="grp-save" data-g="${esc(g.code)}">Lưu</button></td></tr>`).join('')}
    <tr class="new-row"><td><input data-gn="code" placeholder="VD" maxlength="4" class="w60 upper"></td><td><input data-gn="name" placeholder="Tên nhóm mới"></td>
      <td><select data-gn="kind">${kindOpts('so_luong')}</select></td><td class="center"><input type="checkbox" data-gn="track_site"></td>
      <td><input data-gn="keywords" placeholder="tu khoa 1, tu khoa 2"></td><td></td><td><button class="btn sm primary" data-act="grp-add">＋ Thêm</button></td></tr>
    </tbody></table></div>`;
}
async function refreshGroups() { await hooks.pull().catch(() => {}); const el = $('#grp-body'); if (el) el.innerHTML = groupsHTML(); }

/* ---------- Sự kiện ---------- */
const onS = debounce(() => renderStock(), 200), onA = debounce(() => renderAssets(), 200);
INPUTS.push(e => {
  const t = e.target;
  if (t.dataset.sfilter) { S.sfilters[t.dataset.sfilter] = t.type === 'checkbox' ? t.checked : t.value; onS(); return true; }
  if (t.dataset.afilter) { S.afilters[t.dataset.afilter] = t.value; onA(); return true; }
  if (t.dataset.qr) { t.checked ? qrSel.add(t.dataset.qr) : qrSel.delete(t.dataset.qr); return true; }
  if ('qrall' in t.dataset) { for (const a of assetList()) t.checked ? qrSel.add(a.id) : qrSel.delete(a.id); renderAssets(); return true; }
  return false;
});
Object.assign(ACT, {
  'kho-tab': b => { S.khoTab = b.dataset.k; hooks.render(); },
  'stock-low': () => { S.sfilters.low = !S.sfilters.low; hooks.render(); },
  'stock-edit': b => stockEdit(b.dataset.id),
  'stock-move': b => stockMove(b.dataset.id),
  'stock-declare': b => stockDeclare(b.dataset.mid),
  'stock-img': async b => { const img = await pickOneImage(); if (img) runAction(async () => ctx.B.updateStock(b.dataset.id, { image_path: await ctx.B.uploadImage(img) }), 'Đã cập nhật ảnh'); },
  'stock-new': () => stockNew(),
  'stock-import': () => stockImport(),
  'stock-template': () => downloadText('﻿' + [STOCK_COLS.split(' · ').join(','), 'KC-0002,Thép thanh vằn D16,CB400-V,tấn,KC,12,Kho tổng,Bãi thép A,Mới,5', ',Giàn giáo khung 1.7m,,bộ,DC,80,LA01,,Đã qua sử dụng,'].join('\r\n'), 'mau-nhap-ton-kho.csv', 'text/csv;charset=utf-8'),
  'stock-export': () => exportRows(stockRows().filter(x => x.s).map(({ s, m }) => ({ 'Mã VT': m.code, 'Tên vật tư': m.name, 'Quy cách': m.spec || '', 'ĐVT': m.unit, 'Nhóm': groupName(m.group_code),
    'Vị trí': locLabel(s.site_id), 'Vị trí chi tiết': s.location_detail || '', 'Tình trạng': COND[s.condition][0], 'Số lượng tồn': Number(s.qty),
    'Đang giữ cho PR': round6(D().openKhoByStock.get(s.id) || 0), 'Tồn tối thiểu': s.min_qty ?? '', 'Cập nhật': fmtDT(s.updated_at) })), `ton-kho-${todayISO()}`, 'Tồn kho'),
  'asset-loc': b => { S.afilters.loc = S.afilters.loc === b.dataset.v ? '' : b.dataset.v; hooks.render(); },
  'asset-cond': b => { S.afilters.cond = S.afilters.cond === b.dataset.v ? '' : b.dataset.v; hooks.render(); },
  'asset-open': b => assetOpen(b.dataset.id),
  'open-asset-code': b => { const a = S.assets.find(x => x.asset_code.toUpperCase() === String(b.dataset.code).toUpperCase()); a ? assetOpen(a.id) : toast(`Không tìm thấy tài sản ${b.dataset.code}`, 'err'); },
  'asset-move': b => assetMove(b.dataset.id),
  'asset-img': async b => { const img = await pickOneImage(); if (img) runAction(async () => ctx.B.saveAsset({ id: b.dataset.id, image_path: await ctx.B.uploadImage(img) }), 'Đã cập nhật ảnh'); },
  'asset-new': () => assetNew(),
  'asset-import': () => assetImport(),
  'asset-qr': () => printQR(),
  'asset-export': () => exportRows(assetList().map(a => { const m = D().mat.get(a.material_id); const pr = busyPR(a.id); return { 'Mã tài sản': a.asset_code, 'Mã loại': m.code, 'Loại thiết bị': m.name, 'Quy cách': m.spec || '',
    'Nhóm': groupName(m.group_code), 'Biển số / seri': a.serial || '', 'Vị trí': locLabel(a.site_id), 'Vị trí chi tiết': a.location_detail || '', 'Tình trạng': COND[a.condition][0],
    'Đang giao cho PR': pr ? pr.pr_no : '', 'Còn quản lý': a.active === false ? 'Đã thanh lý' : 'Có', 'Ghi chú': a.note || '' }; }), `tai-san-${todayISO()}`, 'Tài sản'),
  groups: () => modal({ title: 'Nhóm vật tư', wide: true, body: `<div id="grp-body">${groupsHTML()}</div>`, actions: [{ label: 'Đóng', value: null, primary: true }] }).then(() => hooks.refresh()),
  'grp-save': async b => {
    const tr = b.closest('tr'); const v = k => $(`[data-gf="${k}"]`, tr); const g = S.groups.find(x => x.code === b.dataset.g);
    try { await ctx.B.upsertGroup({ code: g.code, name: v('name').value, kind: v('kind').value, track_site: v('track_site').checked, keywords: v('keywords').value, priority: g.priority }); toast('Đã lưu nhóm ' + g.code, 'ok'); await refreshGroups(); }
    catch (e) { toast(e.message, 'err'); }
  },
  'grp-add': async b => {
    const tr = b.closest('tr'); const v = k => $(`[data-gn="${k}"]`, tr);
    try { await ctx.B.upsertGroup({ code: v('code').value.toUpperCase(), name: v('name').value, kind: v('kind').value, track_site: v('track_site').checked, keywords: v('keywords').value, priority: 500 }); toast('Đã thêm nhóm', 'ok'); await refreshGroups(); }
    catch (e) { toast(e.message, 'err'); }
  },
  'sub-add': async b => {
    const inp = $(`[data-sub="${b.dataset.g}"]`); if (!inp.value.trim()) return;
    try { await ctx.B.upsertSubgroup(b.dataset.g, inp.value); toast('Đã thêm nhóm con', 'ok'); await refreshGroups(); }
    catch (e) { toast(e.message, 'err'); }
  },
});
