// Song ngữ VI ⇄ EN.
// - Giao diện: mã các màn hình vẫn viết tiếng Việt; khi chọn EN, lớp này dịch chữ trên trang (text, placeholder, title)
//   theo từ điển i18n-en.js — kể cả câu có số / mã chèn vào (mẫu "{}").
// - Dữ liệu danh mục (tên vật tư, quy cách, nhóm, hạng mục): dùng cột name_en / spec_en trong CSDL.
//   Tên chưa có bản dịch được trình duyệt tự dịch bằng dịch vụ miễn phí MyMemory rồi lưu lại cho mọi người dùng chung.
// - Thẻ có thuộc tính data-notr thì giữ nguyên (vd nút chọn ngôn ngữ). Phiếu PDF, file xuất Excel/CSV giữ tiếng Việt.
import EN from './i18n-en.js';

const KEY = 'vattu.lang';
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
export let LANG = ls.get(KEY) === 'en' ? 'en' : 'vi';
const VI = /[À-ỹĐđ]/;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ---------- Từ điển ---------- */
const ui = new Map(), pats = [];
for (const [k, v] of Object.entries(EN)) {
  const key = k.replace(/\s+/g, ' ').trim();
  if (!key.includes('{}')) { ui.set(key, v); continue; }
  const parts = key.split('{}');
  // mẫu có phần cố định ngắn (vd "{} ảnh") chỉ nhận phần thay đổi không chứa chữ tiếng Việt, tránh dịch nhầm cả câu
  pats.push({ re: new RegExp('^' + parts.map(esc).join('(.*?)') + '$', 's'), frag: parts.reduce((a, b) => (b.length > a.length ? b : a), ''), v,
              strict: parts.join('').replace(/[^\p{L}]/gu, '').length < 8 });
}
pats.sort((a, b) => b.frag.length - a.frag.length);
let data = new Map(); // tên tiếng Việt trong danh mục → tên tiếng Anh
let cache = new Map();
const fill = (v, caps, d) => { let i = 0; return v.replace(/\{(\d*)\}/g, (_, n) => { const c = caps[n ? Number(n) - 1 : i++]; return c == null ? '' : tr(c, d + 1); }); };

function lookup(s, d) {
  const hit = ui.get(s) ?? data.get(s);
  if (hit != null) return hit;
  if (d > 3) return null;
  for (const p of pats) {
    if (p.frag && !s.includes(p.frag)) continue;
    const m = p.re.exec(s); if (!m) continue;
    const caps = m.slice(1); if (p.strict && caps.some(c => VI.test(c) && ui.get(c.trim()) == null && data.get(c.trim()) == null)) continue;
    return fill(p.v, caps, d);
  }
  return null;
}
// Dịch một chuỗi hiển thị. Không có trong từ điển → giữ nguyên.
export function tr(s, d = 0) {
  if (LANG !== 'en' || s == null) return s;
  s = String(s);
  if (!VI.test(s)) return s;
  if (!d && cache.has(s)) return cache.get(s);
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s); const core = m[2].replace(/\s+/g, ' ');
  let out = lookup(core, d);
  if (out == null) {
    // bỏ ký hiệu / emoji ở đầu, dấu câu ở cuối rồi thử lại
    const x = /^([^\p{L}\p{N}"“(]*)([\s\S]*?)([\s:：…?.!*,;]*)$/u.exec(core);
    if (x && x[1] && x[2]) { const t = lookup(x[2] + x[3], d); if (t != null) out = x[1] + t; }
    if (out == null && x && (x[1] || x[3]) && x[2]) { const t = lookup(x[2], d); if (t != null) out = x[1] + t + x[3]; }
  }
  if (out == null) {
    // "12 cuộn", "2 cái": số + đơn vị / tên
    const x = /^([\d.,]+\s*)(\p{L}[\s\S]*)$/u.exec(core);
    if (x) { const t = lookup(x[2], d); if (t != null) out = x[1] + t; }
  }
  if (out == null && d < 3) {
    for (const sep of [' · ', ' › ', ' — ', ' – ', ': ', ' / ']) {
      if (!core.includes(sep)) continue;
      const parts = core.split(sep).map(p => tr(p, d + 1));
      const joined = parts.join(sep); if (joined !== core) { out = joined; break; }
    }
  }
  out = out == null ? s : m[1] + out + m[3];
  if (!d) { if (cache.size > 20000) cache = new Map(); cache.set(s, out); }
  return out;
}

/* ---------- Dịch trên trang ---------- */
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);
const skipEl = el => !el || SKIP.has(el.tagName) || (el.closest && el.closest('[data-notr]'));
function trText(n) {
  const v = n.data; if (n.__en === v || !VI.test(v)) return;
  const t = tr(v); if (t !== v) { n.__vi = v; n.__en = t; n.data = t; }
}
function trAttrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a); if (!v) continue;
    const rec = el.__a && el.__a[a]; if (rec && rec[1] === v) continue;
    const t = tr(v); if (t !== v) { (el.__a || (el.__a = {}))[a] = [v, t]; el.setAttribute(a, t); }
  }
}
function walk(root, fn = 'tr') {
  const doText = fn === 'tr' ? trText : n => { if (n.__en != null && n.__en === n.data) n.data = n.__vi; n.__en = undefined; };
  const doEl = fn === 'tr' ? trAttrs : el => { if (el.__a) { for (const [a, [vi, en]] of Object.entries(el.__a)) if (el.getAttribute(a) === en) el.setAttribute(a, vi); el.__a = undefined; } };
  if (root.nodeType === 3) { if (!skipEl(root.parentElement)) doText(root); return; }
  if (root.nodeType !== 1 || skipEl(root)) return;
  doEl(root);
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeType === 1 && (SKIP.has(n.tagName) || n.hasAttribute('data-notr')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  for (let n = tw.nextNode(); n; n = tw.nextNode()) n.nodeType === 3 ? doText(n) : doEl(n);
}
const TITLE_VI = document.title;
function applyAll() {
  document.documentElement.lang = LANG;
  document.title = LANG === 'en' ? tr(TITLE_VI) : TITLE_VI;
  walk(document.body, LANG === 'en' ? 'tr' : 'restore');
  document.querySelectorAll('[data-lang-btn]').forEach(b => { b.textContent = LANG === 'en' ? '🌐 VI' : '🌐 EN'; b.title = LANG === 'en' ? 'Chuyển sang tiếng Việt' : 'Switch to English'; });
}
new MutationObserver(list => {
  if (LANG !== 'en') return;
  for (const m of list) {
    if (m.type === 'childList') m.addedNodes.forEach(n => walk(n));
    else if (m.type === 'characterData') { if (!skipEl(m.target.parentElement)) trText(m.target); }
    else if (m.type === 'attributes' && !skipEl(m.target)) trAttrs(m.target);
  }
}).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });

