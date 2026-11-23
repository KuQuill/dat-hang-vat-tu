// Lõi dùng chung: trạng thái, tiện ích, hộp thoại, so khớp vật tư, số liệu suy ra
import { CONFIG } from './config.js';
export { CONFIG };

export const DEMO = !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY;
export const NS = 'mkcvt2.' + (DEMO ? 'demo' : CONFIG.SUPABASE_URL.replace(/\W+/g, '')) + '.';
export const KEY = {
  cache: NS + 'cache', draft: NS + 'draft', outbox: NS + 'outbox', tab: NS + 'tab', demodb: NS + 'db', demouser: NS + 'user',
  draftImgs: NS + 'draftimgs', obImgs: id => NS + 'obimg.' + id,
};
export const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
export const IDB = (() => {
  let p = null;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('mkc-vattu', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', mode); const req = fn(t.objectStore('kv'));
      t.oncomplete = () => res(req.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  };
  return {
    get: k => run('readonly', s => s.get(k)).catch(() => undefined),
    set: (k, v) => run('readwrite', s => s.put(v, k)).catch(() => false),
    del: k => run('readwrite', s => s.delete(k)).catch(() => false),
  };
})();

/* ---------- Tiện ích ---------- */
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
export const todayISO = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
export const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const vnDate = ts => ts ? new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }) : '';
export const fmtD = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
export const fmtDT = ts => ts ? new Date(ts).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
export const fmtN = n => (n == null || n === '') ? '' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
export const numInput = n => (n == null || n === '') ? '' : String(Number(n));
export const parseNum = v => { const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.'); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
export const round6 = x => Math.round(x * 1e6) / 1e6;
export const isNet = e => !!(e && (e.network || !navigator.onLine || /failed to fetch|networkerror|load failed|network request failed/i.test(e.message || '')));
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const genPassword = () => { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; let s = ''; for (const x of crypto.getRandomValues(new Uint32Array(10))) s += c[x % c.length]; return s; };

/* ---------- Hằng số ---------- */
export const ROLE = { site: 'Công trường', procurement: 'Phòng vật tư', purchasing: 'Thu mua', admin: 'Quản trị' };
export const PR_ST = {
  cho_duyet: ['Chờ duyệt', 'b-amber'], da_duyet: ['Đã duyệt', 'b-blue'], tu_choi: ['Từ chối', 'b-red'],
  da_dat: ['Đã đặt hàng', 'b-violet'], dang_giao: ['Đang giao', 'b-teal'], co_van_de: ['Có vấn đề nhận hàng', 'b-red'],
  da_ve: ['Đã nhận đủ', 'b-green'], huy: ['Đã huỷ', 'b-gray'], thu_hoi: ['Đã thu hồi – đang sửa', 'b-gray'],
};
export const IT_ST = {
  cho_xu_ly: ['Chờ xử lý', 'b-gray'], da_dat: ['Đã đặt', 'b-violet'], dang_giao: ['Đang giao', 'b-teal'],
  co_van_de: ['Có vấn đề', 'b-red'], da_ve: ['Đã nhận', 'b-green'], huy: ['Huỷ', 'b-gray'],
};
export const OPEN_ST = ['cho_xu_ly', 'da_dat', 'dang_giao'];
export const ACTIVE_PR = ['cho_duyet', 'da_duyet', 'da_dat', 'dang_giao', 'co_van_de'];
export const APPROVED_PR = ['da_duyet', 'da_dat', 'dang_giao', 'co_van_de'];
export const COND = { moi: ['Mới', 'b-green'], da_qua_su_dung: ['Đã qua sử dụng', 'b-blue'], hong: ['Hỏng', 'b-red'], dang_sua: ['Đang sửa', 'b-amber'] };
export const USABLE = ['moi', 'da_qua_su_dung'];
export const ISSUES = { thieu: 'Thiếu số lượng', thua: 'Thừa số lượng', sai_hang: 'Sai chủng loại / quy cách', kem_chat_luong: 'Không đạt chất lượng', khac: 'Khác' };
export const RESOLUTION = { chap_nhan: 'Chấp nhận', giao_bu: 'Giao bù phần thiếu', giao_lai: 'Trả lại, giao lại' };
export const PP_ST = { da_gui: ['Đã gửi Thu mua', 'b-amber'], thu_mua_nhan: ['Thu mua đã nhận', 'b-blue'], dang_mua: ['Đang mua', 'b-violet'], da_mua: ['Đã mua', 'b-green'], huy: ['Đã huỷ', 'b-gray'] };
export const KIND = { so_luong: 'Theo số lượng', tung_cai: 'Từng chiếc (tài sản)' };
export const badge = (map, k, extra = '') => { const [l, c] = map[k] || [k, 'b-gray']; return `<span class="badge ${c}">${esc(l)}${extra}</span>`; };
export const MAX_IMG_PER_PR = 10;

/* ---------- Trạng thái ---------- */
export const S = {
  user: null, profile: null,
  sites: [], groups: [], subgroups: [], workCats: [], materials: [], profiles: [], stock: [], assets: [],
  prs: [], items: [], deliveries: [], atts: [], proposals: [], lines: [], links: [],
  sync: { pr: null, item: null, att: null }, lastSync: null, syncing: false, ver: 0,
  outbox: LS.get(KEY.outbox, []),
  draft: null, draftImages: [],
  tab: LS.get(KEY.tab, 'info'), khoTab: 'stock',
  filters: { q: '', site: '', status: '', from: '', to: '', mine: false, late: false, kpi: '' },
  sfilters: { q: '', group: '', loc: '', cond: '', has: true, low: false },
  afilters: { q: '', group: '', loc: '', cond: '' },
  pfilters: { status: '' },
  ufilter: '',
  expanded: new Set(), pexpanded: new Set(),
  batchEdits: new Map(), buySel: new Set(),
  urlCache: new Map(),
};
export const ctx = { B: null };
export const ACT = {};      // các thao tác: data-act="..."
export const VIEWS = {};    // tab → { title, show(), html(), after() }
export const INPUTS = [];   // bộ xử lý sự kiện input/change: (e) => true nếu đã xử lý
export const hooks = { render: () => {}, renderChrome: () => {}, pull: async () => {}, refresh: () => {} };

/* ---------- Tra cứu ---------- */
export const siteById = id => S.sites.find(s => s.id === id);
export const siteByCode = c => S.sites.find(s => s.code.toUpperCase() === String(c || '').toUpperCase());
export const locLabel = siteId => { if (!siteId) return 'Kho tổng'; const s = siteById(siteId); return s ? `${s.code} — ${s.name}` : '?'; };
export const profName = id => { const p = S.profiles.find(x => x.id === id); return p ? (p.full_name || p.email) : ''; };
export const isStaff = () => !!(S.profile && ['procurement', 'admin'].includes(S.profile.role));
export const isAdmin = () => !!(S.profile && S.profile.role === 'admin');
export const isPurch = () => !!(S.profile && ['purchasing', 'procurement', 'admin'].includes(S.profile.role));

/* ---------- Số liệu suy ra (tính lại khi dữ liệu đổi) ---------- */
let _d = null, _dv = -1;
export function D() {
  if (_d && _dv === S.ver) return _d;
  const d = {
    mat: new Map(S.materials.map(m => [m.id, m])), grp: new Map(S.groups.map(g => [g.code, g])),
    sub: new Map(S.subgroups.map(g => [g.id, g])),
    delByItem: new Map(), openKhoByStock: new Map(), busyAsset: new Map(), link: new Map(S.links.map(l => [l.delivery_id, l.line_id])),
    line: new Map(S.lines.map(l => [l.id, l])), prop: new Map(S.proposals.map(p => [p.id, p])),
    item: new Map(S.items.map(i => [i.id, i])), pr: new Map(S.prs.map(p => [p.id, p])),
    stockById: new Map(S.stock.map(s => [s.id, s])), assetById: new Map(S.assets.map(a => [a.id, a])),
    khoFree: new Map(),
  };
  for (const x of S.deliveries) {
    if (!d.delByItem.has(x.item_id)) d.delByItem.set(x.item_id, []);
    d.delByItem.get(x.item_id).push(x);
    if (OPEN_ST.includes(x.status) && x.source === 'kho') {
      if (x.stock_id) d.openKhoByStock.set(x.stock_id, (d.openKhoByStock.get(x.stock_id) || 0) + Number(x.qty));
      if (x.asset_id) d.busyAsset.set(x.asset_id, x.id);
    }
  }
  for (const arr of d.delByItem.values()) arr.sort((a, b) => a.batch_no - b.batch_no);
  for (const s of S.stock) if (!s.site_id && USABLE.includes(s.condition))
    d.khoFree.set(s.material_id, (d.khoFree.get(s.material_id) || 0) + Math.max(0, Number(s.qty) - (d.openKhoByStock.get(s.id) || 0)));
  for (const a of S.assets) if (!a.site_id && a.active !== false && USABLE.includes(a.condition) && !d.busyAsset.has(a.id))
    d.khoFree.set(a.material_id, (d.khoFree.get(a.material_id) || 0) + 1);
  _d = d; _dv = S.ver; return d;
}
export const groupOf = mid => { const m = D().mat.get(mid); return m ? D().grp.get(m.group_code) : null; };
export const kindOf = mid => (groupOf(mid) || {}).kind || 'so_luong';
export const khoFree = mid => round6(D().khoFree.get(mid) || 0);
export const stockFree = (stockId, excl) => {
  const s = D().stockById.get(stockId); if (!s) return 0;
  let used = 0; for (const x of S.deliveries) if (x.stock_id === stockId && x.source === 'kho' && OPEN_ST.includes(x.status) && x.id !== excl) used += Number(x.qty);
  return round6(Number(s.qty) - used);
};
export const assetBusy = (assetId, excl) => S.deliveries.some(x => x.asset_id === assetId && OPEN_ST.includes(x.status) && x.id !== excl);
export const groupName = c => (D().grp.get(c) || {}).name || c;

/* ---------- Ảnh ---------- */
export async function compressImage(file, maxDim = 1600, quality = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Không đọc được ảnh ' + (file.name || ''))); i.src = url; });
    const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
  } finally { URL.revokeObjectURL(url); }
}
export const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
export function pickFiles(multiple = true, capture = false) {
  return new Promise(res => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = multiple;
    if (capture) inp.setAttribute('capture', 'environment');
    inp.onchange = () => res([...inp.files]); inp.click();
  });
}
export async function filesToImages(files, extra = {}) {
  const out = [];
  for (const f of files) {
    if (!/^image\//.test(f.type)) { toast(`${f.name}: không phải file ảnh`, 'err'); continue; }
    if (f.size > 25 * 1024 * 1024) { toast(`${f.name}: ảnh quá lớn (>25MB)`, 'err'); continue; }
    try { out.push({ id: uid(), name: f.name || 'anh.jpg', blob: await compressImage(f), ...extra }); }
    catch (e) { toast(e.message, 'err'); }
  }
  return out;
}
export async function uploadImages(imgs, mapFn) {
  const files = [];
  for (const im of imgs) files.push({ path: await ctx.B.uploadImage(im.blob), name: im.name, ...(mapFn ? mapFn(im) : {}) });
  return files;
}
export async function loadVisibleImages() {
  const now = Date.now();
  const need = [...new Set($$('img[data-path]').map(i => i.dataset.path))].filter(p => { const c = S.urlCache.get(p); return !c || c.exp < now; });
  if (need.length) {
    try {
      const map = await ctx.B.imageUrls(need);
      for (const [p, url] of Object.entries(map)) S.urlCache.set(p, { url, exp: now + 50 * 60e3 });
    } catch (e) { if (!isNet(e)) console.warn('Không tải được ảnh', e); }
  }
  $$('img[data-path]').forEach(img => { const c = S.urlCache.get(img.dataset.path); if (c && img.getAttribute('src') !== c.url) img.src = c.url; });
}
export const imgTag = (path, alt = '', cls = '') => path
  ? `<img class="${cls}" data-path="${esc(path)}" data-act="view-img" alt="${esc(alt)}" ${S.urlCache.get(path) ? `src="${esc(S.urlCache.get(path).url)}"` : ''}>`
  : `<div class="${cls} noimg">—</div>`;

/* ---------- So khớp vật tư (giống logic phía Supabase) ---------- */
function trigrams(n) {
  const set = new Set();
  for (const w of n.split(/[^a-z0-9]+/).filter(Boolean)) { const p = '  ' + w + ' '; for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3)); }
  return set;
}
function prepMat(m) { const n = norm(m.name + ' ' + (m.spec || '')); m._n = n; m._tg = trigrams(n); m._tok = n.split(/[^a-z0-9.,]+/).filter(Boolean); m._code = m.code.toLowerCase(); }
export function prepQuery(q) {
  const n = norm(q); const nums = n.match(/\d+(?:[.,]\d+)?/g) || [];
  return { raw: String(q).trim().toLowerCase(), n, tg: trigrams(n), tok: n.split(/[^a-z0-9.,]+/).filter(Boolean),
           numRe: nums.map(x => new RegExp('(^|[^0-9])' + x.replace(/[.,]/g, '[.,]') + '([^0-9]|$)')) };
}
export function scoreMat(Q, m) {
  if (!m._n) prepMat(m);
  if (!Q.n) return 0;
  if (m._code === Q.raw) return 1;
  if (Q.raw.length >= 3 && m._code.startsWith(Q.raw)) return 0.9;
  if (!Q.numRe.every(re => re.test(m._n))) return 0;
  let inter = 0; for (const t of Q.tg) if (m._tg.has(t)) inter++;
  const sim = Q.tg.size && m._tg.size ? inter / (Q.tg.size + m._tg.size - inter) : 0;
  let c = 0; for (const x of Q.tok) if (m._tok.some(y => (x.length >= 2 ? y.startsWith(x) : y === x))) c++;
  const cont = Q.tok.length ? (c / Q.tok.length) * (Q.tok.length >= 2 ? 0.9 : 0.7) : 0;
  return Math.max(sim, cont);
}
export const MATCH = 0.6;
export function matchMaterials(q, n = 8, min = 0.3, pool) {
  const Q = prepQuery(q); if (!Q.n) return [];
  const out = [];
  for (const m of (pool || S.materials)) { if (m.active === false) continue; const s = scoreMat(Q, m); if (s >= min) out.push({ m, s }); }
  return out.sort((a, b) => b.s - a.s || a.m.code.localeCompare(b.m.code)).slice(0, n);
}

