// Khởi động ứng dụng: đăng nhập, đồng bộ, khung giao diện, điều hướng, sự kiện
import { CONFIG, DEMO, KEY, LS, IDB, S, ctx, ACT, VIEWS, INPUTS, hooks, $, esc, fmtDT, isNet, toast, confirmBox, ROLE, modal } from './core.js';
import { SupaBackend } from './backend-supabase.js';
import { DemoBackend } from './backend-demo.js';
import './views-order.js';
import './views-track.js';
import './views-kho.js';
import './views-purchase.js';
import './views-sites.js';
import './pdf.js';
import './views-users.js';

/* ---------- Bộ đệm & đồng bộ ---------- */
const stripMat = m => { const { _n, _tg, _tok, _code, ...x } = m; return x; };
function saveCache() {
  const ok = LS.set(KEY.cache, { uid: S.user && S.user.id, sync: S.sync, lastSync: S.lastSync,
    sites: S.sites, groups: S.groups, subgroups: S.subgroups, workCats: S.workCats, materials: S.materials.map(stripMat), profiles: S.profiles, stock: S.stock, assets: S.assets,
    proposals: S.proposals, lines: S.lines, links: S.links, prs: S.prs, items: S.items, deliveries: S.deliveries, atts: S.atts });
  if (!ok) console.warn('Không lưu được bộ đệm (localStorage đầy?)');
}
function loadCache() {
  const c = LS.get(KEY.cache, null);
  if (!c || !c.sync || (S.user && c.uid && c.uid !== S.user.id)) return;
  for (const k of ['sites', 'groups', 'subgroups', 'workCats', 'materials', 'profiles', 'stock', 'assets', 'proposals', 'lines', 'links', 'prs', 'items', 'deliveries', 'atts']) S[k] = c[k] || [];
  S.sync = c.sync; S.lastSync = c.lastSync; S.ver++;
  S.profile = S.profiles.find(p => p.id === (S.user && S.user.id)) || null;
}
const mergeById = (cur, inc) => { const map = new Map(cur.map(x => [x.id, x])); for (const x of inc) map.set(x.id, x); return [...map.values()]; };
const maxTs = (arr, f, cur) => arr.reduce((m, x) => (x[f] && (!m || x[f] > m) ? x[f] : m), cur);

async function pull(full = false) {
  const d = await ctx.B.pull(full ? { pr: null, item: null, att: null } : S.sync);
  for (const k of ['sites', 'groups', 'subgroups', 'workCats', 'materials', 'profiles', 'stock', 'assets', 'proposals', 'lines', 'links']) S[k] = d[k] || [];
  if (d.full) {
    S.prs = d.prs; S.items = d.items; S.atts = d.atts; S.deliveries = d.deliveries;
    S.sync = { pr: maxTs(d.prs, 'updated_at', null), item: maxTs(d.items, 'updated_at', null), att: maxTs(d.atts, 'created_at', null) };
  } else {
    S.prs = mergeById(S.prs, d.prs); S.atts = mergeById(S.atts, d.atts);
    if (d.changedPrs) { const set = new Set(d.changedPrs); S.items = S.items.filter(i => !set.has(i.pr_id)); }
    S.items = mergeById(S.items, d.items);
    if (d.changedItems) { const set = new Set(d.changedItems); S.deliveries = S.deliveries.filter(x => !set.has(x.item_id)).concat(d.deliveries); }
    else S.deliveries = d.deliveries;
    S.sync = { pr: maxTs(d.prs, 'updated_at', S.sync.pr), item: maxTs(d.items, 'updated_at', S.sync.item), att: maxTs(d.atts, 'created_at', S.sync.att) };
    const live = new Set(S.items.map(i => i.id)); S.deliveries = S.deliveries.filter(x => live.has(x.item_id));
  }
  S.ver++;
  S.profile = S.profiles.find(p => p.id === S.user.id) || null;
  S.lastSync = new Date().toISOString();
  saveCache();
  if (!S.profile || S.profile.active === false) {
    toast('Tài khoản đã bị khoá hoặc chưa được cấp quyền. Liên hệ quản trị.', 'err');
    await ctx.B.signOut().catch(() => {}); S.user = null; LS.del(KEY.cache);
  }
}
hooks.pull = pull;

async function flushOutbox() {
  for (const o of [...S.outbox]) {
    try {
      const imgs = (await IDB.get(KEY.obImgs(o.id))) || [];
      const files = [];
      for (const im of imgs) files.push({ path: await ctx.B.uploadImage(im.blob), name: im.name, line: im.line || null });
      const r = await ctx.B.createPR({ ...o.payload, attachments: files });
      S.outbox = S.outbox.filter(x => x.id !== o.id);
      IDB.del(KEY.obImgs(o.id));
      toast(`Đã gửi đơn chờ → ${r.pr_no}`, 'ok');
    } catch (e) {
      if (isNet(e)) break;
      o.error = e.message;
    }
    LS.set(KEY.outbox, S.outbox);
  }
}

