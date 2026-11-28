// Trang chat quản lý (chat.html): chỉ admin / giám đốc. Lịch sử hội thoại, kéo thả file,
// nạp hồ sơ dự án (Master Data) và phát hành biểu mẫu mới.
import { ApiError, ENABLED, api, autoHide, esc, filesHtml, hasSession, md, notStaffHtml } from './chatbot-core.js';

const ICON_CLIP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l8-8"/></svg>';
const ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
const ICON_MENU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';

const DOC_TYPES = [['drawing', 'Bản vẽ'], ['contract', 'Hợp đồng'], ['boq', 'BoQ gốc'], ['material_list', 'Danh mục vật liệu duyệt'], ['spec', 'Chỉ dẫn kỹ thuật']];
const DOC_STATUS = [['approved', 'Approved (dùng làm căn cứ)'], ['draft', 'Draft (bản nháp)'], ['superseded', 'Superseded (hết hiệu lực)']];
const FORM_CATS = [['procurement', 'Vật tư'], ['qc', 'QC'], ['qs', 'QS'], ['report', 'Báo cáo'], ['contract', 'Hợp đồng']];
const SUGGEST = [
  ['Tổng hợp báo cáo ngày', 'Tổng hợp báo cáo công trường hôm nay của các dự án'],
  ['Danh sách biểu mẫu', 'Liệt kê danh sách biểu mẫu chuẩn hiện có'],
  ['Tra cứu hồ sơ dự án', 'Cho xem hồ sơ bản vẽ đã duyệt dự án '],
  ['Quy chế bảo mật', 'Tóm tắt quy chế bảo mật và phân quyền dữ liệu'],
];

const st = { me: null, convs: [], conv: null, msgs: [], files: [], busy: false, projects: null };
const $ = s => document.querySelector(s);
const app = $('#app');

// ------------------------------------------------------------------ màn hình chặn (chưa đăng nhập / không đủ quyền)

function gate(html) { app.innerHTML = `<div class="mkc-gate"><div class="card">${html}</div></div>`; }

async function boot() {
  if (!ENABLED) return gate('<p>Chưa cấu hình địa chỉ bot (<code>CHATBOT_API</code> trong <code>js/config.js</code>).</p>');
  if (!hasSession()) {
    return gate(`<h3 style="margin-top:0">Cần đăng nhập</h3><p>Hãy đăng nhập web vật tư bằng tài khoản quản lý, rồi mở lại trang này.</p>
      <a class="btn primary" href="./">Đến trang đăng nhập</a>`);
  }
  gate('<div class="mkb-typing">Đang kết nối bot</div>');
  try {
    st.me = await api('/api/me', { onSlow: () => gate('<div class="mkb-typing">Bot đang khởi động, có thể mất tới 1 phút</div>') });
  } catch (e) {
    return gate(`<p class="late-text">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Thử lại</button>`);
  }
  if (!st.me.linked) return gate(notStaffHtml(st.me) + '<p><a class="btn" href="./">Về web vật tư</a></p>');
  if (!st.me.is_manager) {
    return gate(`<h3 style="margin-top:0">Không có quyền</h3><p>Trang này dành cho admin / giám đốc. Bạn vẫn chat được với bot qua nút 💬 trên web vật tư.</p>
      <a class="btn primary" href="./">Về web vật tư</a>`);
  }
  shell();
  await loadConvs();
  newChat();
}

// ------------------------------------------------------------------ khung trang

