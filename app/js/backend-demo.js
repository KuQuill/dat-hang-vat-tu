// Chế độ demo: dữ liệu mẫu lưu trên máy, mô phỏng đúng các hàm Supabase (001_init.sql)
import { KEY, LS, S, uid, norm, todayISO, addDays, fmtD, fmtN, round6, parseNum, matchMaterials, MATCH,
         compressImage, blobToDataURL, toast, OPEN_ST, USABLE, APPROVED_PR } from './core.js';

const GROUPS = [
  ['CG', 'Cơ giới', 'tung_cai', true, ['xe dao', 'xe cuoc', 'may xuc', 'may dao', 'xe ui', 'xe lu', 'xe cau', 'can cau', 'xe tai', 'xe nang', 'xe ben'], 10],
  ['MM', 'Máy móc', 'tung_cai', true, ['may tron', 'may dam', 'may han', 'may cat', 'may khoan', 'may bom', 'may phat dien', 'may nen khi', 'may mai', 'may uon'], 20],
  ['DC', 'Công cụ dụng cụ', 'so_luong', true, ['gian giao', 'cay chong', 'xa go', 'bua', 'xeng', 'xe rua', 'thuoc', 'mu bao ho', 'gang tay', 'day an toan', 'bao ho'], 30],
  ['KC', 'Vật tư kết cấu', 'so_luong', false, ['thep', 'sat', 'xi mang', 'cat', 'da', 'soi', 'gach', 'be tong', 'cop pha', 'van ep', 'bu long', 'que han', 'day buoc', 'phu gia'], 40],
  ['HT', 'Vật tư hoàn thiện', 'so_luong', false, ['son', 'bot tret', 'gach men', 'gach op', 'gach lat', 'thach cao', 'tran', 'vach', 'kinh', 'cua', 'chong tham', 'keo dan'], 50],
  ['NT', 'Vật tư nội thất', 'so_luong', false, ['ban', 'ghe', 'tu', 'giuong', 'sofa', 'rem', 'ke', 'tham'], 60],
  ['MEP', 'Vật tư MEP', 'so_luong', false, ['day dien', 'cap dien', 'aptomat', 'mcb', 'cb', 'den', 'o cam', 'cong tac', 'ong luon', 'ong nuoc', 'ppr', 'upvc', 'hdpe', 'pvc', 'van', 'dieu hoa', 'quat', 'binh chua chay', 'sprinkler'], 70],
  ['K', 'Khác', 'so_luong', false, [], 999],
];
const SUBS = { CG: ['Xe đào', 'Xe cẩu', 'Xe tải', 'Xe lu'], MM: ['Máy trộn', 'Máy hàn', 'Máy phát điện', 'Máy đầm'], DC: ['Giàn giáo', 'Dụng cụ cầm tay', 'An toàn lao động'],
  KC: ['Thép', 'Xi măng', 'Cát đá', 'Gạch', 'Bê tông', 'Cốp pha'], HT: ['Sơn', 'Gạch ốp lát', 'Trần vách', 'Cửa'], NT: ['Bàn ghế', 'Tủ kệ'], MEP: ['Điện', 'Cấp thoát nước', 'Điều hòa thông gió', 'PCCC'] };