async function doUpdate(full = false, silent = false) {
  if (S.syncing || !S.user) return;
  S.syncing = true; renderChrome();
  try {
    await flushOutbox();
    await pull(full);
    if (!silent && S.user) toast('Đã cập nhật dữ liệu mới nhất', 'ok');
  } catch (e) {
    toast(isNet(e) ? 'Không có kết nối — đang dùng dữ liệu đã lưu trên máy' : 'Lỗi cập nhật: ' + e.message, 'err');
  } finally {
    S.syncing = false; render(); openPendingHash();
  }
}

/* ---------- Khung giao diện ---------- */
function tabsFor() {
  return Object.entries(VIEWS).filter(([, v]) => !v.show || v.show()).map(([k, v]) => [k, v.title]);
}
function renderChrome() {
  $('#company').textContent = CONFIG.COMPANY + ' · v' + CONFIG.APP_VERSION;
  const ob = S.outbox.length;
  $('#sync').innerHTML = S.user ? `${S.lastSync ? 'Cập nhật lúc ' + esc(fmtDT(S.lastSync)) : 'Chưa đồng bộ'}${navigator.onLine ? '' : ' · <b>Ngoại tuyến</b>'}${ob ? `<br><span class="badge b-amber">${ob} đơn chờ gửi</span>` : ''}` : '';
  const bu = $('#btn-update');
  bu.style.display = S.user ? '' : 'none';
  bu.disabled = S.syncing;
  bu.innerHTML = S.syncing ? '<span class="spin">⟳</span> Đang cập nhật…' : '⟳ Update';
  $('#user-chip').innerHTML = S.user ? `<span class="badge b-blue">${esc(ROLE[(S.profile || {}).role] || '…')}</span>
      <span class="nowrap uname">${esc((S.profile && S.profile.full_name) || S.user.email)}</span>
      <button class="btn sm ghost" data-act="logout" title="Đăng xuất">Đăng xuất</button>` : '';
  const tabs = tabsFor();
  if (S.user && !tabs.some(([k]) => k === S.tab)) S.tab = 'info';
  $('#tabs').innerHTML = S.user ? tabs.map(([k, l], i) => `<button class="tab" role="tab" data-act="tab" data-tab="${k}" aria-selected="${S.tab === k}"><span class="num">${i + 1}</span>${l}</button>`).join('') : '';
  const ban = DEMO ? `<div class="demo">⚠ <b>Chế độ demo</b> — dữ liệu mẫu chỉ lưu trên máy này. Điền SUPABASE_URL và SUPABASE_ANON_KEY trong <span class="mono">js/config.js</span> để dùng dữ liệu thật.</div>` : '';
  $('#banner').innerHTML = ban; $('#banner').style.display = ban ? '' : 'none';
}
hooks.renderChrome = renderChrome;

function render() {
  document.dispatchEvent(new Event('app:before-render'));
  renderChrome();
  const v = $('#view');
  if (!S.user) { v.innerHTML = viewLogin(); return; }
  const view = VIEWS[S.tab] || VIEWS.info;
  v.innerHTML = view.html();
  if (view.after) view.after();
}
hooks.render = render;
hooks.refresh = () => { const view = VIEWS[S.tab]; if (view && view.refresh) view.refresh(); else render(); };

/* ---------- Đăng nhập ---------- */
function viewLogin() {
  return `<div class="card login">
    <div class="login-brand"><img src="icons/logo.svg" alt=""><div class="co">${esc(CONFIG.COMPANY)}</div><div class="app">Hệ thống đặt hàng vật tư công trường</div></div>
    <h2>Đăng nhập</h2>
    <p class="muted small">Đăng nhập bằng <b>email và mật khẩu công ty cấp</b>. Quên mật khẩu hoặc chưa có tài khoản: liên hệ quản trị hệ thống.</p>
    <div class="form">
      <label class="f">Email công ty<input id="lg-email" type="email" autocomplete="username" placeholder="ten@congty.vn"></label>
      <label class="f">Mật khẩu<input id="lg-pw" type="password" autocomplete="current-password"></label>
      <button class="btn primary" data-act="login">Đăng nhập</button>
    </div>
    ${DEMO ? `<div class="demo-users"><div class="muted small">Chế độ demo — đăng nhập nhanh bằng:</div>
      <button class="btn" data-act="demo-login" data-email="site@demo.vn">👷 Người ở công trường LA01 (site@demo.vn)</button>
      <button class="btn" data-act="demo-login" data-email="vattu@demo.vn">📦 Phòng vật tư (vattu@demo.vn)</button>
      <button class="btn" data-act="demo-login" data-email="thumua@demo.vn">🛒 Thu mua (thumua@demo.vn)</button>
      <button class="btn" data-act="demo-login" data-email="admin@demo.vn">🛠 Quản trị (admin@demo.vn)</button></div>` : ''}
  </div>`;
}
async function doLogin(email, pw) {
  try {
    if (!email) throw new Error('Nhập email');
    if (!DEMO && !pw) throw new Error('Nhập mật khẩu');
    S.user = await ctx.B.signIn(email.trim(), pw || '');
    for (const k of ['prs', 'items', 'deliveries', 'atts']) S[k] = [];
    S.sync = { pr: null, item: null, att: null }; S.batchEdits.clear(); S.expanded.clear(); S.buySel.clear(); S.ver++;
    loadCache(); render();
    await doUpdate(true, true);
  } catch (e) { toast(isNet(e) ? 'Không kết nối được máy chủ' : (/invalid login|invalid credentials/i.test(e.message) ? 'Sai email hoặc mật khẩu' : e.message), 'err'); }
}