function shell() {
  app.onclick = null;
  app.innerHTML = `
  <div class="mkc">
    <aside class="mkc-side" aria-label="Hội thoại">
      <div class="mkc-brand"><img src="icons/logo.png" alt=""><div><b>Trợ lý quản lý</b><span>Bot MekoCons</span></div></div>
      <button class="btn primary mkc-new" data-a="new">＋ Hội thoại mới</button>
      <nav class="mkc-list" id="convs"></nav>
      <div class="mkc-side-foot">
        <span class="muted">${esc(st.me.full_name || st.me.email)} · ${esc(st.me.role)}</span>
        <a href="./">← Về web vật tư</a>
      </div>
    </aside>
    <section class="mkc-main">
      <header class="mkc-top">
        <button class="mkb-icon-btn mkc-menu" data-a="menu" aria-label="Danh sách hội thoại">${ICON_MENU}</button>
        <h2 id="title">Hội thoại mới</h2>
      </header>
      <div class="mkc-scroll" id="scroll"><div class="mkc-thread" id="thread" aria-live="polite"></div></div>
      <div class="mkc-compose-wrap">
        <div class="mkc-compose">
          <div class="mkb-chips" id="chips"></div>
          <div class="mkc-actions" id="file-actions" hidden>
            <span class="mkb-hint">Với file đính kèm:</span>
            <button class="btn sm" data-a="doc">📁 Nạp hồ sơ dự án</button>
            <button class="btn sm" data-a="form">📄 Phát hành biểu mẫu</button>
            <button class="btn sm" data-a="staff" id="btn-staff" hidden>👥 Nạp danh sách nhân sự</button>
            <span class="mkb-hint">hoặc bấm Gửi để bot đọc file.</span>
          </div>
          <div class="mkb-composer">
            <button class="mkb-icon-btn" data-a="attach" aria-label="Đính kèm file" title="Đính kèm file">${ICON_CLIP}</button>
            <textarea id="input" rows="1" placeholder="Giao việc, hỏi tổng hợp, hoặc kéo thả file vào đây…" aria-label="Tin nhắn"></textarea>
            <button class="mkb-icon-btn send" data-a="send" id="send" aria-label="Gửi">${ICON_SEND}</button>
          </div>
          <div class="mkb-hint">Enter để gửi · Shift+Enter xuống dòng</div>
          <input type="file" id="file" multiple hidden>
        </div>
      </div>
    </section>
  </div>`;
  const input = $('#input');
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 220) + 'px'; });
  $('#file').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
  app.addEventListener('click', onClick);
  setupDrop();
}

function onClick(e) {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'new') { newChat(); closeNav(); }
  else if (a === 'open') { openConv(b.dataset.id); closeNav(); }
  else if (a === 'del') delConv(b.dataset.id);
  else if (a === 'menu') $('.mkc').classList.toggle('nav-open');
  else if (a === 'attach') $('#file').click();
  else if (a === 'send') send();
  else if (a === 'unfile') { st.files.splice(+b.dataset.i, 1); renderChips(); }
  else if (a === 'suggest') { const i = $('#input'); i.value = b.dataset.text; i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  else if (a === 'doc') docModal();
  else if (a === 'form') formModal();
  else if (a === 'staff') staffImport();
}
function closeNav() { $('.mkc')?.classList.remove('nav-open'); }

function setupDrop() {
  const drop = $('#drop');
  let depth = 0;
  window.addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) { depth++; drop.hidden = false; } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) drop.hidden = true; });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); depth = 0; drop.hidden = true; if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
}

function addFiles(list) { st.files.push(...list); renderChips(); $('#input').focus(); }

function renderChips() {
  $('#chips').innerHTML = st.files.map((f, i) =>
    `<span class="mkb-chip">📎 <span>${esc(f.name)}</span><button data-a="unfile" data-i="${i}" aria-label="Bỏ file">×</button></span>`).join('');
  $('#file-actions').hidden = st.files.length !== 1;
  const isCsv = st.files.length === 1 && /\.csv$/i.test(st.files[0].name);
  $('#btn-staff').hidden = !(isCsv && st.me.role === 'admin');
}

// ------------------------------------------------------------------ hội thoại

async function loadConvs() {
  try { st.convs = (await api('/api/conversations?channel=console')).items; } catch { st.convs = []; }
  renderConvs();
}

function renderConvs() {
  const el = $('#convs');
  if (!st.convs.length) { el.innerHTML = '<p class="muted small" style="padding:8px 10px">Chưa có hội thoại nào.</p>'; return; }
  el.innerHTML = st.convs.map(c => `
    <div class="mkc-item ${c.id === st.conv ? 'active' : ''}">
      <button class="open" data-a="open" data-id="${esc(c.id)}"><span>${esc(c.title)}</span><small>${esc(new Date(c.updated_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }))}</small></button>
      <button class="del" data-a="del" data-id="${esc(c.id)}" aria-label="Xoá hội thoại" title="Xoá">🗑</button>
    </div>`).join('');
}