/* ---------- Thông báo & hộp thoại ---------- */
export function toast(msg, type = '') {
  const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), type === 'err' ? 6500 : 3500);
}
export function modal({ title, body, actions, read, onOpen, wide }) {
  return new Promise(resolve => {
    const ov = document.createElement('div'); ov.className = 'overlay';
    ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><header>${esc(title)}</header><div class="body">${body}</div>
      <footer>${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</footer></div>`;
    document.body.appendChild(ov);
    const close = (v, data) => { ov.remove(); resolve({ action: v, data }); };
    ov.addEventListener('click', async e => {
      const b = e.target.closest('button[data-i]');
      if (b) {
        const a = actions[+b.dataset.i];
        const data = read ? read(ov) : null;
        if (a.validate) { const msg = await a.validate(data, ov); if (msg) { toast(msg, 'err'); return; } }
        close(a.value, data);
      } else if (e.target === ov) close(null, null);
    });
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') close(null, null); });
    if (onOpen) onOpen(ov);
    const f = ov.querySelector('input:not([type=radio]):not([type=checkbox]):not([readonly]),textarea,select') || ov.querySelector('button.primary'); if (f) f.focus();
  });
}
export const confirmBox = (title, html, label = 'Đồng ý', danger = false) =>
  modal({ title, body: html, actions: [{ label: 'Huỷ', value: null }, { label, value: 'ok', primary: !danger, danger }] }).then(r => r.action === 'ok');

/* Thực hiện thao tác ghi → tải lại dữ liệu → vẽ lại màn hình */
export async function runAction(fn, okMsg, onOk) {
  let ok = false;
  try { await fn(); ok = true; if (onOk) onOk(); await hooks.pull().catch(() => {}); if (okMsg) toast(okMsg, 'ok'); }
  catch (e) { toast(isNet(e) ? 'Không có kết nối mạng, thử lại sau' : e.message, 'err'); }
  hooks.renderChrome(); hooks.refresh();
  return ok;
}

/* ---------- Lựa chọn dùng chung ---------- */
export function siteOptions(sel, first = '— Chọn công trường —', byId = false) {
  return `<option value="">${first}</option>` + S.sites.filter(s => s.active !== false).map(s => {
    const v = byId ? s.id : s.code; return `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(s.code)} — ${esc(s.name)}</option>`;
  }).join('');
}
export const locOptions = (sel, withAll = false) =>
  (withAll ? `<option value="" ${sel === '' ? 'selected' : ''}>Tất cả vị trí</option>` : '') +
  `<option value="kho" ${sel === 'kho' ? 'selected' : ''}>Kho tổng</option>` +
  S.sites.filter(s => s.active !== false).map(s => `<option value="${esc(s.code)}" ${sel === s.code ? 'selected' : ''}>${esc(s.code)} — ${esc(s.name)}</option>`).join('');
export const condOptions = (sel, first) => (first ? `<option value="">${first}</option>` : '') +
  Object.entries(COND).map(([k, [l]]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`).join('');
export const groupOptions = (sel, first = 'Tự đoán nhóm', kind) => `<option value="">${first}</option>` +
  S.groups.filter(g => g.active !== false && (!kind || g.kind === kind)).map(g => `<option value="${esc(g.code)}" ${g.code === sel ? 'selected' : ''}>${esc(g.code)} — ${esc(g.name)}</option>`).join('');
export const subgroupOptions = (group, sel, first = '— Nhóm con —') => `<option value="">${first}</option>` +
  S.subgroups.filter(s => s.group_code === group).map(s => `<option value="${esc(s.name)}" ${s.name === sel || s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

/* ---------- Xuất Excel ---------- */
export async function exportRows(rows, name, sheet) {
  if (!rows.length) return toast('Không có dữ liệu để xuất', 'err');
  try {
    if (!window.XLSX) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const ws = window.XLSX.utils.json_to_sheet(rows); const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, sheet); window.XLSX.writeFile(wb, name + '.xlsx');
  } catch {
    const head = Object.keys(rows[0]);
    const csv = '﻿' + [head, ...rows.map(r => head.map(h => r[h]))].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    downloadText(csv, name + '.csv', 'text/csv;charset=utf-8');
    toast('Không tải được thư viện Excel — đã xuất file CSV', '');
  }
}
export function downloadText(text, name, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
}
export const parsePaste = text => text.split(/\r?\n/).map(l => l.trim() ? (l.includes('\t') ? l.split('\t') : l.split('|')).map(x => x.trim()) : null).filter(Boolean);
