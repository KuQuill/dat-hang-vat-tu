// Tài khoản (chỉ quản trị): tạo lẻ, nhập hàng loạt từ CSV, sửa quyền / dự án, khoá, đặt lại mật khẩu
import { S, ctx, ACT, VIEWS, INPUTS, DEMO, hooks, $, esc, norm, debounce, modal, toast, runAction, ROLE, siteOptions, siteByCode, isAdmin,
         genPassword, downloadText, parsePaste } from './core.js';

VIEWS.users = {
  title: 'Tài khoản',
  show: () => isAdmin(),
  html() {
    return `<section class="card mb">
        <div class="toolbar"><div><h3>👥 Tài khoản người dùng</h3><div class="small muted">Công ty cấp email + mật khẩu cho từng người. <b>Công trường</b>: đặt hàng, nhận hàng, thu hồi / sửa / huỷ PR của mình, xuất PDF · <b>Quản lý</b>: như công trường cho mọi dự án + duyệt PR + khai báo dự án · <b>Phòng vật tư</b>: kho, tài sản, giao hàng, ETA, đề xuất mua · <b>Quản trị</b>: toàn quyền.</div></div>
          <span class="spacer"></span><input data-ufilter value="${esc(S.ufilter)}" placeholder="🔍 Tìm tên, email…" class="w240">
          <button class="btn" data-act="user-csv">📋 Nhập CSV hàng loạt</button>
          <button class="btn primary" data-act="user-new">＋ Tạo tài khoản</button></div>
        ${DEMO ? '' : '<p class="small muted mt">Tạo / khoá tài khoản và đặt lại mật khẩu dùng Edge Function <span class="mono">admin-users</span>.</p>'}
      </section>
      <div id="users-table"></div>`;
  },
  after() { renderUsers(); },
  refresh() { if ($('#users-table')) renderUsers(); else hooks.render(); },
};
function renderUsers() {
  const q = norm(S.ufilter);
  const list = S.profiles.filter(p => !q || norm([p.full_name, p.email].join(' ')).includes(q))
    .sort((a, b) => (b.active - a.active) || String(a.full_name || '').localeCompare(String(b.full_name || '')));
  const roleOpts = sel => Object.entries(ROLE).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`).join('');
  $('#users-table').innerHTML = `<div class="table-wrap"><table class="users-table">
    <thead><tr><th>Họ tên</th><th>Email đăng nhập</th><th>Quyền</th><th>Dự án / công trường</th><th>Hoạt động</th><th></th></tr></thead>
    <tbody>${list.map(p => `<tr data-uid="${p.id}" class="${p.active === false ? 'muted-row' : ''}">
      <td><input data-u="full_name" value="${esc(p.full_name || '')}"></td>
      <td class="small">${esc(p.email || '')}${p.id === S.user.id ? ' <span class="badge b-gray">bạn</span>' : ''}</td>
      <td><select data-u="role">${roleOpts(p.role)}</select></td>
      <td><select data-u="site_id">${siteOptions(p.site_id || '', '—', true)}</select></td>
      <td><label class="nowrap"><input type="checkbox" data-u="active" ${p.active !== false ? 'checked' : ''}> ${p.active !== false ? 'Đang dùng' : 'Đã khoá'}</label></td>
      <td class="nowrap"><button class="btn sm" data-act="user-save" data-uid="${p.id}">Lưu</button> <button class="btn sm" data-act="user-reset" data-uid="${p.id}">Đặt lại MK</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}
const onU = debounce(renderUsers, 200);
INPUTS.push(e => { if ('ufilter' in e.target.dataset) { S.ufilter = e.target.value; onU(); return true; } return false; });

/* ---------- Nhập CSV hàng loạt ---------- */
const CSV_HEAD = ['Họ tên', 'Email', 'Mật khẩu', 'Quyền', 'Mã dự án'];
// Quyền: chấp nhận mã (site/manager/procurement/admin) hoặc tên tiếng Việt; "Thu mua" → Phòng vật tư
function parseRole(v) {
  const n = norm(v).replace(/[_-]/g, ' ');
  if (!n || ['site', 'cong truong', 'nhan vien', 'nhan vien cong truong'].includes(n)) return 'site';
  if (['manager', 'quan ly', 'quan ly du an', 'giam doc du an'].includes(n)) return 'manager';
  if (['procurement', 'phong vat tu', 'vat tu', 'purchasing', 'thu mua'].includes(n)) return 'procurement';
  if (['admin', 'quan tri'].includes(n)) return 'admin';
  return null;
}
// Đọc CSV (dấu phẩy hoặc chấm phẩy, có ngoặc kép) hoặc dữ liệu dán từ Excel (tab)
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  if (text.includes('\t')) return parsePaste(text);
  const first = text.split(/\r?\n/)[0] || ''; const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some(x => x)) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell.trim()); if (row.some(x => x)) rows.push(row);
  return rows;
}
function csvRows(text) {
  let rows = parseCSV(text);
  if (rows.length && /email/i.test((rows[0] || []).join(' '))) rows = rows.slice(1);
  return rows.map((c, k) => {
    const r = { n: k + 1, full_name: c[0] || '', email: (c[1] || '').toLowerCase(), password: c[2] || '', roleRaw: c[3] || '', site: c[4] || '', errors: [] };
    r.role = parseRole(r.roleRaw);
    if (!r.full_name) r.errors.push('thiếu họ tên');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) r.errors.push('email không hợp lệ');
    if (!r.password) r.password = genPassword(), r.generated = true;
    else if (r.password.length < 8) r.errors.push('mật khẩu < 8 ký tự');
    if (!r.role) r.errors.push(`quyền "${r.roleRaw}" không hợp lệ`);
    if (r.site && !siteByCode(r.site)) r.errors.push(`không có dự án ${r.site}`);
    if (S.profiles.some(p => (p.email || '').toLowerCase() === r.email)) r.errors.push('email đã có tài khoản');
    return r;
  });
}
async function importUsers() {
  const roleList = Object.entries(ROLE).map(([k, l]) => `<b>${l}</b> (${k})`).join(', ');
  let fileText = '';
  const { action, data } = await modal({
    title: 'Nhập tài khoản hàng loạt từ CSV', wide: true,
    body: `<p class="small">Các cột: <b>${CSV_HEAD.join(' · ')}</b>. Mật khẩu để trống → hệ thống tự tạo. Quyền: ${roleList}. Mã dự án để trống nếu không thuộc dự án nào.</p>
      <div class="toolbar mb"><button class="btn sm" id="uc-file" type="button">📂 Chọn file .csv</button><span class="small muted" id="uc-fname"></span><span class="spacer"></span>
        <button class="btn sm" id="uc-tpl" type="button">⬇ File mẫu</button></div>
      <textarea id="uc-box" rows="9" placeholder="Họ tên,Email,Mật khẩu,Quyền,Mã dự án&#10;Nguyễn Văn A,a.nguyen@congty.vn,,Công trường,SSD&#10;Trần Thị B,b.tran@congty.vn,MatKhau123,Phòng vật tư,"></textarea>
      <div id="uc-preview" class="mt"></div>`,
    onOpen: ov => {
      const box = $('#uc-box', ov);
      const preview = () => {
        const rows = csvRows(box.value); const bad = rows.filter(r => r.errors.length);
        $('#uc-preview', ov).innerHTML = rows.length ? `<p class="small">${rows.length} dòng · <span class="ok-text">${rows.length - bad.length} hợp lệ</span>${bad.length ? ` · <span class="late-text">${bad.length} lỗi (sẽ bỏ qua)</span>` : ''}</p>
          <div class="table-wrap"><table><thead><tr><th>#</th><th>Họ tên</th><th>Email</th><th>Quyền</th><th>Dự án</th><th>Kiểm tra</th></tr></thead><tbody>
          ${rows.slice(0, 200).map(r => `<tr><td>${r.n}</td><td>${esc(r.full_name)}</td><td class="small">${esc(r.email)}</td><td>${esc(ROLE[r.role] || r.roleRaw)}</td><td>${esc(r.site)}</td>
            <td class="small">${r.errors.length ? `<span class="late-text">${esc(r.errors.join(', '))}</span>` : `<span class="ok-text">OK</span>${r.generated ? ' · MK tự tạo' : ''}`}</td></tr>`).join('')}</tbody></table></div>` : '';
      };
      box.addEventListener('input', debounce(preview, 250));
      $('#uc-tpl', ov).addEventListener('click', () => downloadText('﻿' + [CSV_HEAD.join(','), 'Nguyễn Văn A,a.nguyen@congty.vn,,Công trường,SSD', 'Trần Thị B,b.tran@congty.vn,MatKhau123,Phòng vật tư,', 'Lê Văn C,c.le@congty.vn,,Quản lý,'].join('\r\n'), 'mau-tai-khoan.csv', 'text/csv;charset=utf-8'));
      $('#uc-file', ov).addEventListener('click', () => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,text/csv,.txt';
        inp.onchange = async () => { const f = inp.files[0]; if (!f) return; fileText = await f.text(); box.value = fileText; $('#uc-fname', ov).textContent = f.name; preview(); };
        inp.click();
      });
    },
    actions: [{ label: 'Huỷ', value: null }, { label: 'Tạo các tài khoản hợp lệ', value: 'ok', primary: true,
      validate: v => { const rows = csvRows(v); return !rows.length ? 'Chưa có dòng dữ liệu nào' : !rows.some(r => !r.errors.length) ? 'Không có dòng nào hợp lệ' : null; } }],
    read: ov => $('#uc-box', ov).value,
  });
  if (action !== 'ok') return;
  const rows = csvRows(data).filter(r => !r.errors.length);
  const done = [], failed = [];
  toast(`Đang tạo ${rows.length} tài khoản…`, '');
  for (const r of rows) {
    try {
      const s = r.site ? siteByCode(r.site) : null;
      await ctx.B.adminUsers({ action: 'create', email: r.email, password: r.password, full_name: r.full_name, role: r.role, site_id: s ? s.id : '' });
      done.push(r);
    } catch (e) { failed.push({ ...r, err: e.message }); }
  }
  await hooks.pull().catch(() => {}); hooks.refresh();
  const csvOut = '﻿' + ['Họ tên,Email,Mật khẩu,Quyền,Mã dự án', ...done.map(r => [r.full_name, r.email, r.password, ROLE[r.role], r.site].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\r\n');
  await modal({ title: 'Kết quả nhập tài khoản', body: `<p>Đã tạo <b>${done.length}</b>/${rows.length} tài khoản.</p>
      ${failed.length ? `<p class="late-text">Lỗi ${failed.length} dòng:</p><ul>${failed.map(f => `<li>${esc(f.email)}: ${esc(f.err)}</li>`).join('')}</ul>` : ''}
      ${done.length ? '<p class="small muted">Tải danh sách email + mật khẩu để gửi cho từng người qua kênh nội bộ. Mật khẩu sẽ không hiển thị lại.</p>' : ''}`,
    actions: [...(done.length ? [{ label: '⬇ Tải danh sách mật khẩu', value: 'dl', primary: true }] : []), { label: 'Đóng', value: null }] })
    .then(({ action: a }) => { if (a === 'dl') downloadText(csvOut, 'tai-khoan-da-tao.csv', 'text/csv;charset=utf-8'); });
}

Object.assign(ACT, {
  'user-csv': () => importUsers(),
  'user-new': async () => {
    const pw = genPassword();
    const roleOpts = Object.entries(ROLE).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
    const { action, data } = await modal({
      title: 'Tạo tài khoản mới',
      body: `<div class="form">
        <label class="f full"><span class="req">Email công ty</span><input id="un-email" type="email" placeholder="ten@congty.vn"></label>
        <label class="f full"><span class="req">Họ tên</span><input id="un-name"></label>
        <label class="f">Quyền<select id="un-role">${roleOpts}</select></label>
        <label class="f">Dự án / công trường<select id="un-site">${siteOptions('', '—', true)}</select></label>
        <label class="f full"><span class="req">Mật khẩu ban đầu</span><input id="un-pw" value="${pw}"></label></div>
        <p class="small muted">Gửi email + mật khẩu cho người dùng qua kênh nội bộ. Họ nên đổi mật khẩu sau lần đăng nhập đầu.</p>`,
      actions: [{ label: 'Huỷ', value: null }, { label: 'Tạo tài khoản', value: 'ok', primary: true,
        validate: d => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim()) ? 'Email không hợp lệ' : !d.full_name.trim() ? 'Nhập họ tên' : d.password.length < 8 ? 'Mật khẩu tối thiểu 8 ký tự' : null }],
      read: ov => ({ email: $('#un-email', ov).value, full_name: $('#un-name', ov).value, role: $('#un-role', ov).value, site_id: $('#un-site', ov).value, password: $('#un-pw', ov).value }),
    });
    if (action !== 'ok') return;
    const ok = await runAction(() => ctx.B.adminUsers({ action: 'create', ...data }));
    if (ok) modal({ title: '✅ Đã tạo tài khoản', body: `<dl class="kv"><dt>Email</dt><dd class="mono">${esc(data.email.trim().toLowerCase())}</dd><dt>Mật khẩu</dt><dd class="mono">${esc(data.password)}</dd><dt>Quyền</dt><dd>${esc(ROLE[data.role])}</dd></dl>
      <p class="small muted">Mật khẩu sẽ không hiển thị lại.</p>`, actions: [{ label: 'Đã ghi lại', value: 'ok', primary: true }] });
  },
  'user-save': b => {
    const tr = b.closest('tr'); const v = k => $(`[data-u="${k}"]`, tr);
    runAction(() => ctx.B.adminUsers({ action: 'update', id: b.dataset.uid, full_name: v('full_name').value, role: v('role').value, site_id: v('site_id').value, active: v('active').checked }), 'Đã lưu tài khoản');
  },
  'user-reset': async b => {
    const p = S.profiles.find(x => x.id === b.dataset.uid); const pw = genPassword();
    const { action, data } = await modal({ title: `Đặt lại mật khẩu — ${p ? p.email : ''}`, body: `<label class="f">Mật khẩu mới<input id="rp" value="${pw}"></label><p class="small muted">Gửi mật khẩu mới cho người dùng qua kênh nội bộ.</p>`,
      actions: [{ label: 'Huỷ', value: null }, { label: 'Đặt lại', value: 'ok', primary: true, validate: d => d.length < 8 ? 'Mật khẩu tối thiểu 8 ký tự' : null }], read: ov => $('#rp', ov).value });
    if (action === 'ok') runAction(() => ctx.B.adminUsers({ action: 'reset_password', id: b.dataset.uid, password: data }), 'Đã đặt lại mật khẩu');
  },
});