export function DemoBackend() {
  const now = () => new Date().toISOString();
  const fail = m => { throw new Error(m); };
  let db;

  /* ---------- Hàm nội bộ (tương ứng schema app.*) ---------- */
  const me = () => db.profiles.find(p => p.id === LS.get(KEY.demouser) && p.active);
  const req = roles => { const u = me(); if (!u) fail('Bạn chưa đăng nhập'); if (!roles.includes(u.role)) fail('Bạn không có quyền thực hiện thao tác này'); return u; };
  const mat = id => db.materials.find(m => m.id === id);
  const grp = code => db.groups.find(g => g.code === code);
  const kindOf = mid => (grp((mat(mid) || {}).group_code) || {}).kind || 'so_luong';
  const log = (prId, itemId, user, field, o, n) => db.history.push({ pr_id: prId, item_id: itemId, changed_by: user, field, old_value: o, new_value: n, created_at: now() });
  const nextDoc = kind => { const y = todayISO().slice(0, 4); const k = kind + y; db.counters[k] = (db.counters[k] || 0) + 1; return `${kind}-${y}-${String(db.counters[k]).padStart(4, '0')}`; };
  function nextMatCode(code) {
    const g = grp(code) || fail(`Nhóm vật tư "${code}" không tồn tại`);
    let c; do { g.seq++; c = `${g.code}-${String(g.seq).padStart(4, '0')}`; } while (db.materials.some(m => m.code === c));
    return c;
  }
  const resolveGroup = p => { const s = String(p || '').trim(); if (!s) return null; const g = db.groups.find(g => g.code === s.toUpperCase() || norm(g.name) === norm(s)); return g ? g.code : null; };
  function guessGroup(q) {
    const n = ' ' + norm(q) + ' ';
    let best = null;
    for (const g of [...db.groups].filter(g => g.active).sort((a, b) => a.priority - b.priority)) {
      const k = [...g.keywords].sort((a, b) => b.length - a.length).find(k => n.includes(' ' + k + ' '));
      if (k) { best = g.code; break; }
    }
    return best || 'K';
  }
  function parseCond(p) {
    const n = norm(p).replace(/_/g, ' ');
    if (['', 'moi', 'con moi', 'new'].includes(n)) return 'moi';
    if (['da qua su dung', 'qua su dung', 'cu', 'da su dung', 'used'].includes(n)) return 'da_qua_su_dung';
    if (['hong', 'hu', 'hong hoc', 'hu hong'].includes(n)) return 'hong';
    if (['dang sua', 'sua chua', 'dang sua chua', 'bao duong', 'dang bao duong'].includes(n)) return 'dang_sua';
    fail(`Tình trạng "${p}" không hợp lệ (Mới / Đã qua sử dụng / Hỏng / Đang sửa)`);
  }
  function siteOf(p) {
    const s = String(p ?? '').trim();
    if (!s || ['kho tong', 'kho'].includes(norm(s))) return null;
    const x = db.sites.find(x => x.code.toUpperCase() === s.toUpperCase() || norm(x.name) === norm(s));
    return x ? x.id : fail(`Không tìm thấy công trường "${p}"`);
  }
  function findPR(p) {
    const s = String(p || '').replace(/\s/g, '').toUpperCase();
    return db.prs.find(x => x.pr_no.toUpperCase() === s)
      || db.prs.filter(x => (x.base_no || '').toUpperCase() === s).sort((a, b) => b.revision - a.revision)[0]
      || fail('Không tìm thấy phiếu ' + s);
  }
  function nextPrBase(siteId, cat) {
    const code = db.sites.find(x => x.id === siteId).code; const k = 'PR:' + code + '.' + cat;
    db.counters[k] = (db.counters[k] || 0) + 1;
    return `${code}.${cat}.PR${String(db.counters[k]).padStart(2, '0')}`;
  }
  function parseAlloc(pr, line, qty, alloc) {
    if (!Array.isArray(alloc) || !alloc.length) return null;
    const ws = db.sites.find(s => s.id === pr.site_id);
    if (!ws || !ws.is_workshop) fail(`Dòng ${line}: chỉ PR của xưởng mới chia số lượng cho dự án`);
    const map = new Map(); let sum = 0;
    for (const a of alloc) {
      const q = Number(a.qty); if (!q) continue; if (q < 0) fail(`Dòng ${line}: số lượng chia phải lớn hơn 0`);
      const s = db.sites.find(x => (a.site_id ? x.id === a.site_id : x.code.toUpperCase() === String(a.site || '').trim().toUpperCase()) && x.active !== false && !x.is_workshop);
      if (!s) fail(`Dòng ${line}: dự án "${a.site || a.site_id}" không tồn tại hoặc đã ngừng`);
      map.set(s.id, (map.get(s.id) || 0) + q); sum += q;
    }
    if (sum > qty + 1e-9) fail(`Dòng ${line}: tổng chia cho các dự án (${sum}) vượt số lượng đặt (${qty})`);
    return map.size ? [...map].map(([site_id, q]) => ({ site_id, qty: q })) : null;
  }
  function insertItems(u, pr, items, via) {
    if (!Array.isArray(items) || !items.length) fail('Đơn hàng chưa có dòng vật tư nào');
    return items.map((it, i) => {
      const qty = Number(it.qty); if (!(qty > 0)) fail(`Dòng ${i + 1}: số lượng phải lớn hơn 0`);
      let m;
      if (it.material_id) m = { ...(mat(it.material_id) || fail(`Dòng ${i + 1}: vật tư không tồn tại`)), created: false };
      else if (it.code) m = { ...(db.materials.find(x => x.code.toUpperCase() === it.code.toUpperCase()) || fail(`Dòng ${i + 1}: không có mã ${it.code}`)), created: false };
      else m = findOrCreate(u, it, via);
      const unit = (it.unit || '').trim() || m.unit;
      const alloc = parseAlloc(pr, i + 1, qty, it.alloc);
      db.items.push({ id: uid(), pr_id: pr.id, line_no: i + 1, material_id: m.id, qty, unit, note: it.note || null, alloc, supplier: null, po_no: null, eta: null, received_date: null, qty_received: 0, status: 'cho_xu_ly', updated_at: now() });
      return { line: i + 1, id: m.id, code: m.code, name: m.name, unit, qty, created: m.created, input_name: it.name || null };
    });
  }
  function attachFiles(u, pr, files) {
    for (const f of (files || [])) {
      const item = f.line ? db.items.find(i => i.pr_id === pr.id && i.line_no === f.line) : null;
      db.atts.push({ id: uid(), pr_id: pr.id, item_id: item ? item.id : null, delivery_id: null, path: f.path, file_name: f.name, uploaded_by: u.id, created_at: now() });
    }
  }
  function recall(u, pr, reason) {
    if (!(pr.requested_by === u.id || ['manager', 'admin'].includes(u.role))) fail('Chỉ người đặt hàng hoặc quản lý mới thu hồi được PR');
    if (pr.status === 'thu_hoi') return;
    if (!['cho_duyet', 'tu_choi', 'da_duyet', 'da_dat'].includes(pr.status)) fail('PR đang giao, đã nhận hoặc đã đóng — không thu hồi được, hãy liên hệ phòng vật tư');
    const itemIds = new Set(db.items.filter(i => i.pr_id === pr.id).map(i => i.id));
    const dels = db.deliveries.filter(d => itemIds.has(d.item_id));
    if (dels.some(d => ['dang_giao', 'da_ve', 'co_van_de'].includes(d.status))) fail('PR đã có đợt đang giao hoặc đã nhận — không thu hồi được');
    const busy = dels.some(d => { const l = db.links.find(x => x.delivery_id === d.id); const ln = l && db.lines.find(x => x.id === l.line_id); const pp = ln && db.proposals.find(x => x.id === ln.proposal_id); return pp && ['dang_mua', 'da_mua'].includes(pp.status); });
    if (busy) fail('Thu mua đang mua hàng cho PR này — liên hệ phòng vật tư trước khi thu hồi');
    const delIds = new Set(dels.map(d => d.id));
    db.deliveries = db.deliveries.filter(d => !delIds.has(d.id)); db.links = db.links.filter(l => !delIds.has(l.delivery_id));
    for (const i of db.items.filter(i => i.pr_id === pr.id)) Object.assign(i, { status: 'cho_xu_ly', eta: null, received_date: null, qty_received: 0, supplier: null, po_no: null, updated_at: now() });
    log(pr.id, null, u.id, 'thu_hoi', pr.status, (reason || '').trim() || 'thu hồi để sửa');
    Object.assign(pr, { status: 'thu_hoi', approved_by: null, approved_at: null, reject_reason: (reason || '').trim() || null, updated_at: now() });
  }
  function findOrCreate(u, it, via) {
    const q = ((it.name || '') + ' ' + (it.spec || '')).trim();
    if (!(it.name || '').trim()) fail('Thiếu tên vật tư');
    if (!it.force_new) {
      const best = matchMaterials(q, 1, MATCH, db.materials.map(m => ({ ...m })))[0];
      if (best) return { ...mat(best.m.id), created: false };
    }
    if (!(it.unit || '').trim()) fail(`Vật tư mới "${it.name}" cần có đơn vị tính`);
    const g = resolveGroup(it.group) || guessGroup(q);
    const sub = it.subgroup ? db.subgroups.find(s => s.group_code === g && norm(s.name) === norm(it.subgroup)) : null;
    const m = { id: uid(), code: nextMatCode(g), name: it.name.trim(), spec: (it.spec || '').trim() || null, unit: it.unit.trim(), group_code: g,
                subgroup_id: sub ? sub.id : null, image_path: null, is_new: true, active: true, created_by: u.id, created_via: via, created_at: now() };
    db.materials.push(m);
    return { ...m, created: true };
  }
  function stockApply(u, mid, site, cond, mode, qty, loc, min, reason, ref) {
    let s = db.stock.find(x => x.material_id === mid && (x.site_id || null) === (site || null) && x.condition === cond);
    const old = s ? Number(s.qty) : null;
    const nv = round6(mode === 'set' ? qty : (old || 0) + qty);
    if (nv < 0) fail(`Tồn kho không đủ (còn ${fmtN(old || 0)}, cần trừ ${fmtN(-qty)})`);
    if (!s) { s = { id: uid(), material_id: mid, site_id: site || null, condition: cond, qty: nv, min_qty: min ?? null, location_detail: (loc || '').trim() || null, image_path: null, note: null }; db.stock.push(s); }
    else { s.qty = nv; if (min != null) s.min_qty = min; if ((loc || '').trim()) s.location_detail = loc.trim(); }
    s.updated_by = u.id; s.updated_at = now();
    db.stockLog.push({ stock_id: s.id, material_id: mid, site_id: site || null, condition: cond, old_qty: old, new_qty: nv, reason, ref_id: ref || null, changed_by: u.id, created_at: now() });
    return s.id;
  }
  const stockFree = (id, excl) => { const s = db.stock.find(x => x.id === id); if (!s) return 0;
    return round6(Number(s.qty) - db.deliveries.filter(d => d.stock_id === id && d.source === 'kho' && OPEN_ST.includes(d.status) && d.id !== excl).reduce((a, d) => a + Number(d.qty), 0)); };
  const assetBusy = (id, excl) => db.deliveries.some(d => d.asset_id === id && OPEN_ST.includes(d.status) && d.id !== excl);
  const assetLog = (aid, action, fs, ts, fc, tc, ref, note, u) => db.assetHistory.push({ id: uid(), asset_id: aid, action, from_site: fs || null, to_site: ts || null, from_condition: fc || null, to_condition: tc || null, ref_id: ref || null, note: note || null, changed_by: u, created_at: now() });
  function createAsset(u, mid, serial, site, cond, loc, note, ref) {
    const m = mat(mid) || fail('Vật tư không tồn tại');
    if ((serial || '').trim() && db.assets.some(a => a.material_id === mid && a.serial === serial.trim())) fail(`Biển số / seri "${serial}" đã tồn tại`);
    let n = db.assets.filter(a => a.material_id === mid).length + 1, code;
    do { code = `${m.code}-${String(n).padStart(2, '0')}`; n++; } while (db.assets.some(a => a.asset_code === code));
    const a = { id: uid(), asset_code: code, material_id: mid, serial: (serial || '').trim() || null, site_id: site || null, location_detail: (loc || '').trim() || null,
                condition: cond || 'moi', image_path: null, note: (note || '').trim() || null, active: true, created_by: u.id, created_at: now(), updated_at: now() };
    db.assets.push(a);
    assetLog(a.id, 'tao', null, site, null, a.condition, ref, note, u.id);
    return a;
  }
  function recalcItem(i) {
    const ds = db.deliveries.filter(d => d.item_id === i.id); if (!ds.length) return;
    const live = ds.filter(d => d.status !== 'huy'); const c = s => ds.filter(d => d.status === s).length;
    i.status = !live.length ? 'huy' : c('co_van_de') ? 'co_van_de' : c('da_ve') === live.length ? 'da_ve' : (c('da_ve') || c('dang_giao')) ? 'dang_giao' : c('da_dat') ? 'da_dat' : 'cho_xu_ly';
    const etas = ds.filter(d => OPEN_ST.includes(d.status) && d.eta).map(d => d.eta).sort();
    const recs = ds.filter(d => ['da_ve', 'co_van_de'].includes(d.status) && d.received_date).map(d => d.received_date).sort();
    i.eta = etas[0] || null; i.received_date = recs[recs.length - 1] || null;
    i.qty_received = round6(ds.filter(d => ['da_ve', 'co_van_de'].includes(d.status)).reduce((a, d) => a + Number(d.qty_actual ?? d.qty), 0));
    i.supplier = [...new Set(live.map(d => d.supplier).filter(Boolean))].join(', ') || null;
    i.po_no = [...new Set(live.map(d => d.po_no).filter(Boolean))].join(', ') || null;
    i.updated_at = now();
    const pr = db.prs.find(p => p.id === i.pr_id); if (pr) pr.updated_at = now();
  }
  function recalcPR(pr, u) {
    if (!['da_duyet', 'da_dat', 'dang_giao', 'co_van_de', 'da_ve'].includes(pr.status)) return;
    const its = db.items.filter(i => i.pr_id === pr.id && i.status !== 'huy'); const c = s => its.filter(i => i.status === s).length;
    const st = !its.length ? 'huy' : c('co_van_de') ? 'co_van_de' : c('da_ve') === its.length ? 'da_ve' : (c('dang_giao') || c('da_ve')) ? 'dang_giao' : c('da_dat') ? 'da_dat' : 'da_duyet';
    if (st !== pr.status) { log(pr.id, null, u.id, 'status', pr.status, st); pr.status = st; }
    pr.updated_at = now();
  }
  const newDel = (itemId, no, qty, extra = {}) => ({ id: uid(), item_id: itemId, batch_no: no, qty, source: 'mua', stock_id: null, asset_id: null, supplier: null, po_no: null, eta: null,
    status: 'cho_xu_ly', note: null, qty_actual: null, receipt_issues: [], receipt_note: null, serials: null, received_date: null, confirmed_by: null, confirmed_at: null,
    resolution: null, resolution_note: null, resolved_by: null, resolved_at: null, stock_moved: false, updated_at: now(), ...extra });
  function planDeliveries(pr) {
    for (const it of db.items.filter(i => i.pr_id === pr.id && i.status !== 'huy' && !db.deliveries.some(d => d.item_id === i.id)).sort((a, b) => a.line_no - b.line_no)) {
      let need = Number(it.qty), no = 0;
      if (kindOf(it.material_id) === 'tung_cai') {
        for (const a of db.assets.filter(a => a.material_id === it.material_id && !a.site_id && a.active && USABLE.includes(a.condition) && !assetBusy(a.id))
                                 .sort((a, b) => (b.condition === 'moi') - (a.condition === 'moi') || a.asset_code.localeCompare(b.asset_code))) {
          if (need < 1) break;
          db.deliveries.push(newDel(it.id, ++no, 1, { source: 'kho', asset_id: a.id })); need -= 1;
        }
      } else {
        for (const s of db.stock.filter(s => s.material_id === it.material_id && !s.site_id && USABLE.includes(s.condition)).sort((a, b) => (b.condition === 'moi') - (a.condition === 'moi'))) {
          if (need <= 0) break;
          const free = stockFree(s.id);
          if (free > 0) { const take = Math.min(free, need); db.deliveries.push(newDel(it.id, ++no, round6(take), { source: 'kho', stock_id: s.id })); need = round6(need - take); }
        }
      }
      if (need > 0) db.deliveries.push(newDel(it.id, ++no, need));
      recalcItem(it);
    }
  }
  function receiveToSite(u, d) {
    if (d.stock_moved) return;
    const it = db.items.find(i => i.id === d.item_id); const pr = db.prs.find(p => p.id === it.pr_id);
    const g = grp(mat(it.material_id).group_code);
    let qty = Number(d.qty_actual ?? d.qty);
    if (g.kind === 'tung_cai') {
      if (d.source === 'kho' && d.asset_id) {
        const a = db.assets.find(x => x.id === d.asset_id);
        if (a) { const from = a.site_id; a.site_id = pr.site_id; a.location_detail = null; a.updated_at = now(); assetLog(a.id, 'nhan', from, pr.site_id, a.condition, a.condition, d.id, 'Nhận theo ' + pr.pr_no, u.id); }
      } else if (d.source === 'mua' && qty >= 1) {
        const serials = String(d.serials || '').split(/\s*[,;\n]\s*/);
        for (let k = 0; k < Math.floor(qty); k++) createAsset(u, it.material_id, serials[k], pr.site_id, 'moi', null, 'Mua mới theo ' + pr.pr_no, d.id);
      }
    } else if (d.source === 'kho' && d.stock_id) {
      const s = db.stock.find(x => x.id === d.stock_id);
      if (s) {
        qty = Math.min(qty, Number(s.qty));
        if (qty > 0) {
          stockApply(u, s.material_id, null, s.condition, 'add', -qty, null, null, 'Xuất cho ' + pr.pr_no, d.id);
          if (g.track_site) stockApply(u, s.material_id, pr.site_id, s.condition, 'add', qty, null, null, 'Nhận từ kho tổng — ' + pr.pr_no, d.id);
        }
      }
    } else if (d.source === 'mua' && g.track_site && qty > 0) {
      stockApply(u, it.material_id, pr.site_id, 'moi', 'add', qty, null, null, 'Mua mới — ' + pr.pr_no, d.id);
    }
    d.stock_moved = true;
  }

  /* ---------- Dữ liệu mẫu ---------- */
  function seed() {
    db = { v: 6, workCats: [['CB', 'Công tác chuẩn bị, lán trại, tạm', 10], ['XD', 'Xây dựng – kết cấu', 20], ['MEP', 'Cơ điện (M&E)', 30], ['PCCC', 'Phòng cháy chữa cháy', 40], ['HT', 'Hoàn thiện', 50], ['NT', 'Nội thất', 60], ['HTKT', 'Hạ tầng kỹ thuật', 70], ['CQ', 'Cảnh quan', 80], ['TB', 'Thiết bị', 90], ['K', 'Khác', 999]].map(([code, name, sort]) => ({ code, name, sort, active: true })), sites: [], groups: [], subgroups: [], materials: [], profiles: [], stock: [], stockLog: [], assets: [], assetHistory: [],
           prs: [], items: [], deliveries: [], atts: [], blobs: {}, proposals: [], lines: [], links: [], counters: {}, history: [] };
    const t = todayISO();
    db.groups = GROUPS.map(([code, name, kind, track_site, keywords, priority]) => ({ code, name, kind, track_site, keywords, priority, seq: 0, active: true }));
    for (const [g, arr] of Object.entries(SUBS)) for (const name of arr) db.subgroups.push({ id: uid(), group_code: g, name });
    db.sites = [
      { id: 's1', code: 'LA01', name: 'Nhà xưởng Long An', address: 'KCN Tân Đức, Đức Hòa, Long An', manager: 'Phạm Văn Hùng', active: true },
      { id: 's2', code: 'BD02', name: 'Kho lạnh Bình Dương', address: 'KCN VSIP II, Thủ Dầu Một', manager: 'Võ Thanh Tâm', active: true },
      { id: 's3', code: 'HCM03', name: 'Văn phòng Quận 7', address: 'Nguyễn Lương Bằng, Q.7, TP.HCM', manager: 'Đỗ Minh Khang', active: true },
      { id: 's4', code: 'XNT', name: 'Xưởng nội thất', address: 'Xưởng sản xuất nội thất', manager: 'Trưởng xưởng', active: true, is_workshop: true },
    ];
    db.profiles = [
      { id: 'u1', email: 'site@demo.vn', full_name: 'Nguyễn Văn An', phone: '0901 111 222', role: 'site', site_id: 's1', active: true },
      { id: 'u2', email: 'vattu@demo.vn', full_name: 'Trần Thị Bình', phone: '0902 333 444', role: 'procurement', site_id: null, active: true },
      { id: 'u4', email: 'quanly@demo.vn', full_name: 'Phạm Thu Hà', phone: '0904 777 888', role: 'manager', site_id: null, active: true },
      { id: 'u3', email: 'admin@demo.vn', full_name: 'Lê Minh Châu', phone: '0903 555 666', role: 'admin', site_id: null, active: true },
    ];
    const sys = { id: 'u2' };
    const M = {};
    const addM = (key, g, name, spec, unit, sub) => {
      const s = db.subgroups.find(x => x.group_code === g && x.name === sub);
      const m = { id: uid(), code: nextMatCode(g), name, spec: spec || null, unit, group_code: g, subgroup_id: s ? s.id : null, image_path: null, is_new: false, active: true, created_via: 'import', created_at: now() };
      db.materials.push(m); M[key] = m; return m;
    };
    addM('pc200', 'CG', 'Xe đào Komatsu PC200', 'gầu 0.8 m3', 'chiếc', 'Xe đào'); addM('cau25', 'CG', 'Xe cẩu bánh lốp 25 tấn', '', 'chiếc', 'Xe cẩu');
    addM('tron', 'MM', 'Máy trộn bê tông 350L', '', 'chiếc', 'Máy trộn'); addM('han', 'MM', 'Máy hàn điện tử 250A', '', 'chiếc', 'Máy hàn'); addM('phat', 'MM', 'Máy phát điện 50kVA', '', 'chiếc', 'Máy phát điện');
    addM('giao', 'DC', 'Giàn giáo khung 1.7m', 'bộ đầy đủ chéo, mâm', 'bộ', 'Giàn giáo'); addM('chong', 'DC', 'Cây chống tăng 3m', '', 'cây', 'Giàn giáo');
    addM('mu', 'DC', 'Mũ bảo hộ', 'màu trắng', 'cái', 'An toàn lao động'); addM('dayat', 'DC', 'Dây an toàn toàn thân', '', 'bộ', 'An toàn lao động');
    addM('d10', 'KC', 'Thép thanh vằn D10', 'CB300-V', 'tấn', 'Thép'); addM('d16', 'KC', 'Thép thanh vằn D16', 'CB400-V', 'tấn', 'Thép'); addM('d18', 'KC', 'Thép thanh vằn D18', 'CB400-V', 'tấn', 'Thép');
    addM('pcb40', 'KC', 'Xi măng PCB40', 'bao 50kg', 'bao', 'Xi măng'); addM('pcb30', 'KC', 'Xi măng PCB30', 'bao 50kg', 'bao', 'Xi măng');
    addM('cat', 'KC', 'Cát vàng bê tông', '', 'm3', 'Cát đá'); addM('da', 'KC', 'Đá 1x2', '', 'm3', 'Cát đá'); addM('block', 'KC', 'Gạch block 100x190x390', '', 'viên', 'Gạch');
    addM('vanep', 'KC', 'Ván ép phủ phim', '1220x2440x18mm', 'tấm', 'Cốp pha');
    addM('son', 'HT', 'Sơn lót chống kiềm ngoại thất', 'thùng 18L', 'thùng', 'Sơn'); addM('men', 'HT', 'Gạch men 600x600', 'men bóng', 'm2', 'Gạch ốp lát'); addM('tc', 'HT', 'Tấm thạch cao 9mm', '1220x2440', 'tấm', 'Trần vách');
    addM('ban', 'NT', 'Bàn làm việc 1m2', '', 'cái', 'Bàn ghế'); addM('ghe', 'NT', 'Ghế xoay văn phòng', '', 'cái', 'Bàn ghế');
    addM('cv25', 'MEP', 'Dây điện Cadivi CV 2.5', 'cuộn 100m', 'cuộn', 'Điện'); addM('cv40', 'MEP', 'Dây điện Cadivi CV 4.0', 'cuộn 100m', 'cuộn', 'Điện');
    addM('ppr', 'MEP', 'Ống nhựa PPR D25', 'PN20, cây 4m', 'cây', 'Cấp thoát nước'); addM('mcb', 'MEP', 'Aptomat MCB 2P 32A', '', 'cái', 'Điện');
    addM('bat', 'K', 'Bạt che phủ', '4x6m', 'tấm', null);
    const st = (k, qty, opt = {}) => { const id = stockApply(sys, M[k].id, opt.site || null, opt.cond || 'moi', 'set', qty, opt.loc, opt.min ?? null, 'Tồn đầu kỳ'); return id; };
    st('d16', 12, { min: 5, loc: 'Bãi thép A' }); st('d10', 3.5, { min: 2, loc: 'Bãi thép A' }); st('pcb40', 320, { min: 200, loc: 'Kho chính' }); st('pcb30', 45, { min: 100, loc: 'Kho chính' });
    st('cat', 25, { loc: 'Bãi cát' }); st('da', 18, { loc: 'Bãi đá' }); st('block', 4200); st('vanep', 35, { min: 50 }); st('son', 9); st('men', 120); st('tc', 60);
    st('ban', 4); st('ghe', 10); st('cv25', 14, { loc: 'Kệ điện 2' }); st('cv40', 6, { loc: 'Kệ điện 2' }); st('ppr', 80); st('mcb', 22);
    st('giao', 300, { loc: 'Bãi giàn giáo' }); st('giao', 120, { cond: 'da_qua_su_dung', loc: 'Bãi giàn giáo' }); st('giao', 15, { cond: 'hong' }); st('giao', 80, { site: 's1', cond: 'da_qua_su_dung' });
    st('chong', 500); st('mu', 60, { min: 30 }); st('dayat', 12);
    const as = (k, serial, site, cond, loc) => createAsset(sys, M[k].id, serial, site, cond, loc, 'Khai báo đầu kỳ');
    as('pc200', '51C-123.45', null, 'moi', 'Bãi xe'); as('pc200', '51C-678.90', 's1', 'da_qua_su_dung');
    as('cau25', '51D-246.80', null, 'dang_sua', 'Xưởng sửa chữa');
    as('tron', 'MT350-0012', null, 'moi'); as('tron', 'MT350-0013', null, 'hong'); as('tron', 'MT350-0014', 's2', 'da_qua_su_dung');
    as('han', 'MH250-0101', null, 'moi'); as('han', 'MH250-0102', null, 'da_qua_su_dung'); as('phat', 'MPD50-07', 's1', 'da_qua_su_dung');

    const stockRow = (k, cond = 'moi', site = null) => db.stock.find(s => s.material_id === M[k].id && s.condition === cond && (s.site_id || null) === site);
    const mkPR = (site, user, title, need, status, daysAgo, cat) => {
      const created = new Date(Date.now() - daysAgo * 864e5).toISOString();
      const base = nextPrBase(site, cat);
      const pr = { id: uid(), pr_no: base + '.R1', base_no: base, revision: 1, category: cat, title, site_id: site, delivery_place: 'Cổng chính công trường', requested_by: user, need_date: need, note: '', status, source: 'html',
                   approved_by: status === 'cho_duyet' ? null : 'u2', approved_at: status === 'cho_duyet' ? null : created, reject_reason: null, created_at: created, updated_at: created };
      db.prs.push(pr); return pr;
    };
    const mkItem = (pr, no, k, qty) => { const it = { id: uid(), pr_id: pr.id, line_no: no, material_id: M[k].id, qty, unit: M[k].unit, note: null, supplier: null, po_no: null, eta: null, received_date: null, qty_received: 0, status: 'cho_xu_ly', updated_at: pr.created_at }; db.items.push(it); return it; };

    // PR1: thép chia 2 đợt (đợt kho đã nhận, đợt mua đang trễ) + xi măng đã nhận
    const p1 = mkPR('s1', 'u1', 'Thép + xi măng đổ móng nhà xưởng', addDays(t, -2), 'dang_giao', 9, 'XD');
    const i11 = mkItem(p1, 1, 'd16', 40), i12 = mkItem(p1, 2, 'pcb40', 200);
    db.deliveries.push(newDel(i11.id, 1, 20, { source: 'kho', stock_id: stockRow('d16').id, status: 'da_ve', qty_actual: 20, received_date: addDays(t, -6), confirmed_by: 'u1', confirmed_at: now(), stock_moved: true, supplier: 'Kho tổng' }));
    const b12 = newDel(i11.id, 2, 20, { status: 'da_dat', eta: addDays(t, -1), supplier: 'Hòa Phát', po_no: 'PO-1021' }); db.deliveries.push(b12);
    db.deliveries.push(newDel(i12.id, 1, 200, { source: 'kho', stock_id: stockRow('pcb40').id, status: 'da_ve', qty_actual: 200, received_date: addDays(t, -6), confirmed_by: 'u1', confirmed_at: now(), stock_moved: true }));
    // PR2: giao nhầm dây CV 4.0 → có vấn đề; aptomat đang giao
    const p2 = mkPR('s2', 'u1', 'Dây điện + aptomat tủ điện tầng 1', addDays(t, 3), 'co_van_de', 5, 'MEP');
    const i21 = mkItem(p2, 1, 'cv25', 10), i22 = mkItem(p2, 2, 'mcb', 12);
    db.deliveries.push(newDel(i21.id, 1, 10, { source: 'kho', stock_id: stockRow('cv25').id, status: 'co_van_de', qty_actual: 10, receipt_issues: ['sai_hang'],
      receipt_note: 'Giao nhầm dây CV 4.0, công trường đặt CV 2.5', received_date: addDays(t, -1), confirmed_by: 'u1', confirmed_at: now() }));
    db.deliveries.push(newDel(i22.id, 1, 12, { source: 'kho', stock_id: stockRow('mcb').id, status: 'dang_giao', eta: addDays(t, 1) }));
    // PR3: chờ duyệt — có xe đào, máy hàn, giàn giáo, ống PPR (kho thiếu)
    const p3 = mkPR('s1', 'u1', 'Thiết bị + vật tư thi công tầng 3', addDays(t, 10), 'cho_duyet', 1, 'XD');
    mkItem(p3, 1, 'pc200', 1); mkItem(p3, 2, 'han', 2); mkItem(p3, 3, 'giao', 200); mkItem(p3, 4, 'ppr', 150);
    // PR4: bàn thiếu 2 cái → cần mua (chưa đề xuất); ghế đang giao
    const p4 = mkPR('s3', 'u3', 'Bàn ghế văn phòng ban chỉ huy', addDays(t, 5), 'dang_giao', 3, 'NT');
    const i41 = mkItem(p4, 1, 'ban', 6), i42 = mkItem(p4, 2, 'ghe', 6);
    db.deliveries.push(newDel(i41.id, 1, 4, { source: 'kho', stock_id: stockRow('ban').id })); db.deliveries.push(newDel(i41.id, 2, 2));
    db.deliveries.push(newDel(i42.id, 1, 6, { source: 'kho', stock_id: stockRow('ghe').id, status: 'dang_giao', eta: addDays(t, 1) }));
    for (const it of db.items) recalcItem(it);
    for (const pr of db.prs) { if (pr.status !== 'cho_duyet') recalcPR(pr, sys); pr.updated_at = pr.created_at; }
    // Đề xuất mua đang xử lý cho đợt 2 của thép
    const pp = { id: uid(), pp_no: nextDoc('DX'), title: 'Mua thép D16 bổ sung móng LA01', status: 'dang_mua', note: null, purchasing_note: 'Đã chốt giá với Hòa Phát',
                 created_by: 'u2', handled_by: 'u4', created_at: new Date(Date.now() - 8 * 864e5).toISOString(), updated_at: now() };
    db.proposals.push(pp);
    const ln = { id: uid(), proposal_id: pp.id, line_no: 1, material_id: M.d16.id, qty: 20, unit: 'tấn', need_date: p1.need_date, supplier: 'Hòa Phát', unit_price: 15500000, eta: addDays(t, -1), po_no: 'PO-1021', note: null, updated_at: now() };
    db.lines.push(ln); db.links.push({ delivery_id: b12.id, line_id: ln.id });
    return db;
  }

  db = LS.get(KEY.demodb);
  if (!db || db.v !== 6) db = seed();
  const save = () => { if (!LS.set(KEY.demodb, db)) toast('Bộ nhớ demo trên máy đã đầy — hãy tạo lại dữ liệu demo', 'err'); };
  save();
  const clone = x => JSON.parse(JSON.stringify(x));
  const delay = v => new Promise(r => setTimeout(() => r(v), 100));
  // Mô phỏng transaction: lỗi giữa chừng thì khôi phục dữ liệu
  // Nhật ký hoạt động: so sánh dữ liệu trước / sau mỗi thao tác (giống trigger audit trên Supabase)
  const AUD = { sites: 'sites', profiles: 'profiles', workCats: 'work_categories', groups: 'material_groups', subgroups: 'material_subgroups', materials: 'materials',
                stock: 'stock', assets: 'assets', prs: 'purchase_requests', items: 'pr_items', deliveries: 'pr_deliveries', atts: 'pr_attachments',
                proposals: 'purchase_proposals', lines: 'proposal_lines' };
  const audRef = r => r.pr_no || r.pp_no || r.asset_code || r.code || r.email || r.file_name || r.title || r.name ||
                      (r.batch_no != null ? 'Đợt ' + r.batch_no : r.line_no != null ? 'Dòng ' + r.line_no : null);
  const audPush = (action, tbl, r, changes) => {
    db.audit = db.audit || []; db.auditSeq = (db.auditSeq || 0) + 1;
    db.audit.push({ id: db.auditSeq, at: now(), actor: (me() || {}).id || null, action, tbl, row_id: r ? String(r.id ?? r.code) : null, ref: r ? audRef(r) : null,
                    parent: r ? (r.pr_id || r.item_id || r.proposal_id || r.material_id || null) : null, changes });
    if (db.audit.length > 3000) db.audit.splice(0, db.audit.length - 3000);
  };
  function audit(before) {
    const key = r => r.id ?? r.code;
    for (const [k, tbl] of Object.entries(AUD)) {
      const old = new Map((before[k] || []).map(r => [key(r), r])), seen = new Set();
      for (const r of db[k] || []) {
        const id = key(r); seen.add(id); const o = old.get(id);
        if (!o) { const { updated_at, ...rest } = r; audPush('insert', tbl, r, rest); continue; }
        const diff = {};
        for (const f of new Set([...Object.keys(o), ...Object.keys(r)]))
          if (f !== 'updated_at' && f !== 'seq' && JSON.stringify(o[f] ?? null) !== JSON.stringify(r[f] ?? null)) diff[f] = [o[f] ?? null, r[f] ?? null];
        if (Object.keys(diff).length) audPush('update', tbl, r, diff);
      }
      for (const [id, o] of old) if (!seen.has(id)) { const { updated_at, ...rest } = o; audPush('delete', tbl, o, rest); }
    }
  }
  const tx = fn => { const snap = JSON.stringify(db); try { const r = fn(); audit(JSON.parse(snap)); save(); return delay(r); } catch (e) { db = JSON.parse(snap); return Promise.reject(e); } };

  /* ---------- API (giống backend Supabase) ---------- */
  return {
    demo: true,
    async session() { const u = me(); return u ? { id: u.id, email: u.email } : null; },
    async signIn(email) {
      const p = db.profiles.find(x => x.email.toLowerCase() === String(email).trim().toLowerCase());
      if (!p) fail('Tài khoản demo: site@demo.vn, vattu@demo.vn, thumua@demo.vn hoặc admin@demo.vn (mật khẩu bất kỳ)');
      if (!p.active) fail('Tài khoản đã bị khoá');
      LS.set(KEY.demouser, p.id); audPush('login', null, null, null); db.audit[db.audit.length - 1].ref = p.email; save();
      return { id: p.id, email: p.email };
    },
    async signOut() { LS.del(KEY.demouser); },
    async changePassword(pw) { if (String(pw).length < 8) fail('Mật khẩu tối thiểu 8 ký tự'); return delay(null); },
    async pull() {
      return delay(clone({ sites: db.sites, groups: db.groups, subgroups: db.subgroups, workCats: db.workCats, materials: db.materials, profiles: db.profiles, stock: db.stock, assets: db.assets,
        proposals: db.proposals, lines: db.lines, links: db.links, prs: db.prs, items: db.items, atts: db.atts, deliveries: db.deliveries, changedItems: null, full: true }));
    },
    async assetHistory(id) { return delay(clone(db.assetHistory.filter(h => h.asset_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at)))); },
    async auditLog(f) {
      if ((me() || {}).role !== 'admin') fail('Chỉ quản trị mới xem được nhật ký');
      const q = (f.q || '').toLowerCase();
      const rows = (db.audit || []).filter(r => (!f.action || r.action === f.action) && (!f.tbls || f.tbls.includes(r.tbl)) && (!f.actor || r.actor === f.actor)
        && (!f.from || r.at >= f.from) && (!f.to || r.at <= f.to) && (!f.before || r.id < f.before) && (!q || String(r.ref || '').toLowerCase().includes(q)));
      return delay(clone(rows.sort((a, b) => b.id - a.id).slice(0, f.limit || 200)));
    },
    async uploadImage(blob) {
      const u = me() || fail('Bạn chưa đăng nhập');
      const path = `${u.id}/${uid()}.jpg`; db.blobs[path] = await blobToDataURL(await compressImage(blob, 800, 0.6)); save(); return path;
    },
    async imageUrls(paths) { return Object.fromEntries(paths.filter(p => db.blobs[p]).map(p => [p, db.blobs[p]])); },

    createPR: p => tx(() => {
      const u = req(['site', 'manager', 'admin']);
      const site = db.sites.find(s => s.code.toUpperCase() === String(p.site_code || '').trim().toUpperCase() && s.active) || fail(`Không tìm thấy dự án / công trường "${p.site_code}"`);
      const wc = db.workCats.find(w => w.active && w.code === String(p.category || '').trim().toUpperCase()); const cat = wc ? wc.code : fail('Chọn hạng mục thi công cho PR');
      if (!String(p.delivery_place || '').trim()) fail('Nhập nơi nhận hàng');
      if (!String(p.receiver_name || '').trim() || !String(p.receiver_phone || '').trim()) fail('Nhập tên và số điện thoại người nhận hàng');
      if (!p.need_date) fail('Thiếu ngày cần hàng');
      if (p.need_date < todayISO()) fail(`Ngày cần hàng ${fmtD(p.need_date)} đã qua`);
      const base = nextPrBase(site.id, cat); const no = base + '.R1';
      const pr = { id: uid(), pr_no: no, base_no: base, revision: 1, category: cat, title: String(p.title || '').trim().slice(0, 200) || no, site_id: site.id, requested_by: u.id,
                   need_date: p.need_date, delivery_place: p.delivery_place.trim(), receiver_name: p.receiver_name.trim(), receiver_phone: p.receiver_phone.trim(), note: p.note || null, status: 'cho_duyet', source: 'html', approved_by: null, approved_at: null,
                   reject_reason: null, created_at: now(), updated_at: now() };
      db.prs.push(pr);
      const out = insertItems(u, pr, p.items, 'html');
      attachFiles(u, pr, p.attachments);
      log(pr.id, null, u.id, 'tao_pr', null, 'html');
      return { id: pr.id, pr_no: no, title: pr.title, site: site.code, need_date: pr.need_date, status: pr.status, items: out, images: (p.attachments || []).length };
    }),
    recallPR: (prNo, reason) => tx(() => { const u = me() || fail('Bạn chưa đăng nhập'); recall(u, findPR(prNo), reason); return null; }),
    updatePR: (prNo, p) => tx(() => {
      const u = me() || fail('Bạn chưa đăng nhập'); const pr = findPR(prNo);
      if (!(pr.requested_by === u.id || ['manager', 'admin'].includes(u.role))) fail('Chỉ người đặt hàng hoặc quản lý mới sửa được PR');
      if (['cho_duyet', 'tu_choi'].includes(pr.status)) recall(u, pr, 'sửa PR');
      else if (pr.status !== 'thu_hoi') fail('Hãy thu hồi PR trước khi sửa');
      if (!String(p.delivery_place || '').trim()) fail('Nhập nơi nhận hàng');
      if (!String(p.receiver_name || '').trim() || !String(p.receiver_phone || '').trim()) fail('Nhập tên và số điện thoại người nhận hàng');
      if (!p.need_date) fail('Thiếu ngày cần hàng');
      if (p.need_date < todayISO()) fail(`Ngày cần hàng ${fmtD(p.need_date)} đã qua`);
      const oldNo = pr.pr_no;
      db.items = db.items.filter(i => i.pr_id !== pr.id);
      const out = insertItems(u, pr, p.items, 'html');
      const base = pr.base_no || pr.pr_no.replace(/\.R\d+$/, ''); const rev = (pr.revision || 1) + 1; const no = `${base}.R${rev}`;
      Object.assign(pr, { pr_no: no, base_no: base, revision: rev, need_date: p.need_date, title: String(p.title || '').trim().slice(0, 200) || no, note: p.note || null,
                          delivery_place: p.delivery_place.trim(), receiver_name: p.receiver_name.trim(), receiver_phone: p.receiver_phone.trim(), status: 'cho_duyet', reject_reason: null, updated_at: now() });
      attachFiles(u, pr, p.attachments);
      log(pr.id, null, u.id, 'sua_pr', oldNo, no);
      return { id: pr.id, pr_no: no, title: pr.title, site: db.sites.find(x => x.id === pr.site_id).code, need_date: pr.need_date, status: pr.status, items: out, images: (p.attachments || []).length };
    }),
    upsertWorkCategory: w => tx(() => {
      req(['manager', 'admin']);
      const code = String(w.code || '').replace(/\s/g, '').toUpperCase();
      if (!/^[A-Z0-9]{1,6}$/.test(code)) fail('Mã hạng mục gồm 1–6 chữ in hoa hoặc số, vd: MEP');
      if (!String(w.name || '').trim()) fail('Nhập tên hạng mục');
      const x = db.workCats.find(y => y.code === code); const vals = { code, name: w.name.trim(), sort: Number(w.sort ?? 100), active: w.active !== false };
      if (x) Object.assign(x, vals); else db.workCats.push(vals);
      return null;
    }),
    deleteWorkCategory: code => tx(() => {
      req(['manager', 'admin']);
      const i = db.workCats.findIndex(w => w.code === code); if (i < 0) fail(`Không tìm thấy hạng mục ${code}`);
      const n = db.prs.filter(p => p.category === code).length;
      if (n) fail(`Hạng mục ${code} đã dùng trong ${n} PR — không xoá được. Hãy chuyển sang "Ẩn khỏi danh sách đặt hàng".`);
      db.workCats.splice(i, 1); return null;
    }),
    deleteSite: id => tx(() => {
      req(['manager', 'admin']);
      const i = db.sites.findIndex(s => s.id === id); if (i < 0) fail('Không tìm thấy dự án');
      const code = db.sites[i].code, n = db.prs.filter(p => p.site_id === id).length;
      if (n) fail(`Dự án ${code} đã có ${n} PR — không xoá được. Hãy chuyển trạng thái sang "Ngừng" để ẩn.`);
      if (db.items.some(it => (it.alloc || []).some(a => a.site_id === id))) fail(`Dự án ${code} đang được xưởng chia hàng trong PR — không xoá được. Hãy chuyển sang "Ngừng".`);
      if (db.stock.some(s => s.site_id === id)) fail(`Dự án ${code} còn dòng tồn kho — chuyển hết tồn kho đi trước, hoặc chuyển sang "Ngừng".`);
      if (db.assets.some(a => a.site_id === id)) fail(`Dự án ${code} còn tài sản / thiết bị — chuyển tài sản đi trước, hoặc chuyển sang "Ngừng".`);
      for (const p of db.profiles) if (p.site_id === id) p.site_id = null;
      db.sites.splice(i, 1); return code;
    }),
    upsertSite: st => tx(() => {
      req(['manager', 'admin']);
      const code = String(st.code || '').replace(/\s/g, '').toUpperCase();
      if (!/^[A-Z0-9-]{2,15}$/.test(code)) fail('Mã dự án gồm 2–15 ký tự chữ in hoa / số / gạch ngang, vd: SSD');
      if (!String(st.name || '').trim()) fail('Nhập tên dự án');
      if (db.sites.some(x => x.code.toUpperCase() === code && x.id !== st.id)) fail(`Mã dự án ${code} đã tồn tại`);
      let x = st.id && db.sites.find(y => y.id === st.id);
      if (st.id && !x) fail('Không tìm thấy dự án');
      if (x && x.code !== code && db.prs.some(p => p.site_id === x.id)) fail('Dự án đã có PR, không đổi được mã (mã nằm trong số PR)');
      if (x && !!x.is_workshop !== !!st.is_workshop) {
        if (!st.is_workshop && db.items.some(i => i.alloc && db.prs.some(p => p.id === i.pr_id && p.site_id === x.id && p.status !== 'huy'))) fail('Xưởng đã có PR chia theo dự án — không bỏ đánh dấu xưởng được');
        if (st.is_workshop && db.items.some(i => (i.alloc || []).some(a => a.site_id === x.id) && db.prs.some(p => p.id === i.pr_id && p.status !== 'huy'))) fail('Dự án này đang được xưởng đặt hàng cho — không chuyển thành xưởng được');
      }
      const vals = { code, name: st.name.trim(), address: (st.address || '').trim() || null, manager: (st.manager || '').trim() || null, active: st.active !== false, is_workshop: !!st.is_workshop };
      if (x) Object.assign(x, vals); else { x = { id: uid(), ...vals }; db.sites.push(x); }
      return x.id;
    }),
    addAttachments: (prNo, files) => tx(() => {
      const u = me() || fail('Bạn chưa đăng nhập'); const pr = findPR(prNo);
      if (pr.requested_by !== u.id && u.site_id !== pr.site_id && !['manager', 'procurement', 'admin'].includes(u.role)) fail('Bạn không có quyền thực hiện thao tác này');
      if (db.atts.filter(a => a.pr_id === pr.id).length + files.length > 40) fail('Tối đa 40 ảnh cho một PR');
      for (const f of files) {
        let item = null, del = null;
        if (f.delivery_id) { del = db.deliveries.find(d => d.id === f.delivery_id); item = del ? db.items.find(i => i.id === del.item_id) : null; }
        else if (f.line) item = db.items.find(i => i.pr_id === pr.id && i.line_no === f.line);
        db.atts.push({ id: uid(), pr_id: pr.id, item_id: item ? item.id : null, delivery_id: del ? del.id : null, path: f.path, file_name: f.name, uploaded_by: u.id, created_at: now() });
      }
      return files.length;
    }),
    approvePR: (p, ok, reason) => tx(() => {
      const u = req(['manager', 'admin']); const pr = findPR(p);
      if (pr.status !== 'cho_duyet') fail('Phiếu không ở trạng thái chờ duyệt');
      if (!ok && !String(reason || '').trim()) fail('Cần ghi lý do từ chối');
      log(pr.id, null, u.id, 'status', pr.status, ok ? 'da_duyet' : 'tu_choi');
      Object.assign(pr, { status: ok ? 'da_duyet' : 'tu_choi', approved_by: u.id, approved_at: now(), reject_reason: ok ? null : reason.trim(), updated_at: now() });
      if (ok) planDeliveries(pr);
      return { pr_no: pr.pr_no, status: pr.status };
    }),
    cancelPR: (p, reason) => tx(() => {
      const u = me() || fail('Bạn chưa đăng nhập'); const pr = findPR(p);
      if (!((pr.requested_by === u.id && ['cho_duyet', 'thu_hoi', 'tu_choi'].includes(pr.status)) || (u.role === 'manager' && ['cho_duyet', 'thu_hoi', 'tu_choi', 'da_duyet', 'da_dat'].includes(pr.status)) || (u.role === 'admin' && !['da_ve', 'huy'].includes(pr.status)))) fail('Không thể huỷ phiếu ở trạng thái hiện tại');
      for (const it of db.items.filter(i => i.pr_id === pr.id)) {
        const ds = db.deliveries.filter(d => d.item_id === it.id);
        for (const d of ds.filter(d => OPEN_ST.includes(d.status))) { d.status = 'huy'; db.links = db.links.filter(l => l.delivery_id !== d.id); }
        if (ds.length) recalcItem(it); else it.status = 'huy';
      }
      log(pr.id, null, u.id, 'status', pr.status, 'huy');
      pr.status = 'huy'; pr.reject_reason = (reason || '').trim() || null; pr.updated_at = now();
      return null;
    }),
    saveDeliveries: (itemId, batches) => tx(() => {
      const u = req(['procurement', 'admin']);
      const it = db.items.find(i => i.id === itemId) || fail('Không tìm thấy dòng hàng');
      const pr = db.prs.find(p => p.id === it.pr_id);
      if (['cho_duyet', 'tu_choi', 'huy'].includes(pr.status)) fail('Phiếu chưa được duyệt hoặc đã đóng');
      if (!batches.length) fail('Cần ít nhất một đợt giao');
      const kind = kindOf(it.material_id);
      const keep = new Set(batches.map(b => b.id).filter(Boolean));
      const cur = db.deliveries.filter(d => d.item_id === itemId);
      if (cur.some(d => ['da_ve', 'co_van_de', 'huy'].includes(d.status) && !keep.has(d.id))) fail('Không xoá được đợt đã nhận, có vấn đề hoặc đã huỷ');
      let sum = 0;
      for (const b of batches) {
        const d = b.id && cur.find(x => x.id === b.id);
        if (d && ['da_ve', 'co_van_de', 'huy'].includes(d.status)) { if (d.status !== 'huy') sum += Number(d.qty); continue; }
        const q = Number(b.qty); if (!(q > 0)) fail('Số lượng mỗi đợt phải lớn hơn 0');
        if (b.status && !OPEN_ST.includes(b.status)) fail('Trạng thái "Đã nhận" do người đặt hàng xác nhận ở nút Nhận hàng');
        sum += q;
      }
      if (round6(sum) !== round6(Number(it.qty))) fail(`Tổng các đợt (${fmtN(sum)}) phải bằng số lượng đặt (${fmtN(it.qty)} ${it.unit})`);
      const removed = cur.filter(d => !keep.has(d.id));
      db.deliveries = db.deliveries.filter(d => !removed.includes(d)); db.links = db.links.filter(l => !removed.some(d => d.id === l.delivery_id));
      batches.forEach((b, k) => {
        const no = k + 1; const d = b.id && db.deliveries.find(x => x.id === b.id && x.item_id === itemId);
        if (d && ['da_ve', 'co_van_de', 'huy'].includes(d.status)) { d.batch_no = no; return; }
        const src = b.source || 'mua'; const qty = Number(b.qty); let stockId = null, assetId = null;
        if (src === 'kho') {
          if (kind === 'tung_cai') {
            assetId = b.asset_id || fail(`Đợt ${no}: chọn tài sản xuất từ kho tổng`);
            if (qty !== 1) fail(`Đợt ${no}: tài sản xuất từ kho tính từng chiếc (SL = 1)`);
            const a = db.assets.find(x => x.id === assetId);
            if (!a || a.material_id !== it.material_id || a.site_id || !a.active) fail(`Đợt ${no}: tài sản không ở kho tổng hoặc không đúng loại`);
            if (assetBusy(assetId, d && d.id)) fail(`Đợt ${no}: tài sản ${a.asset_code} đang giữ cho PR khác`);
          } else {
            stockId = b.stock_id || fail(`Đợt ${no}: chọn dòng tồn kho tổng để xuất`);
            const s = db.stock.find(x => x.id === stockId);
            if (!s || s.material_id !== it.material_id || s.site_id) fail(`Đợt ${no}: dòng tồn phải ở kho tổng và đúng vật tư`);
            const free = stockFree(stockId, d && d.id);
            if (free < qty) fail(`Đợt ${no}: kho tổng chỉ còn trống ${fmtN(free)} ${it.unit}`);
          }
        }
        const vals = { batch_no: no, qty, source: src, stock_id: stockId, asset_id: assetId, status: b.status || 'cho_xu_ly', eta: b.eta || null,
                       supplier: (b.supplier || '').trim() || null, po_no: (b.po_no || '').trim() || null, updated_at: now() };
        if (d) { Object.assign(d, vals); if (src !== 'mua') db.links = db.links.filter(l => l.delivery_id !== d.id); }
        else db.deliveries.push(newDel(itemId, no, qty, vals));
      });
      log(pr.id, itemId, u.id, 'ke_hoach_giao', null, JSON.stringify(batches));
      recalcItem(it); recalcPR(pr, u);
      return null;
    }),
    updateItems: (p, line, f) => tx(() => {
      const u = req(['procurement', 'admin']); const pr = findPR(p);
      if (['cho_duyet', 'tu_choi', 'huy'].includes(pr.status)) fail('Phiếu chưa được duyệt hoặc đã đóng');
      if (f.status && !OPEN_ST.includes(f.status)) fail('Trạng thái "Đã nhận" do người đặt hàng xác nhận');
      planDeliveries(pr);
      const its = db.items.filter(i => i.pr_id === pr.id && (line == null || i.line_no === line));
      if (!its.length) fail('Phiếu không có dòng ' + line);
      for (const i of its) {
        for (const d of db.deliveries.filter(d => d.item_id === i.id && OPEN_ST.includes(d.status))) {
          if (f.eta) d.eta = f.eta; if (f.status) d.status = f.status;
          if ((f.supplier || '').trim()) d.supplier = f.supplier.trim(); if ((f.po || '').trim()) d.po_no = f.po.trim();
        }
        recalcItem(i);
      }
      recalcPR(pr, u); return null;
    }),
    confirmReceipt: (id, f) => tx(() => {
      const u = me() || fail('Bạn chưa đăng nhập');
      const d = db.deliveries.find(x => x.id === id) || fail('Không tìm thấy đợt giao');
      const it = db.items.find(i => i.id === d.item_id); const pr = db.prs.find(p => p.id === it.pr_id);
      if (!(pr.requested_by === u.id || ['manager', 'procurement', 'admin'].includes(u.role) || (u.site_id && u.site_id === pr.site_id)))
        fail('Chỉ người đặt hàng, người cùng công trường hoặc phòng vật tư mới được xác nhận nhận hàng');
      if (['cho_duyet', 'tu_choi', 'huy'].includes(pr.status)) fail('Phiếu chưa được duyệt hoặc đã huỷ');
      if (!OPEN_ST.includes(d.status)) fail('Đợt này đã được xác nhận hoặc đã huỷ');
      const qty = Number(f.qty); if (!(qty >= 0) || f.qty === '' || f.qty == null) fail('Số lượng thực nhận không hợp lệ');
      if (f.date && f.date > todayISO()) fail('Ngày nhận không được sau hôm nay');
      const issues = [...new Set(f.issues || [])];
      if (qty < Number(d.qty) && !issues.includes('thieu')) issues.push('thieu');
      if (qty > Number(d.qty) && !issues.includes('thua')) issues.push('thua');
      if (issues.length && !String(f.note || '').trim()) fail('Vui lòng ghi chú vấn đề về số lượng / chất lượng');
      Object.assign(d, { status: issues.length ? 'co_van_de' : 'da_ve', qty_actual: qty, receipt_issues: issues, receipt_note: (f.note || '').trim() || null,
                         serials: (f.serials || '').trim() || null, received_date: f.date || todayISO(), confirmed_by: u.id, confirmed_at: now(), updated_at: now() });
      if (!issues.some(x => ['sai_hang', 'kem_chat_luong'].includes(x))) receiveToSite(u, d);
      log(pr.id, it.id, u.id, 'nhan_hang_dot_' + d.batch_no, null, `${qty} ${it.unit} · ${issues.join(',') || 'OK'}`);
      recalcItem(it); recalcPR(pr, u); return null;
    }),
    resolveIssue: (id, action, note, eta) => tx(() => {
      const u = req(['procurement', 'admin']);
      const d = db.deliveries.find(x => x.id === id) || fail('Không tìm thấy đợt giao');
      if (d.status !== 'co_van_de') fail('Đợt này không ở trạng thái có vấn đề');
      if (!String(note || '').trim()) fail('Ghi chú cách xử lý');
      const it = db.items.find(i => i.id === d.item_id); const pr = db.prs.find(p => p.id === it.pr_id);
      const link = db.links.find(l => l.delivery_id === d.id);
      if (action === 'giao_bu' && !(Number(d.qty_actual) > 0 && Number(d.qty_actual) < Number(d.qty))) fail('Giao bù chỉ dùng khi đã nhận một phần (thực nhận nhỏ hơn số lượng đợt)');
      if (action === 'giao_lai' && d.stock_moved) fail('Phần hàng đã nhận đã được ghi vào kho — hãy dùng "Giao bù" hoặc "Chấp nhận"');
      const no = Math.max(...db.deliveries.filter(x => x.item_id === d.item_id).map(x => x.batch_no)) + 1;
      const origQty = Number(d.qty);
      Object.assign(d, { resolution: action, resolution_note: note.trim(), resolved_by: u.id, resolved_at: now(), status: action === 'giao_lai' ? 'huy' : 'da_ve',
                         qty: action === 'giao_bu' ? Number(d.qty_actual) : d.qty });
      if (action !== 'giao_lai') receiveToSite(u, d);
      if (action !== 'chap_nhan') {
        const nd = newDel(d.item_id, no, round6(action === 'giao_bu' ? origQty - Number(d.qty_actual) : origQty), { source: d.source, stock_id: d.stock_id, asset_id: d.asset_id,
          supplier: d.supplier, po_no: d.po_no, eta: eta || null, status: d.source === 'mua' && link ? 'da_dat' : 'cho_xu_ly',
          note: (action === 'giao_bu' ? 'Giao bù cho đợt ' : 'Giao lại thay đợt ') + d.batch_no });
        db.deliveries.push(nd);
        if (link) db.links.push({ delivery_id: nd.id, line_id: link.line_id });
      }
      log(pr.id, it.id, u.id, 'xu_ly_dot_' + d.batch_no, null, action + ': ' + note.trim());
      recalcItem(it); recalcPR(pr, u); return null;
    }),

    setStock: (rows, mode, reason) => tx(() => {
      const u = req(['procurement', 'admin']);
      if (!['set', 'add'].includes(mode)) fail('Kiểu nhập tồn không hợp lệ');
      if (!rows.length) fail('Không có dòng nào để nhập');
      let okc = 0; const created = [], errors = [], ids = [];
      rows.forEach((r, k) => {
        const snap = JSON.stringify(db);
        try {
          const qty = parseNum(r.qty); const min = r.min_qty === '' || r.min_qty == null ? null : parseNum(r.min_qty);
          if (qty == null) fail('thiếu số lượng'); if (Number.isNaN(qty) || Number.isNaN(min)) fail('số lượng không hợp lệ');
          if (mode === 'set' && qty < 0) fail('số tồn không được âm');
          const site = siteOf(r.site); const cond = parseCond(r.condition);
          let m = null, wasCreated = false;
          if (r.material_id) m = mat(r.material_id) || fail('vật tư không tồn tại');
          else if ((r.code || '').trim()) { m = db.materials.find(x => x.code.toUpperCase() === r.code.trim().toUpperCase()); if (!m && !(r.name || '').trim()) fail('không có mã ' + r.code); }
          if (!m) { const x = findOrCreate(u, r, 'import'); wasCreated = x.created; m = mat(x.id); }
          if (kindOf(m.id) === 'tung_cai') fail(`${m.code} thuộc nhóm quản lý từng chiếc — khai báo ở mục Tài sản / thiết bị`);
          ids.push(stockApply(u, m.id, site, cond, mode, qty, r.location, min, (r.note || '').trim() || (reason || '').trim() || mode));
          okc++; if (wasCreated) created.push(m.code);
        } catch (e) { db = JSON.parse(snap); errors.push({ row: k + 1, error: e.message }); }
      });
      return { ok: okc, created, errors, ids };
    }),
    updateStock: (id, f) => tx(() => {
      const u = req(['procurement', 'admin']);
      const s = db.stock.find(x => x.id === id) || fail('Không tìm thấy dòng tồn kho');
      if ('qty' in f) {
        const q = Number(f.qty); if (!(q >= 0)) fail('Số lượng tồn không hợp lệ');
        const reserved = round6(Number(s.qty) - stockFree(s.id));
        if (q < reserved) fail(`Đang giữ ${fmtN(reserved)} cho các PR, không thể đặt tồn thấp hơn`);
        stockApply(u, s.material_id, s.site_id, s.condition, 'set', q, null, null, f.note || 'Sửa trực tiếp');
      }
      if ('min_qty' in f) s.min_qty = f.min_qty === '' || f.min_qty == null ? null : Number(f.min_qty);
      if ('location_detail' in f) s.location_detail = (f.location_detail || '').trim() || null;
      if ('image_path' in f) s.image_path = f.image_path || null;
      if ('note' in f) s.note = (f.note || '').trim() || null;
      s.updated_by = u.id; s.updated_at = now(); return null;
    }),
    moveStock: (id, f) => tx(() => {
      const u = req(['procurement', 'admin']);
      const s = db.stock.find(x => x.id === id) || fail('Không tìm thấy dòng tồn kho');
      const qty = Number(f.qty); if (!(qty > 0)) fail('Số lượng điều chuyển phải lớn hơn 0');
      const free = stockFree(s.id); if (qty > free) fail(`Chỉ điều chuyển được tối đa ${fmtN(free)} (phần còn lại đang giữ cho PR)`);
      const site = siteOf(f.site); const cond = String(f.condition || '').trim() ? parseCond(f.condition) : s.condition;
      if ((site || null) === (s.site_id || null) && cond === s.condition) fail('Vị trí và tình trạng mới trùng với hiện tại');
      stockApply(u, s.material_id, s.site_id, s.condition, 'add', -qty, null, null, 'Điều chuyển đi: ' + (f.note || ''));
      const to = stockApply(u, s.material_id, site, cond, 'add', qty, f.location, null, 'Điều chuyển đến: ' + (f.note || ''));
      const t = db.stock.find(x => x.id === to); if (!t.image_path) t.image_path = s.image_path;
      return to;
    }),
    saveAsset: p => tx(() => {
      const u = req(['procurement', 'admin']);
      if (p.id) {
        const a = db.assets.find(x => x.id === p.id) || fail('Không tìm thấy tài sản');
        if ('serial' in p) { const sr = (p.serial || '').trim() || null; if (sr && db.assets.some(x => x.id !== a.id && x.material_id === a.material_id && x.serial === sr)) fail(`Biển số / seri "${sr}" đã tồn tại`); a.serial = sr; }
        for (const k of ['location_detail', 'note']) if (k in p) a[k] = (p[k] || '').trim() || null;
        if ('image_path' in p) a.image_path = p.image_path || null;
        if ('active' in p) a.active = !!p.active;
        a.updated_at = now(); assetLog(a.id, 'cap_nhat', a.site_id, a.site_id, a.condition, a.condition, null, 'active' in p && !p.active ? 'Thanh lý' : 'Cập nhật thông tin', u.id);
        return { id: a.id, asset_code: a.asset_code, created: false };
      }
      let mid = p.material_id || null, matCreated = false;
      if (!mid && (p.code || '').trim()) { const m = db.materials.find(x => x.code.toUpperCase() === p.code.trim().toUpperCase()); if (m) mid = m.id; else if (!(p.name || '').trim()) fail('Không có mã ' + p.code); }
      if (!mid) { const x = findOrCreate(u, { ...p, unit: p.unit || 'chiếc', group: p.group || 'MM' }, 'import'); mid = x.id; matCreated = x.created; }
      if (kindOf(mid) !== 'tung_cai') fail('Vật tư này thuộc nhóm quản lý theo số lượng — khai báo ở mục Vật tư');
      const a = createAsset(u, mid, p.serial, siteOf(p.site), parseCond(p.condition), p.location_detail, p.note);
      if (p.image_path) a.image_path = p.image_path;
      return { id: a.id, asset_code: a.asset_code, created: true, material_created: matCreated };
    }),
    moveAsset: (id, f) => tx(() => {
      const u = req(['procurement', 'admin']);
      const a = db.assets.find(x => x.id === id) || fail('Không tìm thấy tài sản');
      if (assetBusy(a.id)) fail('Tài sản đang được giữ / đang giao cho một PR, không điều chuyển được');
      const site = f.site == null ? a.site_id : siteOf(f.site); const cond = String(f.condition || '').trim() ? parseCond(f.condition) : a.condition;
      const moved = (site || null) !== (a.site_id || null);
      assetLog(a.id, moved ? 'dieu_chuyen' : 'tinh_trang', a.site_id, site, a.condition, cond, null, f.note, u.id);
      a.location_detail = moved ? ((f.location || '').trim() || null) : ((f.location || '').trim() || a.location_detail);
      a.site_id = site || null; a.condition = cond; a.updated_at = now();
      return null;
    }),
    upsertGroup: g => tx(() => {
      req(['procurement', 'admin']);
      const code = String(g.code || '').trim().toUpperCase();
      if (!/^[A-Z]{1,4}$/.test(code)) fail('Mã nhóm gồm 1–4 chữ cái in hoa, vd: KC');
      if (!String(g.name || '').trim()) fail('Nhập tên nhóm');
      const cur = grp(code);
      if (cur && cur.kind !== g.kind) {
        const mids = new Set(db.materials.filter(m => m.group_code === code).map(m => m.id));
        if (db.stock.some(s => mids.has(s.material_id)) || db.assets.some(a => mids.has(a.material_id))) fail('Nhóm đã có tồn kho, không đổi được kiểu quản lý');
      }
      const kw = [...new Set(String(g.keywords || '').split(',').map(k => norm(k)).filter(Boolean))];
      if (cur) Object.assign(cur, { name: g.name.trim(), kind: g.kind || 'so_luong', track_site: !!g.track_site, keywords: kw, priority: Number(g.priority ?? cur.priority) });
      else db.groups.push({ code, name: g.name.trim(), kind: g.kind || 'so_luong', track_site: !!g.track_site, keywords: kw, priority: Number(g.priority ?? 100), seq: 0, active: true });
      return null;
    }),
    upsertSubgroup: (group, name) => tx(() => {
      req(['procurement', 'admin']);
      if (!String(name || '').trim()) fail('Nhập tên nhóm con');
      let s = db.subgroups.find(x => x.group_code === group && x.name === name.trim());
      if (!s) { s = { id: uid(), group_code: group, name: name.trim() }; db.subgroups.push(s); }
      return s.id;
    }),

    createProposal: (title, note, batchIds, manual) => tx(() => {
      const u = req(['procurement', 'admin']);
      if (!String(title || '').trim()) fail('Nhập tiêu đề đề xuất');
      if (!(batchIds || []).length && !(manual || []).length) fail('Chưa chọn vật tư nào');
      const bad = (batchIds || []).filter(id => {
        const d = db.deliveries.find(x => x.id === id); if (!d) return true;
        const it = db.items.find(i => i.id === d.item_id); const pr = db.prs.find(p => p.id === it.pr_id);
        return d.source !== 'mua' || !OPEN_ST.includes(d.status) || !APPROVED_PR.includes(pr.status) || db.links.some(l => l.delivery_id === id);
      });
      if (bad.length) fail(`${bad.length} đợt không hợp lệ hoặc đã nằm trong đề xuất khác — bấm Update rồi thử lại`);
      const pp = { id: uid(), pp_no: nextDoc('DX'), title: title.trim(), status: 'da_gui', note: (note || '').trim() || null, purchasing_note: null, created_by: u.id, handled_by: null, created_at: now(), updated_at: now() };
      db.proposals.push(pp);
      const groups = new Map();
      for (const id of batchIds || []) {
        const d = db.deliveries.find(x => x.id === id); const it = db.items.find(i => i.id === d.item_id); const pr = db.prs.find(p => p.id === it.pr_id);
        const k = it.material_id + '|' + it.unit;
        if (!groups.has(k)) groups.set(k, { material_id: it.material_id, unit: it.unit, qty: 0, need: null, ids: [] });
        const g = groups.get(k); g.qty = round6(g.qty + Number(d.qty)); g.ids.push(id); if (pr.need_date && (!g.need || pr.need_date < g.need)) g.need = pr.need_date;
      }
      let no = 0;
      for (const g of [...groups.values()].sort((a, b) => String(a.need || '9').localeCompare(String(b.need || '9')))) {
        const ln = { id: uid(), proposal_id: pp.id, line_no: ++no, material_id: g.material_id, qty: g.qty, unit: g.unit, need_date: g.need, supplier: null, unit_price: null, eta: null, po_no: null, note: null, updated_at: now() };
        db.lines.push(ln); for (const id of g.ids) db.links.push({ delivery_id: id, line_id: ln.id });
      }
      for (const m of manual || []) {
        const mm = (m.material_id ? mat(m.material_id) : db.materials.find(x => x.code.toUpperCase() === String(m.code || '').trim().toUpperCase())) || fail(`Vật tư "${m.code || m.material_id}" không tồn tại`);
        const q = Number(m.qty); if (!(q > 0)) fail('Số lượng mua phải lớn hơn 0');
        db.lines.push({ id: uid(), proposal_id: pp.id, line_no: ++no, material_id: mm.id, qty: q, unit: mm.unit, need_date: m.need_date || null, supplier: null, unit_price: null, eta: null, po_no: null, note: (m.note || '').trim() || 'Mua bổ sung kho tổng', updated_at: now() });
      }
      return { id: pp.id, pp_no: pp.pp_no, lines: no };
    }),
    updateProposal: (ppNo, status, note) => tx(() => {
      const u = req(['procurement', 'admin']);
      const pp = db.proposals.find(p => p.pp_no === String(ppNo).toUpperCase()) || fail('Không tìm thấy đề xuất ' + ppNo);
      if (!['da_gui', 'thu_mua_nhan', 'dang_mua', 'da_mua', 'huy'].includes(status)) fail('Trạng thái không hợp lệ');
            if (pp.status === 'huy') fail('Đề xuất đã huỷ');
      pp.status = status; if ((note || '').trim()) pp.purchasing_note = note.trim(); if (!pp.handled_by) pp.handled_by = u.id; pp.updated_at = now();
      const lineIds = new Set(db.lines.filter(l => l.proposal_id === pp.id).map(l => l.id));
      const dels = db.links.filter(l => lineIds.has(l.line_id)).map(l => db.deliveries.find(d => d.id === l.delivery_id)).filter(Boolean);
      if (status === 'huy') { const rm = new Set(dels.filter(d => ['cho_xu_ly', 'da_dat'].includes(d.status)).map(d => d.id)); db.links = db.links.filter(l => !rm.has(l.delivery_id)); }
      else if (['dang_mua', 'da_mua'].includes(status)) {
        for (const d of dels) if (d.status === 'cho_xu_ly') d.status = 'da_dat';
        const its = new Set(dels.map(d => d.item_id));
        for (const id of its) { const it = db.items.find(i => i.id === id); recalcItem(it); recalcPR(db.prs.find(p => p.id === it.pr_id), u); }
      }
      return null;
    }),
    updateProposalLine: (id, f) => tx(() => {
      req(['procurement', 'admin']);
      const ln = db.lines.find(l => l.id === id) || fail('Không tìm thấy dòng đề xuất');
      const pp = db.proposals.find(p => p.id === ln.proposal_id); if (pp.status === 'huy') fail('Đề xuất đã huỷ');
      if ('supplier' in f) ln.supplier = (f.supplier || '').trim() || null;
      if ('unit_price' in f) { const v = f.unit_price === '' || f.unit_price == null ? null : Number(f.unit_price); if (v != null && !(v >= 0)) fail('Đơn giá không hợp lệ'); ln.unit_price = v; }
      if ('eta' in f) ln.eta = f.eta || null;
      if ('po_no' in f) ln.po_no = (f.po_no || '').trim() || null;
      if ('note' in f) ln.note = (f.note || '').trim() || null;
      ln.updated_at = now();
      for (const l of db.links.filter(l => l.line_id === ln.id)) {
        const d = db.deliveries.find(x => x.id === l.delivery_id); if (!d || !OPEN_ST.includes(d.status)) continue;
        if (ln.eta) d.eta = ln.eta; if (ln.supplier) d.supplier = ln.supplier; d.po_no = ln.po_no || pp.pp_no;
        recalcItem(db.items.find(i => i.id === d.item_id));
      }
      return null;
    }),

    updateProfile: p => tx(() => {
      const u = me() || fail('Bạn chưa đăng nhập');
      let site = null;
      if ((p.site_code || '').trim()) site = db.sites.find(s => s.code.toUpperCase() === p.site_code.trim().toUpperCase()) || fail(`Không tìm thấy công trường "${p.site_code}"`);
      if ((p.full_name || '').trim()) u.full_name = p.full_name.trim();
      u.phone = (p.phone || '').trim() || null; if (site) u.site_id = site.id; return null;
    }),
    adminUsers: b => tx(() => {
      const u = req(['admin']);
      const ROLES = ['site', 'manager', 'procurement', 'admin'];
      if (b.action === 'create') {
        const email = String(b.email || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Email không hợp lệ');
        if (String(b.password || '').length < 8) fail('Mật khẩu tối thiểu 8 ký tự');
        if (!ROLES.includes(b.role || 'site')) fail('Quyền không hợp lệ');
        if (db.profiles.some(p => p.email === email)) fail('Email này đã có tài khoản');
        const p = { id: uid(), email, full_name: (b.full_name || '').trim() || email.split('@')[0], phone: (b.phone || '').trim() || null, role: b.role || 'site', site_id: b.site_id || null, active: true };
        db.profiles.push(p); return { id: p.id };
      }
      const p = db.profiles.find(x => x.id === b.id) || fail('Không tìm thấy tài khoản');
      if (b.action === 'update') {
        if (p.id === u.id && 'role' in b && b.role !== 'admin') fail('Không thể tự bỏ quyền quản trị của mình');
        if (p.id === u.id && b.active === false) fail('Không thể tự khoá tài khoản của mình');
        if ('role' in b && !ROLES.includes(b.role)) fail('Quyền không hợp lệ');
        for (const k of ['full_name', 'phone', 'role', 'site_id']) if (k in b) p[k] = String(b[k] || '').trim() || null;
        if ('active' in b) p.active = !!b.active;
        return { ok: true };
      }
      if (b.action === 'delete') {
        if (p.id === u.id) fail('Không thể tự xoá tài khoản của mình');
        const REFS = [['prs', 'requested_by', 'PR đã lập'], ['prs', 'approved_by', 'PR đã duyệt'], ['history', 'changed_by', 'lịch sử PR'], ['deliveries', 'confirmed_by', 'lần nhận hàng'],
          ['deliveries', 'resolved_by', 'xử lý giao hàng'], ['atts', 'uploaded_by', 'file đính kèm'], ['proposals', 'created_by', 'đề xuất mua'], ['proposals', 'handled_by', 'đề xuất mua'],
          ['stock', 'updated_by', 'dòng tồn kho'], ['stockLog', 'changed_by', 'lịch sử kho'], ['materials', 'created_by', 'vật tư đã tạo'], ['assets', 'created_by', 'tài sản'], ['assetHistory', 'changed_by', 'lịch sử tài sản']];
        const used = [...new Set(REFS.filter(([t, c]) => (db[t] || []).some(r => r[c] === p.id)).map(r => r[2]))];
        if (used.length) fail(`Tài khoản đã có dữ liệu (${used.join(', ')}) nên không xoá được — hãy bỏ dấu "Đang dùng" để khoá tài khoản.`);
        db.profiles.splice(db.profiles.indexOf(p), 1);
        for (const a of db.audit || []) if (a.actor === p.id) a.actor = null;
        return { ok: true };
      }
      if (b.action === 'reset_password') { if (String(b.password || '').length < 8) fail('Mật khẩu tối thiểu 8 ký tự'); return { ok: true }; }
      fail('Thao tác không hợp lệ');
    }),
    reset() { LS.del(KEY.demodb); seed(); save(); },
  };
}