function msgHtml(m) {
  const cls = m.role === 'user' ? 'user' : m.error ? 'bot err' : 'bot';
  return `<div class="mkb-msg ${cls}">${m.text ? `<div class="mkb-bubble">${md(m.text)}</div>` : ''}${filesHtml(m.files)}</div>`;
}

function renderThread() {
  const t = $('#thread');
  if (!st.msgs.length) {
    t.innerHTML = `<div class="mkc-welcome"><h3>Chào ${esc(st.me.full_name || 'anh/chị')} 👋</h3>
      <p>Ra lệnh cho bot, hỏi tổng hợp, hoặc kéo thả file để nạp hồ sơ dự án / phát hành biểu mẫu mới.</p>
      <div class="mkc-suggest">${SUGGEST.map(([t1, q]) => `<button data-a="suggest" data-text="${esc(q)}"><b>${esc(t1)}</b><span>${esc(q)}</span></button>`).join('')}</div></div>`;
  } else {
    t.innerHTML = st.msgs.map(msgHtml).join('');
    st.msgs.forEach((m, i) => {
      if (m.hide_after) { autoHide(t.children[i], m.hide_after); m.hide_after = 0; m.text = '🔒 Đã ẩn mật khẩu. Hỏi lại bot nếu cần xem lại.'; }
    });
  }
  scrollEnd();
}
function scrollEnd() { const s = $('#scroll'); s.scrollTop = s.scrollHeight; }

function newChat() {
  st.conv = null; st.msgs = [];
  $('#title').textContent = 'Hội thoại mới';
  renderConvs(); renderThread();
  $('#input').focus();
}

async function openConv(id) {
  st.conv = id;
  renderConvs();
  const c = st.convs.find(x => x.id === id);
  $('#title').textContent = c ? c.title : 'Hội thoại';
  $('#thread').innerHTML = '<div class="mkb-typing">Đang tải</div>';
  try { st.msgs = (await api('/api/conversations/' + encodeURIComponent(id))).messages; }
  catch (e) { st.msgs = [{ role: 'bot', error: true, text: e.message }]; }
  renderThread();
}

async function delConv(id) {
  const c = st.convs.find(x => x.id === id);
  if (!window.confirm(`Xoá hội thoại "${c ? c.title : ''}"? Không khôi phục được.`)) return;
  try {
    await api('/api/conversations/' + encodeURIComponent(id), { method: 'DELETE' });
    st.convs = st.convs.filter(x => x.id !== id);
    if (st.conv === id) newChat(); else renderConvs();
  } catch (e) { alertMsg(e.message); }
}

function alertMsg(text) { st.msgs.push({ role: 'bot', error: true, text }); renderThread(); }

function setBusy(on) { st.busy = on; $('#send').disabled = on; $('#input').disabled = on; }

function afterReply(convId, firstText) {
  if (!st.conv) {
    st.conv = convId;
    const title = (firstText || 'Hội thoại mới').replace(/\s+/g, ' ').slice(0, 60);
    $('#title').textContent = title;
  }
  loadConvs();
}

