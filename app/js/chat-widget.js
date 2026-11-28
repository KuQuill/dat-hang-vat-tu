// Widget chat góc phải dưới: chỉ hiện khi đã đăng nhập web vật tư.
import { API_BASE, ApiError, ENABLED, api, esc, filesHtml, hasSession, linkCardHtml, md } from './chatbot-core.js';

const ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_CLIP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l8-8"/></svg>';
const ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';

const st = { open: false, me: null, conv: null, files: [], busy: false, link: null, loaded: false };
let root, panel, body, input, chips, sendBtn, fab;

function convKey() { return 'mkcbot.widgetconv.' + (st.me ? st.me.email : ''); }

function mount() {
  if (!document.querySelector('link[data-mkb]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'chatbot.css'; l.dataset.mkb = '1';
    document.head.appendChild(l);
  }
  root = document.createElement('div');
  root.className = 'mkb-root';
  root.innerHTML = `
    <section class="mkb-panel" hidden role="dialog" aria-label="Trợ lý MekoCons">
      <div class="mkb-head">
        <img src="icons/logo.png" alt="">
        <div class="t"><b>Trợ lý MekoCons</b><span id="mkb-sub">Hỏi về dự án, biểu mẫu, vật tư, QC, QS…</span></div>
        <a class="btn sm ghost" id="mkb-console" href="chat.html" hidden title="Trang chat quản lý">Mở rộng ↗</a>
        <button class="mkb-icon-btn" data-mkb="close" aria-label="Đóng">${ICON_CLOSE}</button>
      </div>
      <div class="mkb-body" aria-live="polite"></div>
      <div class="mkb-foot">
        <div class="mkb-chips"></div>
        <div class="mkb-composer">
          <button class="mkb-icon-btn" data-mkb="attach" aria-label="Đính kèm file" title="Đính kèm file">${ICON_CLIP}</button>
          <textarea rows="1" placeholder="Nhắn cho bot…" aria-label="Tin nhắn"></textarea>
          <button class="mkb-icon-btn send" data-mkb="send" aria-label="Gửi">${ICON_SEND}</button>
        </div>
        <input type="file" multiple hidden>
      </div>
    </section>
    <button class="mkb-fab" data-mkb="toggle" aria-label="Mở trợ lý MekoCons" title="Trợ lý MekoCons">${ICON_CHAT}</button>`;
  document.body.appendChild(root);
  panel = root.querySelector('.mkb-panel');
  body = root.querySelector('.mkb-body');
  input = root.querySelector('textarea');
  chips = root.querySelector('.mkb-chips');
  sendBtn = root.querySelector('[data-mkb="send"]');
  fab = root.querySelector('.mkb-fab');
  const fileInput = root.querySelector('input[type=file]');

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-mkb]');
    if (!b) return;
    const act = b.dataset.mkb;
    if (act === 'toggle') toggle();
    else if (act === 'close') toggle(false);
    else if (act === 'attach') fileInput.click();
    else if (act === 'send') send();
    else if (act === 'unfile') { st.files.splice(+b.dataset.i, 1); renderChips(); }
    else if (act === 'link-start') linkStart();
    else if (act === 'link-check') { st.me = null; load(true); }
  });
  fileInput.addEventListener('change', () => { st.files.push(...fileInput.files); fileInput.value = ''; renderChips(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  input.addEventListener('input', autoGrow);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.open) toggle(false); });
}

function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; }

function toggle(force) {
  st.open = force ?? !st.open;
  panel.hidden = !st.open;
  fab.setAttribute('aria-expanded', String(st.open));
  if (st.open) { load(); setTimeout(() => input.focus(), 50); }
}

function renderChips() {
  chips.innerHTML = st.files.map((f, i) =>
    `<span class="mkb-chip">📎 <span>${esc(f.name)}</span><button data-mkb="unfile" data-i="${i}" aria-label="Bỏ file">×</button></span>`).join('');
}

function msgHtml(m) {
  const cls = m.role === 'user' ? 'user' : m.error ? 'bot err' : 'bot';
  const text = m.text ? `<div class="mkb-bubble">${md(m.text)}</div>` : '';
  return `<div class="mkb-msg ${cls}">${text}${filesHtml(m.files)}</div>`;
}

function scrollEnd() { body.scrollTop = body.scrollHeight; }

