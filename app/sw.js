// Service worker: cho phép mở ứng dụng khi mất mạng.
// • File của ứng dụng: lấy bản mới từ mạng trước, mất mạng thì dùng bản đã lưu.
// • Thư viện CDN (có số phiên bản cố định): lưu lại, dùng bản đã lưu.
// • Dữ liệu Supabase: KHÔNG lưu ở đây (ứng dụng tự lưu bộ đệm và đơn chờ gửi).
const CACHE = 'vattu-v2.7.0';   // đổi mỗi lần phát hành
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/logo.png',
  'js/config.js', 'js/core.js', 'js/main.js', 'js/backend-supabase.js', 'js/backend-demo.js',
  'js/views-order.js', 'js/views-track.js', 'js/views-kho.js', 'js/views-purchase.js', 'js/views-sites.js', 'js/views-users.js', 'js/views-log.js', 'js/pdf.js'];
const CDN = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined))));
  } else if (CDN.includes(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