async function send() {
  if (st.busy) return;
  const input = $('#input');
  const text = input.value.trim();
  if (!text && !st.files.length) return;
  const files = st.files.splice(0);
  renderChips();
  input.value = ''; input.style.height = 'auto';
  st.msgs.push({ role: 'user', text, files: files.map(f => ({ name: f.name })) });
  renderThread();
  $('#thread').insertAdjacentHTML('beforeend', '<div class="mkb-typing" id="wait">Bot đang xử lý</div>');
  scrollEnd();
  setBusy(true);
  const fd = new FormData();
  fd.append('text', text);
  fd.append('channel', 'console');
  if (st.conv) fd.append('conversation_id', st.conv);
  files.forEach(f => fd.append('files', f, f.name));
  try {
    const r = await api('/api/chat', { method: 'POST', body: fd, onSlow: () => { const w = $('#wait'); if (w) w.textContent = 'Bot đang khởi động hoặc xử lý file lớn, vui lòng chờ'; } });
    st.msgs.push({ role: 'bot', text: r.text, files: r.files, hide_after: r.hide_after || 0 });
    afterReply(r.conversation_id, text || files[0]?.name);
  } catch (e) {
    st.msgs.push({ role: 'bot', error: true, text: e.message });
    if (e instanceof ApiError && e.status === 401) st.msgs.push({ role: 'bot', error: true, text: 'Hãy tải lại trang hoặc đăng nhập lại web vật tư.' });
  } finally {
    setBusy(false);
    renderThread();
    input.focus();
  }
}

// ------------------------------------------------------------------ hộp thoại nạp hồ sơ / phát hành biểu mẫu

function modal(title, bodyHtml, submitLabel, onSubmit) {
  const bg = document.createElement('div');
  bg.className = 'mkc-modal-bg';
  bg.innerHTML = `<form class="mkc-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header>${esc(title)}</header><div class="body">${bodyHtml}<div class="err" id="m-err"></div></div>
    <footer><button type="button" class="btn" data-m="cancel">Huỷ</button><button class="btn primary" id="m-ok">${esc(submitLabel)}</button></footer></form>`;
  document.body.appendChild(bg);
  const form = bg.querySelector('form');
  const close = () => bg.remove();
  bg.addEventListener('click', e => { if (e.target === bg || e.target.dataset.m === 'cancel') close(); });
  bg.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const ok = form.querySelector('#m-ok');
    ok.disabled = true; ok.textContent = 'Đang tải lên…';
    try { await onSubmit(new FormData(form)); close(); }
    catch (err) { form.querySelector('#m-err').textContent = err.message; ok.disabled = false; ok.textContent = submitLabel; }
  });
  setTimeout(() => form.querySelector('input,select')?.focus(), 30);
  return form;
}

const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
const stem = name => name.replace(/\.[^.]+$/, '');

async function docModal() {
  const file = st.files[0];
  if (!file) return;
  if (!st.projects) { try { st.projects = (await api('/api/admin/projects')).items; } catch { st.projects = []; } }
  const projOpts = st.projects.map(p => `<option value="${esc(p.code)}">${esc(p.code)} — ${esc(p.name)}</option>`).join('');
  const form = modal('Nạp hồ sơ dự án', `
    <p class="small muted" style="margin:0">File: <b>${esc(file.name)}</b> → lưu Google Drive và đăng ký vào Master Data của dự án.</p>
    <label>Dự án<select name="project_code" required>${projOpts}<option value="__new">＋ Dự án mới…</option></select></label>
    <div class="row2" id="newproj" hidden>
      <label>Mã dự án mới<input name="new_code" placeholder="VD: FIT-2027" maxlength="32"></label>
      <label>Tên dự án<input name="project_name" placeholder="VD: Văn phòng ABC"></label>
    </div>
    <label>Loại hồ sơ<select name="doc_type">${opts(DOC_TYPES, guessDocType(file.name))}</select></label>
    <label>Tiêu đề<input name="title" value="${esc(stem(file.name))}" required maxlength="255"></label>
    <div class="row2">
      <label>Phiên bản<input name="version" value="v1.0" maxlength="32"></label>
      <label>Trạng thái<select name="status">${opts(DOC_STATUS, 'approved')}</select></label>
    </div>`, 'Nạp hồ sơ', async fd => {
    const isNew = fd.get('project_code') === '__new';
    const send = new FormData();
    send.append('file', file, file.name);
    send.append('project_code', isNew ? String(fd.get('new_code') || '') : fd.get('project_code'));
    send.append('project_name', isNew ? String(fd.get('project_name') || '') : '');
    ['doc_type', 'title', 'version', 'status'].forEach(k => send.append(k, fd.get(k)));
    if (st.conv) send.append('conversation_id', st.conv);
    const r = await api('/api/admin/project-documents', { method: 'POST', body: send });
    st.files = []; renderChips(); st.projects = null;
    pushAction(`📎 Nạp hồ sơ dự án: ${file.name}`, r);
  });
  const sel = form.querySelector('select[name=project_code]');
  const toggleNew = () => { form.querySelector('#newproj').hidden = sel.value !== '__new'; };
  sel.addEventListener('change', toggleNew);
  if (!st.projects.length) sel.value = '__new';
  toggleNew();
}