function setBusy(on) { st.busy = on; sendBtn.disabled = on; input.disabled = on || !(st.me && st.me.linked); }

function emptyHtml() {
  const name = st.me && st.me.full_name ? `, <b>${esc(st.me.full_name)}</b>` : '';
  return `<div class="mkb-empty">Xin chào${name}! 👋<br>Hỏi bot về hồ sơ dự án, biểu mẫu, đặt vật tư, QC, QS hoặc gửi file để bot xử lý.</div>`;
}

async function load(force = false) {
  if (st.loaded && !force) return;
  body.innerHTML = '<div class="mkb-typing">Đang kết nối bot</div>';
  setBusy(true);
  try {
    st.me = await api('/api/me', { onSlow: () => { body.innerHTML = '<div class="mkb-typing">Bot đang khởi động, có thể mất tới 1 phút</div>'; } });
    root.querySelector('#mkb-console').hidden = !st.me.is_manager;
    if (!st.me.linked) { body.innerHTML = linkCardHtml(st.link); setBusy(false); input.disabled = true; return; }
    st.conv = localStorage.getItem(convKey());
    let msgs = [];
    if (st.conv) {
      try { msgs = (await api('/api/conversations/' + encodeURIComponent(st.conv))).messages; }
      catch (e) { if (e instanceof ApiError && e.status === 404) { st.conv = null; localStorage.removeItem(convKey()); } else throw e; }
    }
    body.innerHTML = msgs.length ? msgs.map(msgHtml).join('') : emptyHtml();
    st.loaded = true;
    scrollEnd();
  } catch (e) {
    body.innerHTML = msgHtml({ role: 'bot', error: true, text: e.message });
  } finally {
    setBusy(false);
  }
}

async function linkStart() {
  try {
    st.link = await api('/api/link/start', { method: 'POST' });
    body.innerHTML = linkCardHtml(st.link);
  } catch (e) {
    body.insertAdjacentHTML('beforeend', msgHtml({ role: 'bot', error: true, text: e.message }));
  }
}

async function send() {
  if (st.busy || !st.me || !st.me.linked) return;
  const text = input.value.trim();
  if (!text && !st.files.length) return;
  const files = st.files.splice(0);
  renderChips();
  input.value = ''; autoGrow();
  if (body.querySelector('.mkb-empty')) body.innerHTML = '';
  body.insertAdjacentHTML('beforeend', msgHtml({ role: 'user', text, files: files.map(f => ({ name: f.name })) }));
  body.insertAdjacentHTML('beforeend', '<div class="mkb-typing" id="mkb-wait">Bot đang xử lý</div>');
  scrollEnd();
  setBusy(true);
  const fd = new FormData();
  fd.append('text', text);
  fd.append('channel', 'widget');
  if (st.conv) fd.append('conversation_id', st.conv);
  files.forEach(f => fd.append('files', f, f.name));
  try {
    const r = await api('/api/chat', {
      method: 'POST', body: fd,
      onSlow: () => { const w = body.querySelector('#mkb-wait'); if (w) w.textContent = 'Bot đang khởi động hoặc xử lý file lớn, vui lòng chờ'; },
    });
    st.conv = r.conversation_id;
    localStorage.setItem(convKey(), st.conv);
    body.querySelector('#mkb-wait')?.remove();
    body.insertAdjacentHTML('beforeend', msgHtml({ role: 'bot', text: r.text, files: r.files }));
  } catch (e) {
    body.querySelector('#mkb-wait')?.remove();
    body.insertAdjacentHTML('beforeend', msgHtml({ role: 'bot', error: true, text: e.message }));
    if (e instanceof ApiError && e.code === 'not_linked') { st.me.linked = false; body.insertAdjacentHTML('beforeend', linkCardHtml(null)); }
  } finally {
    setBusy(false);
    scrollEnd();
    input.focus();
  }
}

function sync() {
  const show = hasSession();
  if (show && !root) mount();
  if (root) {
    root.hidden = !show;
    if (!show) { toggle(false); st.me = null; st.loaded = false; st.conv = null; }
  }
}

if (ENABLED && API_BASE) {
  sync();
  setInterval(sync, 3000); // đăng nhập / đăng xuất trong cùng tab không phát sự kiện storage
  window.addEventListener('storage', sync);
}
