// Dự án / công trường: mã dự án (dùng trong số PR), tên dự án, địa chỉ, chỉ huy trưởng
import { S, ctx, ACT, VIEWS, hooks, $, esc, modal, runAction, isStaff, profName } from './core.js';

VIEWS.sites = {
  title: 'Dự án',
  show: () => isStaff(),
  html() {
    return `<section class="card mb">
        <div class="toolbar"><div><h3>🏗 Dự án / công trường</h3>
          <div class="small muted">Mã dự án là phần đầu của số PR, vd <span class="mono">SSD.MEP.PR01.R1</span>. Dự án đã có PR thì không đổi được mã.</div></div>
          <span class="spacer"></span><button class="btn primary" data-act="site-new">＋ Thêm dự án</button></div>
      </section>
      <div id="sites-table"></div>`;
  },
  after() { renderSites(); },
  refresh() { if ($('#sites-table')) renderSites(); else hooks.render(); },
};
function renderSites() {
  const list = [...S.sites].sort((a, b) => (b.active !== false) - (a.active !== false) || a.code.localeCompare(b.code));
  const count = id => S.prs.filter(p => p.site_id === id).length;
  const people = id => S.profiles.filter(p => p.site_id === id && p.active !== false).length;
  $('#sites-table').innerHTML = list.length ? `<div class="table-wrap"><table class="sites-table">
    <thead><tr><th>Mã dự án</th><th>Tên dự án</th><th>Địa chỉ</th><th>Chỉ huy trưởng</th><th class="right">Số PR</th><th class="right">Nhân sự</th><th>Trạng thái</th><th></th></tr></thead>
    <tbody>${list.map(s => `<tr class="${s.active === false ? 'muted-row' : ''}">
      <td class="mono"><b>${esc(s.code)}</b></td><td>${esc(s.name)}</td><td class="small">${esc(s.address || '')}</td><td>${esc(s.manager || '')}</td>
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
      <label class="f"><span>Trạng thái</span><select id="st-active"><option value="1" ${!s || s.active !== false ? 'selected' : ''}>Đang thi công</option><option value="0" ${s && s.active === false ? 'selected' : ''}>Ngừng (ẩn khỏi danh sách đặt hàng)</option></select></label></div>
      <p class="small muted">Mã dự án: 2–15 ký tự chữ in hoa, số hoặc gạch ngang.</p>`,
    actions: [{ label: 'Huỷ', value: null }, { label: s ? 'Lưu' : 'Thêm dự án', value: 'ok', primary: true,
      validate: v => !/^[A-Z0-9-]{2,15}$/.test(v.code) ? 'Mã dự án gồm 2–15 ký tự chữ in hoa / số / gạch ngang' : !v.name.trim() ? 'Nhập tên dự án' : null }],
    read: ov => ({ code: $('#st-code', ov).value.replace(/\s/g, '').toUpperCase(), name: $('#st-name', ov).value, address: $('#st-addr', ov).value,
                   manager: $('#st-mgr', ov).value, active: $('#st-active', ov).value === '1' }),
  });
  if (action === 'ok') runAction(() => ctx.B.upsertSite({ id: s ? s.id : null, ...data }), s ? `Đã lưu dự án ${data.code}` : `Đã thêm dự án ${data.code}`);
}
Object.assign(ACT, {
  'site-new': () => siteDialog(null),
  'site-edit': b => siteDialog(S.sites.find(x => x.id === b.dataset.id)),
});