function guessDocType(name) {
  const n = name.toLowerCase();
  if (/boq|khoi.?luong|khối lượng/.test(n)) return 'boq';
  if (/hop.?dong|hợp đồng|contract|hđ/.test(n)) return 'contract';
  if (/spec|chi.?dan|chỉ dẫn|thong.?so/.test(n)) return 'spec';
  if (/vat.?lieu|vật liệu|material|mal/.test(n)) return 'material_list';
  return 'drawing';
}

function formModal() {
  const file = st.files[0];
  if (!file) return;
  if (!/\.(xlsx|docx)$/i.test(file.name)) { alertMsg('Biểu mẫu phải là file .xlsx hoặc .docx.'); return; }
  const code = (stem(file.name).match(/^[A-Za-z]{1,6}-[A-Za-z0-9-]{1,20}/) || [''])[0].toUpperCase();
  const niceName = stem(file.name).slice(code.length).replace(/^[\s_\-–]+/, '') || stem(file.name);
  modal('Phát hành biểu mẫu mới', `
    <p class="small muted" style="margin:0">File: <b>${esc(file.name)}</b>. Ô cần điền ghi dạng <code>{{ten_truong}}</code>, dòng bảng lặp ghi <code>{{row.ten_cot}}</code>.</p>
    <div class="row2">
      <label>Mã biểu mẫu<input name="form_code" value="${esc(code)}" placeholder="VD: QC-NT-02" required maxlength="32"></label>
      <label>Phiên bản<input name="version" value="1.0" maxlength="32"></label>
    </div>
    <label>Tên biểu mẫu<input name="name" value="${esc(niceName)}" required maxlength="200"></label>
    <label>Nhóm<select name="category">${opts(FORM_CATS, 'qc')}</select></label>`, 'Phát hành', async fd => {
    const send = new FormData();
    send.append('file', file, file.name);
    ['form_code', 'name', 'category', 'version'].forEach(k => send.append(k, fd.get(k)));
    if (st.conv) send.append('conversation_id', st.conv);
    const r = await api('/api/admin/forms', { method: 'POST', body: send });
    st.files = []; renderChips();
    pushAction(`📎 Phát hành biểu mẫu: ${file.name}`, r);
  });
}

async function staffImport() {
  const file = st.files[0];
  if (!file) return;
  if (!window.confirm(`Nạp danh sách nhân sự từ "${file.name}"?\n\n` +
    '• Cập nhật nhân sự, vai trò, dự án và email đăng nhập web.\n' +
    '• Mật khẩu (nếu có) được mã hoá; không lưu mật khẩu tài khoản quản trị.\n' +
    '• File bị xoá khỏi máy chủ ngay sau khi đọc.')) return;
  const fd = new FormData();
  fd.append('file', file, file.name);
  if (st.conv) fd.append('conversation_id', st.conv);
  st.files = []; renderChips();
  st.msgs.push({ role: 'user', text: `📎 Nạp danh sách nhân sự: ${file.name}` });
  renderThread();
  try {
    const r = await api('/api/admin/staff-import', { method: 'POST', body: fd });
    st.msgs.push({ role: 'bot', text: r.text });
    renderThread();
    afterReply(r.conversation_id, `Nạp danh sách nhân sự: ${file.name}`);
  } catch (e) { alertMsg(e.message); }
}

function pushAction(userText, r) {
  st.msgs.push({ role: 'user', text: userText });
  st.msgs.push({ role: 'bot', text: r.text });
  renderThread();
  afterReply(r.conversation_id, userText);
}

boot();
