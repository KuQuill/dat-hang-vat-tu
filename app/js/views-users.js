// Sheet 6 — Tài khoản (chỉ quản trị)
import { S, ctx, ACT, VIEWS, INPUTS, DEMO, hooks, $, esc, norm, debounce, modal, runAction, ROLE, siteOptions, isAdmin, genPassword } from './core.js';

VIEWS.users = {
  title: 'Tài khoản',
  show: () => isAdmin(),
  html() {
    return `<section class="card mb">
        <div class="toolbar"><div><h3>👥 Tài khoản người dùng</h3><div class="small muted">Công ty cấp email + mật khẩu cho từng người. Quyền <b>Thu mua</b> chỉ xem và cập nhật đề xuất mua.</div></div>
          <span class="spacer"></span><input data-ufilter value="${esc(S.ufilter)}" placeholder="🔍 Tìm tên, email…" class="w240">
          <button class="btn primary" data-act="user-new">＋ Tạo tài khoản</button></div>
        ${DEMO ? '' : '<p class="small muted mt">Cần triển khai Edge Function <span class="mono">admin-users</span> (xem README) để tạo, khoá tài khoản và đặt lại mật khẩu từ đây.</p>'}
      </section>
      <div id="users-table"></div>`;
  },
  after() { renderUsers(); },
  refresh() { if ($('#users-table')) renderUsers(); else hooks.render(); },
};
function renderUsers() {
  const q = norm(S.ufilter);
  const list = S.profiles.filter(p => !q || norm([p.full_name, p.email, p.phone].join(' ')).includes(q))
    .sort((a, b) => (b.active - a.active) || String(a.full_name || '').localeCompare(String(b.full_name || '')));
  const roleOpts = sel => Object.entries(ROLE).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`).join('');
  $('#users-table').innerHTML = `<div class="table-wrap"><table class="users-table">
    <thead><tr><th>Họ tên</th><th>Email đăng nhập</th><th>SĐT</th><th>Quyền</th><th>Công trường</th><th>Hoạt động</th><th></th></tr></thead>
    <tbody>${list.map(p => `<tr data-uid="${p.id}" class="${p.active === false ? 'muted-row' : ''}">
      <td><input data-u="full_name" value="${esc(p.full_name || '')}"></td>
      <td class="small">${esc(p.email || '')}${p.id === S.user.id ? ' <span class="badge b-gray">bạn</span>' : ''}</td>
      <td><input data-u="phone" value="${esc(p.phone || '')}" class="w130"></td>
      <td><select data-u="role">${roleOpts(p.role)}</select></td>
      <td><select data-u="site_id">${siteOptions(p.site_id || '', '—', true)}</select></td>
      <td><label class="nowrap"><input type="checkbox" data-u="active" ${p.active !== false ? 'checked' : ''}> ${p.active !== false ? 'Đang dùng' : 'Đã khoá'}</label></td>
      <td class="nowrap"><button class="btn sm" data-act="user-save" data-uid="${p.id}">Lưu</button> <button class="btn sm" data-act="user-reset" data-uid="${p.id}">Đặt lại MK</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}
const onU = debounce(renderUsers, 200);
INPUTS.push(e => { if ('ufilter' in e.target.dataset) { S.ufilter = e.target.value; onU(); return true; } return false; });

Object.assign(ACT, {
  'user-new': async () => {
    const pw = genPassword();
    const roleOpts = Object.entries(ROLE).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
    const { action, data } = await modal({
      title: 'Tạo tài khoản mới',
      body: `<div class="form">
        <label class="f full"><span class="req">Email công ty</span><input id="un-email" type="email" placeholder="ten@congty.vn"></label>
        <label class="f"><span class="req">Họ tên</span><input id="un-name"></label><label class="f">SĐT<input id="un-phone"></label>
        <label class="f">Quyền<select id="un-role">${roleOpts}</select></label>
        <label class="f">Công trường<select id="un-site">${siteOptions('', '—', true)}</select></label>
        <label class="f full"><span class="req">Mật khẩu ban đầu</span><input id="un-pw" value="${pw}"></label></div>
        <p class="small muted">Gửi email + mật khẩu cho người dùng qua kênh nội bộ. Họ nên đổi mật khẩu sau lần đăng nhập đầu.</p>`,
      actions: [{ label: 'Huỷ', value: null }, { label: 'Tạo tài khoản', value: 'ok', primary: true,
        validate: d => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim()) ? 'Email không hợp lệ' : !d.full_name.trim() ? 'Nhập họ tên' : d.password.length < 8 ? 'Mật khẩu tối thiểu 8 ký tự' : null }],
      read: ov => ({ email: $('#un-email', ov).value, full_name: $('#un-name', ov).value, phone: $('#un-phone', ov).value, role: $('#un-role', ov).value, site_id: $('#un-site', ov).value, password: $('#un-pw', ov).value }),
    });
    if (action !== 'ok') return;
    const ok = await runAction(() => ctx.B.adminUsers({ action: 'create', ...data }));
    if (ok) modal({ title: '✅ Đã tạo tài khoản', body: `<dl class="kv"><dt>Email</dt><dd class="mono">${esc(data.email.trim().toLowerCase())}</dd><dt>Mật khẩu</dt><dd class="mono">${esc(data.password)}</dd><dt>Quyền</dt><dd>${esc(ROLE[data.role])}</dd></dl>
      <p class="small muted">Mật khẩu sẽ không hiển thị lại.</p>`, actions: [{ label: 'Đã ghi lại', value: 'ok', primary: true }] });
  },
  'user-save': b => {
    const tr = b.closest('tr'); const v = k => $(`[data-u="${k}"]`, tr);
    runAction(() => ctx.B.adminUsers({ action: 'update', id: b.dataset.uid, full_name: v('full_name').value, phone: v('phone').value, role: v('role').value, site_id: v('site_id').value, active: v('active').checked }), 'Đã lưu tài khoản');
  },
  'user-reset': async b => {
    const p = S.profiles.find(x => x.id === b.dataset.uid); const pw = genPassword();
    const { action, data } = await modal({ title: `Đặt lại mật khẩu — ${p ? p.email : ''}`, body: `<label class="f">Mật khẩu mới<input id="rp" value="${pw}"></label><p class="small muted">Gửi mật khẩu mới cho người dùng qua kênh nội bộ.</p>`,
      actions: [{ label: 'Huỷ', value: null }, { label: 'Đặt lại', value: 'ok', primary: true, validate: d => d.length < 8 ? 'Mật khẩu tối thiểu 8 ký tự' : null }], read: ov => $('#rp', ov).value });
    if (action === 'ok') runAction(() => ctx.B.adminUsers({ action: 'reset_password', id: b.dataset.uid, password: data }), 'Đã đặt lại mật khẩu');
  },
});