Object.assign(ACT, {
  tab: b => { S.tab = b.dataset.tab; LS.set(KEY.tab, S.tab); render(); window.scrollTo(0, 0); },
  update: (b, e) => doUpdate(e.shiftKey),
  login: () => doLogin($('#lg-email').value, $('#lg-pw').value),
  'demo-login': b => doLogin(b.dataset.email, 'demo'),
  logout: async () => {
    if (!(await confirmBox('Đăng xuất?', S.outbox.length ? `<p>Còn <b>${S.outbox.length}</b> đơn chờ gửi trên máy này. Đơn vẫn được giữ cho lần đăng nhập sau.</p>` : '<p>Bạn có chắc muốn đăng xuất?</p>', 'Đăng xuất'))) return;
    await ctx.B.signOut().catch(() => {}); S.user = null; S.profile = null; LS.del(KEY.cache); render();
  },
  'demo-reset': async () => {
    if (!(await confirmBox('Tạo lại dữ liệu demo?', '<p>Toàn bộ dữ liệu demo trên máy này sẽ bị xoá và tạo lại từ đầu.</p>', 'Tạo lại', true))) return;
    ctx.B.reset(); LS.del(KEY.cache); S.outbox = []; LS.set(KEY.outbox, []); S.batchEdits.clear(); S.buySel.clear();
    await doUpdate(true, true); toast('Đã tạo lại dữ liệu demo', 'ok');
  },
  'view-img': b => {
    const c = S.urlCache.get(b.dataset.path); const src = c ? c.url : b.getAttribute('src'); if (!src) return;
    modal({ title: b.alt || 'Hình ảnh', wide: true, body: `<img class="viewer" src="${esc(src)}" alt=""><p class="small" style="text-align:center"><a href="${esc(src)}" target="_blank" rel="noopener">Mở ảnh gốc</a></p>`, actions: [{ label: 'Đóng', value: null }] });
  },
});

/* ---------- Mở tài sản từ mã QR (…#asset=CG-0001-01) ---------- */
let pendingAsset = null;
function readHash() { const m = location.hash.match(/^#asset=(.+)$/); if (m) pendingAsset = decodeURIComponent(m[1]); }
function openPendingHash() {
  if (!pendingAsset || !S.user || !S.assets.length) return;
  const code = pendingAsset; pendingAsset = null;
  history.replaceState(null, '', location.pathname + location.search);
  S.tab = 'kho'; S.khoTab = 'assets'; render();
  if (ACT['open-asset-code']) ACT['open-asset-code']({ dataset: { code } });
}
window.addEventListener('hashchange', () => { readHash(); openPendingHash(); });

/* ---------- Sự kiện chung ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b && ACT[b.dataset.act]) ACT[b.dataset.act](b, e);
});
const handleField = e => { for (const h of INPUTS) if (h(e)) return; };
document.addEventListener('input', handleField);
document.addEventListener('change', e => { if (e.target.matches('select,input[type=checkbox],input[type=radio],input[type=date]')) handleField(e); });
document.addEventListener('keydown', e => { if (e.target.id === 'lg-pw' && e.key === 'Enter') ACT.login(); });
window.addEventListener('online', () => { renderChrome(); doUpdate(false, true); });
window.addEventListener('offline', renderChrome);

/* ---------- Khởi động ---------- */
(async function init() {
  readHash();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  document.dispatchEvent(new Event('app:init'));
  try { ctx.B = DEMO ? DemoBackend() : SupaBackend(); }
  catch (e) { renderChrome(); $('#view').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }
  try { S.user = await ctx.B.session(); } catch { S.user = null; }
  if (S.user) loadCache();
  render();
  if (S.user) doUpdate(false, true);
})();