export function setLang(l, rerender) {
  LANG = l === 'en' ? 'en' : 'vi'; ls.set(KEY, LANG); cache = new Map();
  if (LANG === 'vi') applyAll();
  if (rerender) rerender();
  applyAll();
}
export const langBtn = (cls = 'btn sm ghost') => `<button class="${cls} lang-btn" data-act="lang" data-lang-btn data-notr title="${LANG === 'en' ? 'Chuyển sang tiếng Việt' : 'Switch to English'}">${LANG === 'en' ? '🌐 VI' : '🌐 EN'}</button>`;
// Chạy sau khi trang đã vẽ lần đầu
export const initLang = () => applyAll();

/* ---------- Tên tiếng Anh của danh mục ---------- */
export function setCatalog(S) {
  const m = new Map();
  const add = (vi, en) => { if (vi && en && VI.test(vi)) m.set(String(vi).replace(/\s+/g, ' ').trim(), en); };
  for (const x of S.materials || []) { add(x.name, x.name_en); add(x.spec, x.spec_en); }
  for (const x of [...(S.groups || []), ...(S.subgroups || []), ...(S.workCats || [])]) add(x.name, x.name_en);
  const same = m.size === data.size && [...m].every(([k, v]) => data.get(k) === v);
  if (same) return false;
  data = m; cache = new Map();
  if (LANG === 'en') { walk(document.body, 'restore'); walk(document.body); }
  return true;
}

// Tự dịch tên chưa có bản dịch (tối đa ~25 tên mỗi lần cập nhật dữ liệu, chạy nền)
const QKEY = 'vattu.mt.quota';
let running = false;
async function mymemory(text) {
  const r = await fetch('https://api.mymemory.translated.net/get?langpair=vi|en&q=' + encodeURIComponent(text.slice(0, 450)));
  if (r.status === 429 || r.status === 403) throw Object.assign(new Error('quota'), { quota: true });
  const j = await r.json();
  const t = j && j.responseData && String(j.responseData.translatedText || '').trim();
  if (!t || /MYMEMORY WARNING|QUOTA|INVALID/i.test(t) || Number(j.responseStatus) === 429) throw Object.assign(new Error('quota'), { quota: true });
  if (Number(j.responseStatus) !== 200) return null;
  let out = t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  if (!/[.!?]$/.test(text.trim())) out = out.replace(/[.。]+$/, ''); // bỏ dấu chấm dịch vụ tự thêm
  return out;
}
const known = s => ui.get(String(s).replace(/\s+/g, ' ').trim());
export async function autoTranslate(S, save) {
  if (running || !navigator.onLine || !S.user) return 0;
  const today = new Date().toISOString().slice(0, 10); if (ls.get(QKEY) === today) return 0;
  const todo = [];
  const need = s => s && VI.test(s);
  for (const x of S.materials || []) {
    const it = { t: 'materials', id: x.id, src: x, f: [] };
    if (need(x.name) && !x.name_en) it.f.push(['name_en', x.name]);
    if (need(x.spec) && !x.spec_en) it.f.push(['spec_en', x.spec]);
    if (it.f.length) todo.push(it);
  }
  for (const [t, arr, idf] of [['material_groups', S.groups, 'code'], ['material_subgroups', S.subgroups, 'id'], ['work_categories', S.workCats, 'code']])
    for (const x of arr || []) if (need(x.name) && !x.name_en) todo.push({ t, id: x[idf], src: x, f: [['name_en', x.name]] });
  if (!todo.length) return 0;
  running = true;
  const out = [];
  try {
    const batch = todo.slice(0, 25); let i = 0;
    const worker = async () => {
      while (i < batch.length) {
        const it = batch[i++]; const row = { t: it.t, id: it.id };
        for (const [f, vi] of it.f) { const en = known(vi) || await mymemory(vi); if (en) row[f] = en; }
        if (Object.keys(row).length > 2) out.push({ row, it });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  } catch (e) { if (e.quota) ls.set(QKEY, today); }
  finally { running = false; }
  if (!out.length) return 0;
  await save(out.map(o => o.row));
  for (const { row, it } of out) for (const f of ['name_en', 'spec_en']) if (row[f] && !it.src[f]) it.src[f] = row[f];
  setCatalog(S);
  return out.length;
}
