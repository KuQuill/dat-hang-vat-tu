// Dự án / công trường: mã dự án (dùng trong số PR), tên dự án, địa chỉ, chỉ huy trưởng
import { S, ctx, ACT, VIEWS, hooks, $, esc, modal, runAction, isMgr, profName } from './core.js';

VIEWS.sites = {
  title: 'Dự án',
  show: () => isMgr(),
  html() {
    return `<section class="card mb">
        <div class="toolbar"><div><h3>🏗 Dự án / công trường</h3>
          <div class="small muted">Mã dự án là phần đầu của số PR, vd <span class="mono">SSD.MEP.PR01.R1</span>. Dự án đã có PR thì không đổi được mã.</div></div>
          <span class="spacer"></span><button class="btn primary" data-act="site-new">＋ Thêm dự án</button></div>
      </section>
      <div id="sites-table"></div>
      <section class="card mt">
        <div class="toolbar"><div><h3>🧱 Hạng mục thi công</h3>
          <div class="small muted">Mã hạng mục là phần thứ hai của số PR, vd <span class="mono">SSD.<b>MEP</b>.PR01.R1</span>. Người đặt hàng chọn hạng mục khi lập PR.</div></div>
          <span class="spacer"></span><button class="btn" data-act="wc-new">＋ Thêm hạng mục</button></div>
        <div id="wc-table" class="mt"></div>
      </section>`;
  },
  after() { renderSites(); renderWC(); },
  refresh() { if ($('#sites-table')) { renderSites(); renderWC(); } else hooks.render(); },
};
function renderSites() {
  const list = [...S.sites].sort((a, b) => (b.active !== false) - (a.active !== false) || a.code.localeCompare(b.code));
  const count = id => S.prs.filter(p => p.site_id === id).length;
  const people = id => S.profiles.filter(p => p.site_id === id && p.active !== false).length;
  $('#sites-table').innerHTML = list.length ? `<div class="table-wrap"><table class="sites-table">
    <thead><tr><th>Mã dự án</th><th>Tên dự án</th><th>Địa chỉ</th><th>Chỉ huy trưởng</th><th class="right">Số PR</th><th class="right">Nhân sự</th><th>Trạng thái</th><th></th></tr></thead>
    <tbody>${list.map(s => `<tr class="${s.active === false ? 'muted-row' : ''}">
      <td class="mono"><b>${esc(s.code)}</b></td><td>${esc(s.name)}${s.is_workshop ? ' <span class="badge b-violet">🏭 Xưởng</span>' : ''}</td><td class="small">${esc(s.address || '')}</td><td>${esc(s.manager || '')}</td>
      <td class="right">${count(s.id)}</td><td class="right">${people(s.id)}</td>
      <td>${s.active === false ? '<span class="badge b-gray">Ngừng</span>' : '<span class="badge b-green">Đang thi công</span>'}</td>
      <td><button class="btn sm" data-act="site-edit" data-id="${s.id}">✏ Sửa</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="card empty">Chưa có dự án nào. Bấm ＋ Thêm dự án.</div>';
}
async function siteDialog(s) {
  const hasPR = s && S.prs.some(p => p.site_id === s.id);
  const { action, data } = await modal({
    title: s ? `Sửa dự án ${s.code}` : 'Thêm dự án / công trường',
    body: `<div class="form">
      <label class="f"><span class="req">Mã dự án</span><input id="st-code" value="${esc(s ? s.code : '')}" maxlength="15" class="upper" placeholder="vd: SSD" ${hasPR ? 'readonly title="Dự án đã có PR, không đổi được mã"' : ''}></label>
      <label class="f full"><span class="req">Tên dự án</span><input id="st-name" value="${esc(s ? s.name : '')}" placeholder="vd: Nhà máy SSD — Long An"></label>
      <label class="f full">Địa chỉ<input id="st-addr" value="${esc(s ? s.address || '' : '')}"></label>
      <label class="f">Chỉ huy trưởng<input id="st-mgr" value="${esc(s ? s.manager || '' : '')}"></label>
      <label class="f full chk"><input type="checkbox" id="st-ws" ${s && s.is_workshop ? 'checked' : ''}> <span>🏭 Là <b>xưởng sản xuất</b> (vd xưởng nội thất) — PR của xưởng được chia số lượng từng dòng cho nhiều dự án</span></label>
      <label class="f"><span>Trạng thái</span><select id="st-active"><option value="1" ${!s || s.active !== false ? 'selected' : ''}>Đang thi công</option><option value="0" ${s && s.active === false ? 'selected' : ''}>Ngừng (ẩn khỏi danh sách đặt hàng)</option></select></label></div>
      <p class="small muted">Mã dự án: 2–15 ký tự chữ in hoa, số hoặc gạch ngang.</p>`,
    actions: [{ label: 'Huỷ', value: null }, { label: s ? 'Lưu' : 'Thêm dự án', value: 'ok', primary: true,
      validate: v => !/^[A-Z0-9-]{2,15}$/.test(v.code) ? 'Mã dự án gồm 2–15 ký tự chữ in hoa / số / gạch ngang' : !v.name.trim() ? 'Nhập tên dự án' : null }],
    read: ov => ({ code: $('#st-code', ov).value.replace(/\s/g, '').toUpperCase(), name: $('#st-name', ov).value, address: $('#st-addr', ov).value,
                   manager: $('#st-mgr', ov).value, active: $('#st-active', ov).value === '1', is_workshop: $('#st-ws', ov).checked }),
  });
  if (action === 'ok') runAction(() => ctx.B.upsertSite({ id: s ? s.id : null, ...data }), s ? `Đã lưu dự án ${data.code}` : `Đã thêm dự án ${data.code}`);
}
function renderWC() {
  const list = [...(S.workCats || [])].sort((a, b) => (b.active !== false) - (a.active !== false) || a.sort - b.sort || a.code.localeCompare(b.code));
  const used = c => S.prs.filter(p => p.category === c).length;
  $('#wc-table').innerHTML = `<div class="table-wrap"><table class="sites-table"><thead><tr><th>Mã</th><th>Tên hạng mục thi công</th><th class="right">Thứ tự</th><th class="right">Số PR</th><th>Trạng thái</th><th></th></tr></thead>
    <tbody>${list.map(w => `<tr class="${w.active === false ? 'muted-row' : ''}"><td class="mono"><b>${esc(w.code)}</b></td><td>${esc(w.name)}</td><td class="right">${w.sort}</td><td class="right">${used(w.code)}</td>
      <td>${w.active === false ? '<span class="badge b-gray">Ẩn</span>' : '<span class="badge b-green">Đang dùng</span>'}</td>
      <td><button class="btn sm" data-act="wc-edit" data-code="${esc(w.code)}">✏ Sửa</button></td></tr>`).join('')}</tbody></table></div>`;
}
async function wcDialog(w) {
  const { action, data } = await modal({
    title: w ? `Sửa hạng mục ${w.code}` : 'Thêm hạng mục thi công',
    body: `<div class="form">
      <label class="f"><span class="req">Mã hạng mục</span><input id="wc-code" value="${esc(w ? w.code : '')}" maxlength="6" class="upper" placeholder="vd: MEP" ${w ? 'readonly' : ''}></label>
      <label class="f">Thứ tự hiển thị<input id="wc-sort" inputmode="numeric" value="${w ? w.sort : 100}"></label>
      <label class="f full"><span class="req">Tên hạng mục</span><input id="wc-name" value="${esc(w ? w.name : '')}" placeholder="vd: Cơ điện (M&E)"></label>
      <label class="f"><span>Trạng thái</span><select id="wc-active"><option value="1" ${!w || w.active !== false ? 'selected' : ''}>Đang dùng</option><option value="0" ${w && w.active === false ? 'selected' : ''}>Ẩn khỏi danh sách đặt hàng</option></select></label></div>`,
    actions: [{ label: 'Huỷ', value: null }, { label: w ? 'Lưu' : 'Thêm', value: 'ok', primary: true,
      validate: v => !/^[A-Z0-9]{1,6}$/.test(v.code) ? 'Mã hạng mục gồm 1–6 chữ in hoa hoặc số' : !v.name.trim() ? 'Nhập tên hạng mục' : null }],
    read: ov => ({ code: $('#wc-code', ov).value.replace(/\s/g, '').toUpperCase(), name: $('#wc-name', ov).value, sort: Number($('#wc-sort', ov).value) || 100, active: $('#wc-active', ov).value === '1' }),
  });
  if (action === 'ok') runAction(() => ctx.B.upsertWorkCategory(data), `Đã lưu hạng mục ${data.code}`);
}
Object.assign(ACT, {
  'wc-new': () => wcDialog(null),
  'wc-edit': b => wcDialog((S.workCats || []).find(w => w.code === b.dataset.code)),
  'site-new': () => siteDialog(null),
  'site-edit': b => siteDialog(S.sites.find(x => x.id === b.dataset.id)),
});
