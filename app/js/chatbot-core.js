// Lõi dùng chung cho chatbot (widget góc trang + trang chat quản lý chat.html).
// Lấy phiên đăng nhập Supabase sẵn có của web vật tư → gọi API bot MekoCons trên Render.
import { CONFIG } from './config.js';

const NS = 'mkcvt2.' + String(CONFIG.SUPABASE_URL || '').replace(/\W+/g, '') + '.';
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const qs = new URLSearchParams(location.search);

// Xem thử trên máy (chỉ localhost): ?chatapi=http://127.0.0.1:8080&chatdev=<WEB_DEV_TOKEN>
const DEV_TOKEN = IS_LOCAL ? (qs.get('chatdev') || sessionStorage.getItem('mkcbot.dev') || '') : '';
if (DEV_TOKEN) sessionStorage.setItem('mkcbot.dev', DEV_TOKEN);
const API_OVERRIDE = IS_LOCAL ? (qs.get('chatapi') || sessionStorage.getItem('mkcbot.api') || '') : '';
if (API_OVERRIDE) sessionStorage.setItem('mkcbot.api', API_OVERRIDE);

export const API_BASE = (API_OVERRIDE || CONFIG.CHATBOT_API || '').replace(/\/$/, '');
export const ENABLED = !!API_BASE && (!!DEV_TOKEN || (!!CONFIG.SUPABASE_URL && !!CONFIG.SUPABASE_ANON_KEY));

let sb = null;
function client() {
  if (sb || !window.supabase || !CONFIG.SUPABASE_URL) return sb;
  // Dùng chung bộ lưu phiên với ứng dụng chính; KHÔNG tự làm mới token (ứng dụng chính đã làm).
  sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: NS + 'auth' },
  });
  return sb;
}

/** Có phiên đăng nhập hay không (kiểm tra nhanh, không gọi mạng). */
export function hasSession() {
  if (DEV_TOKEN) return true;
  try { return !!localStorage.getItem(NS + 'auth'); } catch { return false; }
}

export async function getToken() {
  if (DEV_TOKEN) return DEV_TOKEN;
  const c = client();
  if (!c) return '';
  const { data } = await c.auth.getSession();
  return data.session ? data.session.access_token : '';
}

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/** Gọi API bot. `body`: FormData | undefined. Tự gắn token đăng nhập. */
export async function api(path, { method = 'GET', body, onSlow } = {}) {
  const token = await getToken();
  if (!token) throw new ApiError(401, 'no_session', 'Bạn cần đăng nhập web vật tư trước.');
  const slow = onSlow ? setTimeout(onSlow, 6000) : null;
  let res;
  try {
    res = await fetch(API_BASE + path, { method, body, headers: { Authorization: 'Bearer ' + token } });
  } catch {
    throw new ApiError(0, 'network', 'Không kết nối được bot (kiểm tra mạng rồi thử lại).');
  } finally {
    if (slow) clearTimeout(slow);
  }
  let data = null;
  try { data = await res.json(); } catch { /* không phải JSON */ }
  if (!res.ok) {
    const d = (data && data.detail) || {};
    const msg = typeof d === 'object' ? d.message : String(d);
    throw new ApiError(res.status, (typeof d === 'object' && d.error) || 'error',
      msg || (res.status >= 500 ? 'Bot đang gặp sự cố, thử lại sau ít phút.' : 'Yêu cầu không hợp lệ.'));
  }
  return data;
}

export const fileUrl = u => (!u ? '' : /^https?:/.test(u) ? u : API_BASE + u);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Markdown rút gọn an toàn: **đậm**, `mã`, link http(s), xuống dòng. Luôn escape trước. */
export function md(text) {
  let h = esc(text);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  return h.replace(/\n/g, '<br>');
}

export function filesHtml(files) {
  if (!files || !files.length) return '';
  return '<div class="mkb-files">' + files.map(f => {
    const main = f.url
      ? `<a class="mkb-file" href="${esc(fileUrl(f.url))}" target="_blank" rel="noopener">📄 ${esc(f.name)}</a>`
      : `<span class="mkb-file off" title="File không còn trên máy chủ">📄 ${esc(f.name)}</span>`;
    const drive = f.drive_link ? ` <a class="mkb-drive" href="${esc(f.drive_link)}" target="_blank" rel="noopener">Drive ↗</a>` : '';
    return `<div>${main}${drive}</div>`;
  }).join('') + '</div>';
}

/** Email đăng nhập chưa có trong danh sách nhân sự của bot. */
export function notStaffHtml(me) {
  return `<div class="mkb-link">
    <p><strong>Chưa có trong danh sách nhân sự của bot</strong></p>
    <p>Email <code>${esc(me && me.email)}</code> chưa được khai báo. Liên hệ admin để được thêm vào danh sách nhân sự.</p></div>`;
}

/** Tin nhắn chứa mật khẩu: tự thay nội dung sau `seconds` giây. */
export function autoHide(el, seconds) {
  if (!el || !seconds) return;
  const bubble = el.querySelector('.mkb-bubble');
  if (bubble) bubble.insertAdjacentHTML('beforeend', `<div class="mkb-hint" data-countdown>Tự ẩn sau ${seconds} giây</div>`);
  let left = seconds;
  const t = setInterval(() => {
    left -= 1;
    const c = el.querySelector('[data-countdown]');
    if (c) c.textContent = `Tự ẩn sau ${left} giây`;
    if (left <= 0) {
      clearInterval(t);
      if (bubble) bubble.innerHTML = '🔒 Đã ẩn mật khẩu. Hỏi lại bot nếu cần xem lại.';
    }
  }, 1000);
}
