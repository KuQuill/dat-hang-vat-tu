// Sheet 4 — Kho & tài sản: vật tư theo số lượng · tài sản từng chiếc (QR) · nhóm vật tư
import { S, ctx, ACT, VIEWS, INPUTS, CONFIG, hooks, $, $$, esc, norm, todayISO, fmtD, fmtDT, fmtN, numInput, parseNum, round6, debounce,
         toast, modal, confirmBox, runAction, COND, KIND, USABLE, OPEN_ST, badge, siteById, locLabel, profName, isStaff, D, groupName,
         stockFree, khoFree, locOptions, condOptions, groupOptions, subgroupOptions, matchMaterials, MATCH, loadVisibleImages, imgTag,
         pickFiles, compressImage, exportRows, exportBook, downloadText, parsePaste } from './core.js';
import { attrsOf, FAMS } from './kho-attrs.js';

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
        ${isStaff() ? '<button class="btn sm" data-act="groups">🗂 Nhóm vật tư</button> <button class="btn sm" data-act="en-names">🌐 Tên tiếng Anh</button>' : ''}
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
      <input data-sfilter="q" value="${esc(f.q)}" placeholder="🔍 Tìm mã, tên, quy cách, mã phủ, vị trí…">
      <select data-sfilter="loc">${locOptions(f.loc, true)}</select>
      <select data-sfilter="cond">${condOptions(f.cond, 'Mọi tình trạng')}</select>
      <div class="checks">
        <label><input type="checkbox" data-sfilter="has" ${f.has ? 'checked' : ''}> Chỉ dòng có tồn</label>
        <label><input type="checkbox" data-sfilter="out" ${f.out ? 'checked' : ''}> Chỉ hết hàng</label>
        <label><input type="checkbox" data-sfilter="low" ${f.low ? 'checked' : ''}> Dưới tồn tối thiểu</label>
        <span class="spacer"></span>
        ${staff ? `<button class="btn sm" data-act="stock-new">＋ Vật tư mới</button><button class="btn sm" data-act="stock-import">📋 Nhập từ Excel</button><button class="btn sm" data-act="stock-template">⬇ File mẫu</button>` : ''}
        <button class="btn sm primary" data-act="stock-export">⬇ Xuất báo cáo kho</button>
      </div>
    </div>
    <div id="stock-chips"></div>
    <div id="stock-f2" class="filters f2row"></div>
    ${staff ? '' : '<p class="small muted mb-s">Chỉ phòng vật tư / quản trị được cập nhật tồn kho.</p>'}
    <div id="stock-table"></div>`;
}
function stockBase() {
  const f = S.sfilters, q = norm(f.q), dd = D();
  const rows = S.stock.map(s => ({ s, m: dd.mat.get(s.material_id) })).filter(x => x.m);
  if (!f.has && (!f.loc || f.loc === 'kho')) {
    const withRow = new Set(S.stock.filter(s => !s.site_id).map(s => s.material_id));
    for (const m of S.materials) if (m.active !== false && (dd.grp.get(m.group_code) || {}).kind !== 'tung_cai' && !withRow.has(m.id)) rows.push({ s: null, m });
  }
  return rows.filter(({ s, m }) => {
    if ((dd.grp.get(m.group_code) || {}).kind === 'tung_cai') return false;
    if (s && !locFilter(s.site_id, f.loc)) return false;
    if (f.cond && (!s || s.condition !== f.cond)) return false;
    if (f.has && !(s && Number(s.qty) > 0)) return false;
    if (f.low && !(s && !s.site_id && s.min_qty != null && Number(s.qty) < Number(s.min_qty))) return false;
    if (f.out && s && Number(s.qty) > 0) return false;
    if (q) { const a = attrsOf(m); const hay = norm([m.code, m.name, m.spec, m.name_en, a.coat, a.kind, s && s.location_detail, s && locLabel(s.site_id)].join(' ')); if (!q.split(' ').every(w => hay.includes(w))) return false; }
    return true;
  });
}
// Lọc theo nhóm / nhóm con / độ dày / phân loại / họ vật liệu
const passGroup = ({ m }, f) => (!f.group || m.group_code === f.group) && (!f.sub || m.subgroup_id === f.sub);
const passAttr = ({ m }, f) => { const a = attrsOf(m); return (!f.thk || a.thk === f.thk) && (!f.kind || a.kind === f.kind) && (!f.fam || a.fam === f.fam); };
const SORTS = [['code', 'Mã vật tư'], ['name', 'Tên vật tư'], ['group', 'Nhóm'], ['thk', 'Độ dày'], ['kind', 'Phân loại'], ['coat', 'Mã phủ'], ['qty', 'Số lượng tồn'], ['loc', 'Vị trí'], ['updated', 'Cập nhật']];
function sortVal({ s, m }, k) {
  const a = attrsOf(m);
  switch (k) {
    case 'name': return norm(m.name); case 'group': return groupName(m.group_code) + ' ' + norm(m.name);
    case 'thk': return parseFloat(a.thk) || (a.thk ? 0 : 1e9); case 'kind': return a.kind || '~'; case 'coat': return a.coat || '~';
    case 'qty': return s ? Number(s.qty) : 0; case 'loc': return s ? locLabel(s.site_id) + ' ' + (s.location_detail || '') : '';
    case 'updated': return s ? s.updated_at || '' : ''; default: return m.code;
  }
}
function stockRows() {
  const f = S.sfilters;
  const list = stockBase().filter(x => passGroup(x, f) && passAttr(x, f));
  const k = f.sort || 'code', dir = f.dir || 1;
  return list.map(x => [sortVal(x, k), x]).sort(([va, a], [vb, b]) => (va < vb ? -1 : va > vb ? 1 : 0) * dir
    || a.m.code.localeCompare(b.m.code) || (a.s && a.s.site_id ? 1 : 0) - (b.s && b.s.site_id ? 1 : 0)).map(([, x]) => x);
}
// Chip nhóm + chip màu theo loại vật liệu + dòng lọc thứ hai (tuỳ dữ liệu hiện có)
function renderStockFilters() {
  const f = S.sfilters, dd = D(), base = stockBase();
  const gcount = new Map(); for (const x of base) gcount.set(x.m.group_code, (gcount.get(x.m.group_code) || 0) + 1);
  const groups = S.groups.filter(g => g.kind !== 'tung_cai' && (gcount.get(g.code) || f.group === g.code));
  const inGroup = base.filter(x => passGroup(x, f));
  const fcount = new Map(); for (const x of inGroup) { const a = attrsOf(x.m); if (a.fam) fcount.set(a.fam, (fcount.get(a.fam) || 0) + 1); }
  const chip = (act, val, on, label, n, style = '') => `<button class="chip-f ${on ? 'on' : ''}" data-act="${act}" data-v="${esc(val)}" ${style}>${esc(label)}${n != null ? ` <span class="n">${n}</span>` : ''}</button>`;
  $('#stock-chips').innerHTML = `<div class="chip-row">${chip('sf-group', '', !f.group, 'Tất cả', base.length)}${groups.map(g => chip('sf-group', g.code, f.group === g.code, g.name, gcount.get(g.code) || 0)).join('')}</div>
    ${fcount.size ? `<div class="chip-row"><span class="small muted">Màu theo loại:</span>${FAMS.filter(([k]) => fcount.has(k) || f.fam === k).map(([k, l, c]) => chip('sf-fam', k, f.fam === k, l, fcount.get(k) || 0, `style="--c:${c}"`)).join('')}</div>` : ''}`;
  const pool = inGroup.filter(x => !f.fam || attrsOf(x.m).fam === f.fam);
  const uniq = fn => [...new Set(pool.map(x => fn(attrsOf(x.m))).filter(Boolean))];
  const thks = uniq(a => a.thk).sort((a, b) => parseFloat(a) - parseFloat(b)), kinds = uniq(a => a.kind).sort((a, b) => a.localeCompare(b, 'vi'));
  const o = (v, cur, t) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(t ?? v)}</option>`;
  const subs = f.group ? S.subgroups.filter(s => s.group_code === f.group) : [];
  $('#stock-f2').innerHTML = `${subs.length ? `<select data-sfilter="sub">${o('', f.sub, 'Mọi nhóm con')}${subs.map(s => o(s.id, f.sub, s.name)).join('')}</select>` : ''}
    <select data-sfilter="thk">${o('', f.thk, 'Mọi độ dày')}${thks.map(t => o(t, f.thk, t + ' mm')).join('')}${f.thk && !thks.includes(f.thk) ? o(f.thk, f.thk, f.thk + ' mm') : ''}</select>
    <select data-sfilter="kind">${o('', f.kind, 'Mọi phân loại')}${kinds.map(k => o(k, f.kind)).join('')}${f.kind && !kinds.includes(f.kind) ? o(f.kind, f.kind) : ''}</select>
    <select data-sfilter="sort">${SORTS.map(([k, t]) => o(k, f.sort, 'Xếp theo: ' + t)).join('')}</select>
    <button class="btn sm" data-act="sf-dir">${f.dir < 0 ? '⬇ Giảm dần' : '⬆ Tăng dần'}</button>
    ${f.group || f.sub || f.thk || f.kind || f.fam || f.out || f.low || f.q || f.loc || f.cond ? '<button class="btn sm ghost" data-act="sf-clear">✕ Bỏ lọc</button>' : ''}`;
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
    <div class="kpi"><div class="v v-sm">${last ? esc(fmtDT(last.updated_at)) : '—'}</div><div class="l">Cập nhật gần nhất${last ? ' · ' + esc(profName(last.updated_by)) : ''}</div></div></div>`;
  renderStockFilters();
  const list = stockRows(); const MAX = 500;
  if (!list.length) { $('#stock-table').innerHTML = '<div class="card empty">Không có dòng tồn kho nào khớp bộ lọc.</div>'; return; }
  const showA = list.some(({ m }) => { const a = attrsOf(m); return a.thk || a.kind || a.coat; });
  const f = S.sfilters;
  const th = (k, t, cls = '') => `<th class="sortable ${cls}" data-act="stock-sort" data-k="${k}">${t}${f.sort === k ? (f.dir < 0 ? ' ▼' : ' ▲') : ''}</th>`;
  const av = (v, g, unit = '') => v ? `<span class="${g ? 'guess' : ''}" ${g ? 'title="Tự nhận từ tên / quy cách"' : ''}>${esc(v)}${unit}</span>` : '<span class="muted">—</span>';
  const aCells = m => { if (!showA) return ''; const a = attrsOf(m); return `<td class="nowrap">${av(a.thk, a.guessed.thk, a.thk ? ' mm' : '')}</td><td>${a.kind ? `<span class="badge b-gray ${a.guessed.kind ? 'guess' : ''}">${esc(a.kind)}</span>` : '<span class="muted">—</span>'}</td><td class="nowrap mono small">${av(a.coat, a.guessed.coat)}</td>`; };
  const famStyle = m => { const a = attrsOf(m); const c = (FAMS.find(x => x[0] === a.fam) || [])[2]; return c ? ` class="fam" style="--c:${c}"` : ''; };
  $('#stock-table').innerHTML = `<div class="small muted mb-s">${list.length} dòng${list.length > MAX ? ` (hiển thị ${MAX})` : ''} · "Đang giữ" = đã dành cho PR đã duyệt, chưa xuất</div>
    <div class="table-wrap"><table class="stock-table">
      <thead><tr><th>Ảnh</th>${th('code', 'Vật tư')}${showA ? th('thk', 'Dày') + th('kind', 'Phân loại') + th('coat', 'Mã phủ') : ''}<th>ĐVT</th>${th('loc', 'Vị trí')}<th>Tình trạng</th>${th('qty', 'Tồn', 'right')}<th class="right">Đang giữ</th><th class="right">Còn trống</th>${th('updated', 'Cập nhật')}${staff ? '<th></th>' : ''}</tr></thead>
      <tbody>${list.slice(0, MAX).map(({ s, m }) => {
        if (!s) return `<tr class="muted-row"><td><div class="sthumb noimg">—</div></td><td>${matCell(m)}</td>${aCells(m)}<td>${esc(m.unit)}</td><td><b>Kho tổng</b></td><td></td><td class="right muted">0</td><td></td><td></td><td class="small muted">chưa khai báo</td>
          ${staff ? `<td><button class="btn sm" data-act="stock-declare" data-mid="${m.id}">Khai báo tồn</button></td>` : ''}</tr>`;
        const reserved = round6(dd.openKhoByStock.get(s.id) || 0); const free = round6(Number(s.qty) - reserved);
        return `<tr${famStyle(m)}>
          <td>${imgTag(s.image_path || m.image_path, m.name, 'sthumb')}</td>
          <td>${matCell(m)}${s.note ? `<div class="small">📝 ${esc(s.note)}</div>` : ''}</td>${aCells(m)}<td>${esc(m.unit)}</td>
          <td>${locCell(s.site_id, s.location_detail)}</td><td>${badge(COND, s.condition)}</td>
          <td class="right ${Number(s.qty) <= 0 ? 'stock-low' : ''}"><b>${fmtN(s.qty)}</b></td>
          <td class="right">${reserved ? fmtN(reserved) : ''}</td><td class="right">${s.site_id || !USABLE.includes(s.condition) ? '' : fmtN(free)}</td>
          <td class="small muted nowrap">${esc(fmtDT(s.updated_at))}</td>
          ${staff ? `<td class="nowrap"><button class="btn sm" data-act="stock-edit" data-id="${s.id}" title="Sửa số tồn, vị trí">✏</button>
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
      <label class="f">Vị trí chi tiết<input id="se-loc" value="${esc(s.location_detail || '')}" placeholder="vd: Bãi A, kệ 3"></label>
      <label class="f">Ghi chú<input id="se-note" value="${esc(s.note || '')}"></label></div>
      <p class="small muted mt">Thuộc tính vật tư (dùng để lọc, báo cáo kho — áp dụng cho mã ${esc(m.code)} ở mọi vị trí). Để trống = tự nhận từ tên.</p>
      <div class="form"><label class="f">Độ dày (mm)<input id="se-thk" value="${esc(m.thickness || '')}" placeholder="${esc(attrsOf(m).thk || 'vd: 17')}"></label>
      <label class="f">Phân loại<input id="se-kind" list="se-kinds" value="${esc(m.kind || '')}" placeholder="${esc(attrsOf(m).kind || 'vd: Melamine 2 mặt')}">
        <datalist id="se-kinds">${['Ván thô', 'Ván chống ẩm', 'Melamine 1 mặt', 'Melamine 2 mặt', 'Laminate 1 mặt', 'Laminate 2 mặt', 'Veneer 1 mặt', 'Veneer 2 mặt', 'Phủ men 1 mặt', 'Phủ men 2 mặt', 'Phủ film PVC 2 mặt', 'Gỗ ghép', 'Gỗ xẻ'].map(k => `<option value="${k}">`).join('')}</datalist></label>
      <label class="f">Mã phủ (melamine / laminate)<input id="se-coat" value="${esc(m.coat_code || '')}" placeholder="${esc(attrsOf(m).coat || 'vd: LK705D')}"></label></div>`,
    actions: [{ label: 'Huỷ', value: null }, { label: 'Lưu', value: 'ok', primary: true, validate: v => {
      const q = parseNum(v.qty); if (q == null || Number.isNaN(q) || q < 0) return 'Số lượng tồn không hợp lệ';
      if (q < reserved) return `Đang giữ ${fmtN(reserved)} cho PR, không thể thấp hơn`; return null; } }],
    read: ov => ({ qty: $('#se-qty', ov).value, loc: $('#se-loc', ov).value, note: $('#se-note', ov).value,
                   thickness: $('#se-thk', ov).value.trim(), kind: $('#se-kind', ov).value.trim(), coat_code: $('#se-coat', ov).value.trim() }),
  });
  if (action !== 'ok') return;
  const f = { location_detail: data.loc, note: data.note };
  if (parseNum(data.qty) !== Number(s.qty)) f.qty = parseNum(data.qty);
  const attrs = {}; for (const k of ['thickness', 'kind', 'coat_code']) if (data[k] !== (m[k] || '')) attrs[k] = data[k];
  runAction(async () => { await ctx.B.updateStock(id, f); if (Object.keys(attrs).length) await ctx.B.updateMaterialAttrs(m.id, attrs); }, 'Đã cập nhật tồn kho');
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
      <label class="f">Vị trí chi tiết<input id="sn-loc"></label>
      <div class="f full"><button class="btn sm" id="sn-img" type="button">📷 Chọn ảnh vật tư</button> <span class="small muted" id="sn-img-n"></span></div></div>`,
    onOpen: ov => {
      const g = $('#sn-group', ov); g.addEventListener('change', () => { $('#sn-sub', ov).innerHTML = subgroupOptions(g.value, '', '—'); });
      $('#sn-img', ov).addEventListener('click', async () => { ov._img = await pickOneImage(); $('#sn-img-n', ov).textContent = ov._img ? 'Đã chọn 1 ảnh' : ''; });
    },
    actions: [{ label: 'Huỷ', value: null }, { label: 'Thêm', value: 'ok', primary: true,
      validate: v => !v.name.trim() ? 'Nhập tên vật tư' : !v.unit.trim() ? 'Nhập đơn vị tính' : Number.isNaN(parseNum(v.qty)) ? 'Số lượng không hợp lệ' : null }],
    read: ov => ({ name: $('#sn-name', ov).value, spec: $('#sn-spec', ov).value, unit: $('#sn-unit', ov).value, group: $('#sn-group', ov).value, subgroup: $('#sn-sub', ov).value,
                   qty: $('#sn-qty', ov).value, site: $('#sn-site', ov).value, condition: $('#sn-cond', ov).value, location: $('#sn-loc', ov).value, img: ov._img }),
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
      <label class="f">Vị trí chi tiết<input id="sd-loc"></label></div>`,
    actions: [{ label: 'Huỷ', value: null }, { label: 'Lưu', value: 'ok', primary: true, validate: v => { const q = parseNum(v.qty); return q == null || Number.isNaN(q) || q < 0 ? 'Số lượng không hợp lệ' : null; } }],
    read: ov => ({ qty: $('#sd-qty', ov).value, site: $('#sd-site', ov).value, cond: $('#sd-cond', ov).value, loc: $('#sd-loc', ov).value }),
  });
  if (action === 'ok') runAction(async () => {
    const r = await ctx.B.setStock([{ material_id: mid, qty: parseNum(data.qty), site: data.site === 'kho' ? '' : data.site, condition: data.cond, location: data.loc }], 'set', 'Khai báo tồn');
    if (r.errors.length) throw new Error(r.errors[0].error);
  }, 'Đã khai báo tồn');
}
const STOCK_COLS = 'Mã VT · Tên vật tư · Quy cách · ĐVT · Nhóm · Số lượng · Vị trí (Kho tổng / mã dự án) · Vị trí chi tiết · Tình trạng';
// Trường nhập tồn + các tên cột thường gặp trong file kho (đã bỏ dấu, chữ thường)
const SF = [
  ['code', 'Mã VT', ['ma vt', 'ma vat tu', 'ma hang', 'ma hang hoa', 'ma so', 'ma', 'code', 'ma sp', 'ma vat lieu']],
  ['name', 'Tên vật tư', ['ten vat tu', 'ten hang', 'ten hang hoa', 'ten', 'vat tu', 'ten vat lieu', 'dien giai', 'mo ta', 'ten san pham', 'noi dung']],
  ['spec', 'Quy cách', ['quy cach', 'thong so', 'thong so ky thuat', 'kich thuoc', 'model', 'chung loai', 'dac tinh', 'quy cach ky thuat']],
  ['unit', 'ĐVT', ['dvt', 'don vi', 'don vi tinh', 'dv', 'd.v.t', 'unit']],
  ['group', 'Nhóm', ['nhom', 'nhom vat tu', 'loai', 'nhom hang']],
  ['qty', 'Số lượng', ['so luong', 'sl', 'ton', 'ton kho', 'ton cuoi', 'ton cuoi ky', 'sl ton', 'so luong ton', 'so luong ton kho', 'khoi luong', 'qty']],
  ['site', 'Vị trí (kho / mã dự án)', ['vi tri', 'kho', 'cong trinh', 'du an', 'ma du an', 'noi de', 'ma cong trinh']],
  ['location', 'Vị trí chi tiết', ['vi tri chi tiet', 'ke', 'ngan', 'vi tri luu kho', 'vi tri de', 'o ke']],
  ['condition', 'Tình trạng', ['tinh trang', 'hien trang', 'chat luong']],
  ['min_qty', 'Tồn tối thiểu', ['ton toi thieu', 'min', 'dinh muc', 'ton an toan']],
  ['note', 'Ghi chú', ['ghi chu', 'note', 'chu thich']],
];
const hnorm = v => norm(String(v ?? '')).replace(/[*:()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
const colName = i => { let s = ''; i++; while (i) { s = String.fromCharCode(65 + (i - 1) % 26) + s; i = Math.floor((i - 1) / 26); } return s; };
function matchScore(h, syns) {
  if (!h) return 0; let best = 0;
  for (const s of syns) { if (h === s) return 3; if (s.length >= 2 && (h.startsWith(s + ' ') || h.endsWith(' ' + s))) best = Math.max(best, 2); else if (s.length >= 4 && h.includes(s)) best = Math.max(best, 1); }
  return best;
}
function guessHeader(rows) {
  let best = { row: -1, score: 0 };
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const hs = rows[r].map(hnorm); let score = 0;
    for (const [, , syns] of SF) if (hs.some(h => matchScore(h, syns) >= 2)) score++;
    if (score > best.score) best = { row: r, score };
  }
  return best.score >= 2 ? best.row : 0;
}
function guessMap(header) {
  const hs = header.map(hnorm), map = {}, used = new Set(), cand = [];
  SF.forEach(([k, , syns]) => hs.forEach((h, c) => { const s = matchScore(h, syns); if (s) cand.push([s, k, c]); }));
  cand.sort((a, b) => b[0] - a[0] || a[2] - b[2]);
  for (const [, k, c] of cand) if (!(k in map) && !used.has(c)) { map[k] = c; used.add(c); }
  return map;
}
const cellStr = v => v === '' || v == null ? '' : String(v).trim();
const qtyVal = v => typeof v === 'number' ? v : parseNum(v);
// Từ sheet + cách ghép cột → các dòng nhập tồn (kèm số dòng Excel và ảnh)
function buildRows(sheet, hdr, map, defSite, defCond) {
  const out = [], skipped = [];
  const g = (r, k) => map[k] >= 0 ? r[map[k]] : '';
  for (let i = hdr + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i]; const name = cellStr(g(r, 'name')), code = cellStr(g(r, 'code'));
    if (!name && !code) continue;
    const q = qtyVal(g(r, 'qty'));
    if (q == null || Number.isNaN(q)) { skipped.push(i + 1); continue; } // dòng tiêu đề nhóm / tổng cộng / chưa có số lượng
    const site = cellStr(g(r, 'site'));
    out.push({ excelRow: i + 1, img: sheet.images.get(i) || null,
      code, name, spec: cellStr(g(r, 'spec')), unit: cellStr(g(r, 'unit')), group: cellStr(g(r, 'group')), qty: q,
      site: site && !/^kho tong$/.test(norm(site)) ? site : (defSite === 'kho' ? '' : defSite),
      location: cellStr(g(r, 'location')), condition: cellStr(g(r, 'condition')) || defCond,
      min_qty: map.min_qty >= 0 && cellStr(g(r, 'min_qty')) !== '' ? qtyVal(g(r, 'min_qty')) : null, note: cellStr(g(r, 'note')) });
  }
  return { rows: out, skipped };
}

async function stockImport() {
  const { action, data } = await modal({
    title: 'Nhập tồn kho từ Excel', wide: true,
    body: `<div class="import-pick">
        <label class="btn primary big">📂 Chọn file Excel của kho<input type="file" id="si-file" accept=".xlsx,.xlsm,.xls" hidden></label>
        <p class="small muted">Dùng thẳng file Excel kho đang có (.xlsx). Hệ thống tự nhận các cột <b>Mã, Tên, Quy cách, ĐVT, Số lượng…</b> theo dòng tiêu đề — bạn kiểm tra lại trước khi nhập.
        <b>Hình ảnh vật tư</b> chèn trong file (ảnh đặt trong ô, hoặc Insert → Picture → Place in Cell) được gắn theo đúng dòng.</p>
        <p class="small"><a href="#" id="si-tpl">⬇ Tải file mẫu .xlsx</a></p></div>
      <details class="mt"><summary class="small">Hoặc dán dữ liệu copy từ Excel (không kèm ảnh)</summary>
        <div class="form mb mt"><label class="f">Kiểu nhập<select id="si-mode"><option value="set">Kiểm kê: đặt số tồn = số lượng nhập</option><option value="add">Nhập/xuất: cộng thêm (số âm = trừ)</option></select></label>
          <label class="f">Lý do / ghi chú<input id="si-reason" placeholder="vd: Kiểm kê cuối tháng 11"></label></div>
        <p class="muted small">Các cột theo thứ tự: <b>${STOCK_COLS}</b>.</p>
        <textarea id="si-box" rows="8" placeholder="KC-0002\tThép thanh vằn D16\tCB400-V\ttấn\tKC\t12\tKho tổng\tBãi thép A\tMới"></textarea></details>`,
    actions: [{ label: 'Huỷ', value: null }, { label: 'Nhập dữ liệu đã dán', value: 'paste', validate: v => parseStock(v.text).length ? null : 'Chưa chọn file hoặc chưa dán dòng nào' }, { label: 'file', value: 'file' }],
    onOpen: ov => {
      const fb = ov.querySelector('footer button[data-i="2"]'); fb.style.display = 'none';
      $('#si-file', ov).addEventListener('change', e => { ov._file = e.target.files[0]; if (ov._file) fb.click(); });
      $('#si-tpl', ov).addEventListener('click', e => { e.preventDefault(); stockTemplate(); });
    },
    read: ov => ({ file: ov._file || null, mode: $('#si-mode', ov).value, reason: $('#si-reason', ov).value, text: $('#si-box', ov).value }),
  });
  if (action === 'file' && data.file) return stockImportFile(data.file);
  if (action !== 'paste') return;
  const rows = parseStock(data.text);
  try {
    const r = await ctx.B.setStock(rows, data.mode, data.reason);
    await hooks.pull().catch(() => {}); renderStock();
    importResult(r.ok, rows.length, r.created, r.errors);
  } catch (e) { toast(e.message, 'err'); }
}

async function stockImportFile(file) {
  if (file.size > 60 * 1024 * 1024) return toast('File quá lớn (> 60MB)', 'err');
  toast('Đang đọc file Excel…', '');
  let wb;
  try { const { readWorkbook } = await import('./xlsx-read.js'); wb = await readWorkbook(file); }
  catch (e) { return toast(e.message || 'Không đọc được file Excel', 'err'); }
  if (!wb.sheets.length) return toast('File không có dữ liệu', 'err');
  if (wb.imgErr) toast(wb.imgErr, 'err');
  // chọn sheet có nhiều dòng nhất làm mặc định
  const st = { sheet: wb.sheets.reduce((a, s, i) => s.rows.length > wb.sheets[a].rows.length ? i : a, 0) };
  const reset = () => { const sh = wb.sheets[st.sheet]; st.hdr = guessHeader(sh.rows); st.map = guessMap(sh.rows[st.hdr] || []); };
  reset();
  const urls = [];
  const fieldSel = (k, header) => `<select data-map="${k}"><option value="-1">— Không có —</option>${header.map((h, c) => `<option value="${c}" ${st.map[k] === c ? 'selected' : ''}>${colName(c)}${cellStr(h) ? ' · ' + esc(cellStr(h).slice(0, 40)) : ''}</option>`).join('')}</select>`;
  const render = ov => {
    const sh = wb.sheets[st.sheet], header = sh.rows[st.hdr] || [];
    const width = Math.max(header.length, ...sh.rows.slice(st.hdr, st.hdr + 50).map(r => r.length));
    const hdrFull = Array.from({ length: width }, (_, c) => header[c] ?? '');
    $('#sx-map', ov).innerHTML = SF.map(([k, l]) => `<label class="f">${['name', 'unit', 'qty'].includes(k) ? `<span class="req">${l}</span>` : l}${fieldSel(k, hdrFull)}</label>`).join('');
    preview(ov);
  };
  const preview = ov => {
    urls.splice(0).forEach(u => URL.revokeObjectURL(u));
    const sh = wb.sheets[st.sheet];
    const { rows, skipped } = buildRows(sh, st.hdr, st.map, $('#sx-site', ov).value, $('#sx-cond', ov).value);
    const nImg = rows.filter(r => r.img).length;
    const miss = ['name', 'qty'].filter(k => !(st.map[k] >= 0)).map(k => SF.find(f => f[0] === k)[1]);
    ov._rows = rows;
    $('#sx-sum', ov).innerHTML = miss.length ? `<span class="late-text">Chưa chọn cột: ${miss.join(', ')}</span>`
      : `<b>${rows.length}</b> dòng sẽ nhập · <b>${nImg}</b> dòng có ảnh${skipped.length ? ` · bỏ qua ${skipped.length} dòng không có số lượng (dòng ${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? '…' : ''})` : ''}`;
    const show = rows.slice(0, 12);
    $('#sx-prev', ov).innerHTML = show.length ? `<div class="table-wrap"><table class="import-prev"><thead><tr><th>Dòng</th><th>Ảnh</th><th>Mã</th><th>Tên vật tư</th><th>Quy cách</th><th>ĐVT</th><th class="num">SL</th><th>Vị trí</th><th>Tình trạng</th></tr></thead>
      <tbody>${show.map(r => { let im = ''; if (r.img) { const u = URL.createObjectURL(r.img); urls.push(u); im = `<img src="${u}" alt="" class="sthumb">`; }
        return `<tr><td class="small muted">${r.excelRow}</td><td>${im}</td><td class="mono">${esc(r.code)}</td><td>${esc(r.name)}</td><td class="small">${esc(r.spec)}</td><td>${esc(r.unit)}</td><td class="num">${fmtN(r.qty)}</td><td class="small">${esc(r.site || 'Kho tổng')}${r.location ? ' · ' + esc(r.location) : ''}</td><td class="small">${esc((COND[r.condition] || [r.condition])[0])}</td></tr>`; }).join('')}</tbody></table></div>
      ${rows.length > show.length ? `<p class="small muted">… và ${rows.length - show.length} dòng nữa</p>` : ''}` : '<p class="muted">Không có dòng dữ liệu nào — kiểm tra lại dòng tiêu đề và cột Tên / Số lượng.</p>';
  };
  const { action, data } = await modal({
    title: `Nhập tồn kho — ${file.name}`, wide: true,
    body: `<div class="form mb">
        ${wb.sheets.length > 1 ? `<label class="f">Sheet<select id="sx-sheet">${wb.sheets.map((s, i) => `<option value="${i}" ${i === st.sheet ? 'selected' : ''}>${esc(s.name)} (${s.rows.length} dòng)</option>`).join('')}</select></label>` : ''}
        <label class="f">Dòng tiêu đề (số dòng trong Excel)<input id="sx-hdr" type="number" min="1" value="${st.hdr + 1}"></label>
        <label class="f">Kiểu nhập<select id="sx-mode"><option value="set">Kiểm kê: đặt số tồn = số lượng nhập</option><option value="add">Nhập/xuất: cộng thêm (số âm = trừ)</option></select></label>
        <label class="f">Lý do / ghi chú<input id="sx-reason" placeholder="vd: Kiểm kê cuối tháng 11"></label>
        <label class="f">Vị trí khi ô trống<select id="sx-site">${locOptions('kho')}</select></label>
        <label class="f">Tình trạng khi ô trống<select id="sx-cond">${condOptions('moi')}</select></label></div>
      <h4 class="mb">Ghép cột trong file với thông tin vật tư</h4>
      <div class="form mb" id="sx-map"></div>
      <p class="small muted">Có mã → cập nhật đúng mã đó. Không có mã → tìm vật tư trùng tên, không có thì tự cấp mã mới (cần Tên + ĐVT). Ảnh nằm trên dòng nào thì gắn cho vật tư dòng đó.</p>
      <div id="sx-sum" class="mb"></div><div id="sx-prev"></div>`,
    onOpen: ov => {
      render(ov);
      ov.addEventListener('change', e => {
        const t = e.target;
        if (t.id === 'sx-sheet') { st.sheet = +t.value; reset(); $('#sx-hdr', ov).value = st.hdr + 1; render(ov); }
        else if (t.id === 'sx-hdr') { st.hdr = Math.max(0, (+t.value || 1) - 1); st.map = guessMap(wb.sheets[st.sheet].rows[st.hdr] || []); render(ov); }
        else if (t.dataset.map) { if (+t.value < 0) delete st.map[t.dataset.map]; else st.map[t.dataset.map] = +t.value; preview(ov); }
        else if (t.id === 'sx-site' || t.id === 'sx-cond') preview(ov);
      });
    },
    actions: [{ label: 'Huỷ', value: null }, { label: 'Nhập tồn kho', value: 'ok', primary: true,
      validate: v => !(st.map.name >= 0) && !(st.map.code >= 0) ? 'Chọn cột Tên vật tư (hoặc Mã VT)' : !(st.map.qty >= 0) ? 'Chọn cột Số lượng' : !v.rows.length ? 'Không có dòng nào để nhập' : v.rows.length > 5000 ? 'Tối đa 5000 dòng mỗi lần' : null }],
    read: ov => ({ rows: ov._rows || [], mode: $('#sx-mode', ov).value, reason: $('#sx-reason', ov).value }),
  });
  urls.forEach(u => URL.revokeObjectURL(u));
  if (action !== 'ok') return;
  const rows = data.rows;
  try {
    toast(`Đang ghi ${rows.length} dòng…`, '');
    const r = await ctx.B.setStock(rows.map(({ excelRow, img, ...x }) => x), data.mode, data.reason || `Nhập từ file ${file.name}`);
    // ids chỉ có cho các dòng thành công, theo đúng thứ tự → ghép lại với dòng
    const bad = new Set(r.errors.map(e => e.row)); let j = 0; const jobs = [];
    rows.forEach((row, k) => { if (bad.has(k + 1)) return; const id = r.ids[j++]; if (row.img && id) jobs.push([id, row]); });
    let imgOk = 0; const imgErr = [];
    for (let k = 0; k < jobs.length; k++) {
      const [id, row] = jobs[k];
      if (k % 5 === 0) toast(`Đang tải ảnh ${k + 1}/${jobs.length}…`, '');
      try { await ctx.B.updateStock(id, { image_path: await ctx.B.uploadImage(await compressImage(row.img, 1200, 0.8)) }); imgOk++; }
      catch (e) { imgErr.push({ row: row.excelRow, error: 'Ảnh: ' + e.message }); }
    }
    await hooks.pull().catch(() => {}); renderStock();
    importResult(r.ok, rows.length, r.created, [...r.errors.map(e => ({ row: rows[e.row - 1] ? rows[e.row - 1].excelRow : e.row, error: e.error })), ...imgErr], jobs.length ? `🖼 Đã gắn ${imgOk}/${jobs.length} ảnh vật tư.` : '');
  } catch (e) { toast(e.message, 'err'); }
}

async function stockTemplate() {
  try {
    const { loadXlsxLibs } = await import('./xlsx-read.js'); await loadXlsxLibs();
    const X = window.XLSX;
    const head = ['Mã VT', 'Tên vật tư', 'Quy cách', 'ĐVT', 'Nhóm', 'Số lượng', 'Vị trí (Kho tổng / mã dự án)', 'Vị trí chi tiết', 'Tình trạng', 'Tồn tối thiểu', 'Ghi chú', 'Hình ảnh'];
    const ws = X.utils.aoa_to_sheet([head,
      ['KC-0002', 'Thép thanh vằn D16', 'CB400-V', 'tấn', 'KC', 12, 'Kho tổng', 'Bãi thép A', 'Mới', 2, '', '(dán ảnh vào ô này)'],
      ['', 'Giàn giáo khung 1.7m', '', 'bộ', 'DC', 80, 'LA01', '', 'Đã qua sử dụng', '', '', '(dán ảnh vào ô này)']]);
    ws['!cols'] = [10, 32, 18, 8, 8, 10, 26, 18, 16, 12, 24, 22].map(wch => ({ wch }));
    ws['!rows'] = [{ hpx: 22 }, ...Array.from({ length: 200 }, () => ({ hpx: 60 }))];
    const guide = X.utils.aoa_to_sheet([
      ['HƯỚNG DẪN NHẬP TỒN KHO'], [''],
      ['1. Có thể dùng luôn file Excel kho đang có, không bắt buộc theo mẫu này. Khi nhập, hệ thống tự nhận cột theo dòng tiêu đề và cho chỉnh lại.'],
      ['2. Bắt buộc: Tên vật tư (hoặc Mã VT đã có), ĐVT (khi tạo mã mới), Số lượng. Dòng không có số lượng (tiêu đề nhóm, tổng cộng) sẽ được bỏ qua.'],
      ['3. Có Mã VT thì cập nhật đúng mã đó. Không có mã thì tìm vật tư trùng tên; không có nữa thì tự cấp mã mới.'],
      ['4. Vị trí: để trống hoặc "Kho tổng" = kho tổng; hoặc ghi mã dự án (vd LA01).'],
      ['5. Tình trạng: Mới / Đã qua sử dụng / Hỏng / Đang sửa.'],
      ['6. Hình ảnh: bấm vào ô cột Hình ảnh của dòng → Insert (Chèn) → Pictures (Ảnh) → Place in Cell (Đặt trong ô); hoặc chèn ảnh rồi kéo cho nằm gọn trong ô của dòng đó. Mỗi dòng 1 ảnh.'],
      ['7. Lưu file dạng .xlsx (file Excel 97-2003 .xls không đọc được ảnh).'],
    ]);
    guide['!cols'] = [{ wch: 130 }];
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Ton kho'); X.utils.book_append_sheet(wb, guide, 'Huong dan');
    X.writeFile(wb, 'mau-nhap-ton-kho.xlsx');
  } catch (e) { toast(e.message, 'err'); }
}

function parseStock(text) {
  const lines = parsePaste(text);
  if (lines.length && /^ma/.test(norm(lines[0][0])) && Number.isNaN(parseNum(lines[0][5]))) lines.shift();
  return lines.map(c => ({ code: c[0] || '', name: c[1] || '', spec: c[2] || '', unit: c[3] || '', group: c[4] || '', qty: c[5] ?? '', site: c[6] || '', location: c[7] || '', condition: c[8] || '' }));
}
function importResult(ok, total, created, errors, extra = '') {
  return modal({ title: 'Kết quả nhập', body: `<p>Đã ghi <b>${ok}</b>/${total} dòng.</p>${extra ? `<p>${esc(extra)}</p>` : ''}
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

/* ---------- Báo cáo tồn kho (theo bộ lọc đang chọn) ---------- */
function filterDesc() {
  const f = S.sfilters, parts = [];
  if (f.group) parts.push('Nhóm: ' + groupName(f.group));
  if (f.sub) parts.push('Nhóm con: ' + ((S.subgroups.find(x => x.id === f.sub) || {}).name || ''));
  if (f.fam) parts.push('Loại: ' + (FAMS.find(x => x[0] === f.fam) || [])[1]);
  if (f.thk) parts.push('Độ dày: ' + f.thk + ' mm'); if (f.kind) parts.push('Phân loại: ' + f.kind);
  if (f.loc) parts.push('Vị trí: ' + (f.loc === 'kho' ? 'Kho tổng' : f.loc)); if (f.cond) parts.push('Tình trạng: ' + COND[f.cond][0]);
  if (f.has) parts.push('Chỉ dòng có tồn'); if (f.out) parts.push('Chỉ hết hàng'); if (f.low) parts.push('Dưới tồn tối thiểu');
  if (f.q) parts.push(`Tìm: "${f.q}"`);
  return parts.join(' · ') || 'Toàn bộ kho';
}
function exportStockReport() {
  const list = stockRows(); if (!list.length) return toast('Không có dữ liệu để xuất', 'err');
  const dd = D(), now = fmtDT(new Date().toISOString());
  const head = ['STT', 'Mã VT', 'Tên vật tư', 'Quy cách', 'Nhóm', 'Nhóm con', 'Độ dày (mm)', 'Phân loại', 'Mã phủ', 'ĐVT', 'Vị trí', 'Vị trí chi tiết', 'Tình trạng', 'Tồn', 'Đang giữ cho PR', 'Còn trống', 'Tồn tối thiểu', 'Cập nhật', 'Ghi chú'];
  const rows = list.map(({ s, m }, i) => {
    const a = attrsOf(m); const reserved = s ? round6(dd.openKhoByStock.get(s.id) || 0) : 0;
    return [i + 1, m.code, m.name, m.spec || '', groupName(m.group_code), (S.subgroups.find(x => x.id === m.subgroup_id) || {}).name || '', a.thk ? Number(a.thk) : '', a.kind, a.coat, m.unit,
      s ? locLabel(s.site_id) : 'Kho tổng', s ? s.location_detail || '' : '', s ? COND[s.condition][0] : '', s ? Number(s.qty) : 0, reserved || '',
      s && !s.site_id && USABLE.includes(s.condition) ? round6(Number(s.qty) - reserved) : '', s && s.min_qty != null ? Number(s.min_qty) : '', s ? fmtDT(s.updated_at) : 'chưa khai báo', s ? s.note || '' : ''];
  });
  const title = [[`BÁO CÁO TỒN KHO — ${CONFIG.COMPANY}`], [`Ngày xuất: ${now} · Người xuất: ${profName(S.user.id)}`], [`Bộ lọc: ${filterDesc()}`], [`Số dòng: ${rows.length}`], []];
  // Tổng hợp theo nhóm + phân loại + ĐVT
  const sum = new Map();
  for (const { s, m } of list) {
    const a = attrsOf(m); const k = [groupName(m.group_code), a.kind || '', a.thk || '', m.unit].join('\u0001');
    const r = sum.get(k) || { lines: 0, qty: 0, held: 0, out: 0 };
    r.lines++; if (s) { r.qty += Number(s.qty); r.held += dd.openKhoByStock.get(s.id) || 0; } if (!s || Number(s.qty) <= 0) r.out++;
    sum.set(k, r);
  }
  const sumRows = [...sum].sort(([a], [b]) => a.localeCompare(b, 'vi')).map(([k, r]) => { const [g, kind, thk, unit] = k.split('\u0001'); return [g, kind, thk ? Number(thk) : '', unit, r.lines, round6(r.qty), round6(r.held) || '', r.out || '']; });
  exportBook([
    { name: 'Ton kho', aoa: [...title, head, ...rows], cols: [5, 12, 40, 18, 18, 16, 10, 18, 14, 7, 16, 18, 14, 10, 12, 10, 10, 17, 24], merges: [0, 1, 2, 3].map(r => ({ s: { r, c: 0 }, e: { r, c: 8 } })) },
    { name: 'Tong hop', aoa: [...title.slice(0, 3), [], ['Nhóm', 'Phân loại', 'Độ dày (mm)', 'ĐVT', 'Số mã / dòng', 'Tổng tồn', 'Đang giữ', 'Số dòng hết hàng'], ...sumRows], cols: [22, 20, 12, 8, 12, 12, 10, 14] },
  ], `bao-cao-ton-kho-${todayISO()}`);
}

/* ---------- Sự kiện ---------- */
const onS = debounce(() => renderStock(), 200), onA = debounce(() => renderAssets(), 200);
INPUTS.push(e => {
  const t = e.target;
  if (t.dataset.sfilter) {
    const k = t.dataset.sfilter, f = S.sfilters; f[k] = t.type === 'checkbox' ? t.checked : t.value;
    if (k === 'out' && f.out) f.has = false; if (k === 'has' && f.has) f.out = false;
    if (k === 'out' || k === 'has') { hooks.render(); return true; }
    onS(); return true;
  }
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
  'sf-group': b => { const f = S.sfilters; f.group = f.group === b.dataset.v ? '' : b.dataset.v; f.sub = ''; renderStock(); },
  'sf-fam': b => { const f = S.sfilters; f.fam = f.fam === b.dataset.v ? '' : b.dataset.v; renderStock(); },
  'sf-dir': () => { S.sfilters.dir = -(S.sfilters.dir || 1); renderStock(); },
  'stock-sort': b => { const f = S.sfilters; if (f.sort === b.dataset.k) f.dir = -(f.dir || 1); else { f.sort = b.dataset.k; f.dir = 1; } renderStock(); },
  'sf-clear': () => { Object.assign(S.sfilters, { q: '', group: '', sub: '', thk: '', kind: '', fam: '', loc: '', cond: '', out: false, low: false }); hooks.render(); },
  'stock-import': () => stockImport(),
  'stock-template': () => stockTemplate(),
  'stock-export': () => exportStockReport(),
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
