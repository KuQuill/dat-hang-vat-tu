// Nhật ký hoạt động (chỉ Quản trị): ai, lúc nào, thêm / sửa / xoá gì, đăng nhập, thao tác tài khoản
import { S, ctx, ACT, VIEWS, INPUTS, $, esc, fmtDT, toast, isAdmin, ROLE, PR_ST, IT_ST, PP_ST, COND, siteById, profName, downloadText, debounce } from './core.js';

const TBL = {
  purchase_requests: 'Phiếu đề nghị (PR)', pr_items: 'Dòng vật tư PR', pr_deliveries: 'Đợt giao hàng', pr_attachments: 'Ảnh / tệp đính kèm',
  stock: 'Tồn kho', assets: 'Tài sản', materials: 'Danh mục vật tư', material_groups: 'Nhóm vật tư', material_subgroups: 'Nhóm con vật tư',
  sites: 'Dự án / công trường', work_categories: 'Hạng mục thi công', profiles: 'Tài khoản', purchase_proposals: 'Đề xuất mua', proposal_lines: 'Dòng đề xuất mua',
};
// Nhóm lọc → danh sách bảng (login là thao tác, không có bảng)
const GROUPS = {
  '': ['Tất cả', null], login: ['Đăng nhập', null], pr: ['Đặt hàng / PR', ['purchase_requests', 'pr_items', 'pr_deliveries', 'pr_attachments']],
  kho: ['Kho & tài sản', ['stock', 'assets']], buy: ['Đề xuất mua', ['purchase_proposals', 'proposal_lines']],
  cat: ['Danh mục (vật tư, dự án, hạng mục)', ['materials', 'material_groups', 'material_subgroups', 'sites', 'work_categories']], user: ['Tài khoản', ['profiles']],
};
const ACTION = {
  insert: ['Thêm', 'b-green'], update: ['Sửa', 'b-blue'], delete: ['Xoá', 'b-red'], login: ['Đăng nhập', 'b-gray'],
  user_create: ['Tạo tài khoản', 'b-green'], user_update: ['Sửa tài khoản', 'b-blue'], user_reset_pw: ['Đặt lại mật khẩu', 'b-amber'],
};
const FIELD = {
  status: 'Trạng thái', qty: 'Số lượng', qty_actual: 'SL thực nhận', unit: 'ĐVT', need_date: 'Ngày cần', eta: 'Ngày dự kiến về', supplier: 'Nhà cung cấp',
  po_no: 'Số PO', note: 'Ghi chú', title: 'Diễn giải', site_id: 'Dự án', material_id: 'Vật tư', role: 'Quyền', active: 'Đang dùng', full_name: 'Họ tên',
  phone: 'SĐT', email: 'Email', name: 'Tên', code: 'Mã', address: 'Địa chỉ', manager: 'Chỉ huy trưởng', is_workshop: 'Là xưởng', condition: 'Tình trạng',
  location_detail: 'Vị trí', min_qty: 'Tồn tối thiểu', delivery_place: 'Nơi nhận', receiver_name: 'Người nhận', receiver_phone: 'SĐT người nhận',
  category: 'Hạng mục', alloc: 'Dùng cho dự án', revision: 'Lần sửa', reject_reason: 'Lý do', cancel_reason: 'Lý do huỷ', approved_by: 'Người duyệt',
  approved_at: 'Lúc duyệt', confirmed_by: 'Người xác nhận', confirmed_at: 'Lúc xác nhận', received_date: 'Ngày nhận', receipt_issues: 'Vấn đề khi nhận',
  receipt_note: 'Ghi chú nhận', resolution: 'Cách xử lý', resolution_note: 'Ghi chú xử lý', serial: 'Seri / biển số', serials: 'Seri', unit_price: 'Đơn giá',
  purchasing_note: 'Ghi chú thu mua', handled_by: 'Người xử lý', file_name: 'Tên tệp', batch_no: 'Đợt', line_no: 'Dòng', image_path: 'Ảnh',
};
const HIDE = new Set(['id', 'created_at', 'updated_at', 'updated_by', 'created_by', 'requested_by', 'uploaded_by', 'search', 'path', 'telegram_id', 'seq']);
const PAGE = 200;

const st = { rows: [], more: false, loading: false, err: '', f: { group: '', actor: '', from: '', to: '', q: '' }, open: new Set() };

VIEWS.log = {
  title: 'Nhật ký',
  show: () => isAdmin(),
  html() {
    const f = st.f;
    const users = [...S.profiles].sort((a, b) => String(a.full_name || a.email).localeCompare(String(b.full_name || b.email)));
    return `<section class="card mb">
      <div class="toolbar"><div><h3>📜 Nhật ký hoạt động</h3><div class="small muted">Ghi lại mọi lần thêm / sửa / xoá dữ liệu, đăng nhập và thao tác tài khoản. Chỉ tài khoản <b>Quản trị</b> xem được; không ai sửa hoặc xoá được nhật ký.</div></div>
        <span class="spacer"></span><button class="btn" data-act="log-csv">⬇ Xuất CSV</button><button class="btn" data-act="log-reload">⟳ Tải lại</button></div>
      <div class="toolbar mt log-filter">
        <select data-logf="group">${Object.entries(GROUPS).map(([k, [l]]) => `<option value="${k}" ${k === f.group ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <select data-logf="actor"><option value="">Mọi người</option>${users.map(p => `<option value="${p.id}" ${p.id === f.actor ? 'selected' : ''}>${esc(p.full_name || p.email)}</option>`).join('')}</select>
        <label class="small">Từ <input type="date" data-logf="from" value="${esc(f.from)}"></label>
        <label class="small">đến <input type="date" data-logf="to" value="${esc(f.to)}"></label>
        <input data-logf="q" value="${esc(f.q)}" placeholder="🔍 Số PR, mã vật tư, email…" class="w240">
      </div></section>
      <div id="log-table"></div>`;
  },
  after() { if (!st.rows.length && !st.loading) load(); else renderLog(); },
  refresh() { if ($('#log-table')) renderLog(); },
};

async function load(more) {
  st.loading = true; st.err = ''; if (!more) { st.rows = []; st.open.clear(); }
  renderLog();
  try {
    const f = st.f, g = GROUPS[f.group] || GROUPS[''];
    const rows = await ctx.B.auditLog({
      action: f.group === 'login' ? 'login' : null, tbls: g[1], actor: f.actor || null, q: f.q.trim() || null,
      from: f.from ? new Date(f.from + 'T00:00:00+07:00').toISOString() : null,
      to: f.to ? new Date(f.to + 'T23:59:59.999+07:00').toISOString() : null,
      before: more && st.rows.length ? st.rows[st.rows.length - 1].id : null, limit: PAGE,
    });
    st.rows = st.rows.concat(rows); st.more = rows.length === PAGE;
  } catch (e) { st.err = e.message; }
  st.loading = false; renderLog();
}

/* ---------- Hiển thị ---------- */
const prById = id => S.prs.find(p => p.id === id);
const itemById = id => S.items.find(i => i.id === id);
const matById = id => S.materials.find(m => m.id === id);
function parentText(r) {
  if (!r.parent) return '';
  const pr = prById(r.parent) || (itemById(r.parent) && prById(itemById(r.parent).pr_id));
  if (pr) { const it = itemById(r.parent); return pr.pr_no + (it ? ` · dòng ${it.line_no}` : ''); }
  const m = matById(r.parent); if (m) return m.code;
  const pp = (S.proposals || []).find(p => p.id === r.parent); if (pp) return pp.pp_no;
  return '';
}
function val(k, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Có' : 'Không';
  if (k === 'site_id') { const s = siteById(v); return s ? s.code : v; }
  if (k === 'material_id') { const m = matById(v); return m ? `${m.code} ${m.name}` : v; }
  if (/_by$/.test(k)) return profName(v) || v;
  if (k === 'role') return ROLE[v] || v;
  if (k === 'condition') return (COND[v] || [v])[0];
  if (k === 'status') return (PR_ST[v] || IT_ST[v] || PP_ST[v] || [v])[0];
  if (k === 'alloc' && Array.isArray(v)) return v.map(a => `${(siteById(a.site_id) || {}).code || a.site_id}: ${a.qty}`).join('; ');
  if (/_at$/.test(k) && typeof v === 'string') return fmtDT(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
const label = k => FIELD[k] || k;
function detail(r) {
  const c = r.changes; if (!c || typeof c !== 'object') return '';
  const keys = Object.keys(c).filter(k => !HIDE.has(k));
  if (r.action === 'update' || r.action === 'user_update')
    return keys.map(k => `<div><b>${esc(label(k))}</b>: <span class="muted">${esc(val(k, c[k][0]))}</span> → ${esc(val(k, c[k][1]))}</div>`).join('');
  return keys.filter(k => c[k] !== null && c[k] !== '' && !(Array.isArray(c[k]) && !c[k].length))
    .map(k => `<div><b>${esc(label(k))}</b>: ${esc(val(k, c[k]))}</div>`).join('');
}
function summary(r) {
  const c = r.changes || {};
  if (r.action === 'update' || r.action === 'user_update') {
    const ks = Object.keys(c).filter(k => !HIDE.has(k));
    if (ks.length === 1) return `${label(ks[0])}: ${val(ks[0], c[ks[0]][0])} → ${val(ks[0], c[ks[0]][1])}`;
    return ks.map(label).join(', ');
  }
  return '';
}
function renderLog() {
  const el = $('#log-table'); if (!el) return;
  if (st.err) { el.innerHTML = `<div class="card"><p class="err">Không tải được nhật ký: ${esc(st.err)}</p></div>`; return; }
  if (!st.rows.length) { el.innerHTML = `<div class="card muted">${st.loading ? 'Đang tải…' : 'Không có hoạt động nào khớp bộ lọc.'}</div>`; return; }
  el.innerHTML = `<div class="table-wrap"><table class="log-table">
    <thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Thao tác</th><th>Đối tượng</th><th>Nội dung</th></tr></thead>
    <tbody>${st.rows.map(r => {
      const [al, ac] = ACTION[r.action] || [r.action, 'b-gray'];
      const open = st.open.has(r.id), d = open ? detail(r) : '', sm = summary(r), pt = parentText(r);
      const hasDetail = r.changes && Object.keys(r.changes).some(k => !HIDE.has(k));
      return `<tr>
        <td class="nowrap small">${esc(fmtDT(r.at))}</td>
        <td>${r.actor ? esc(profName(r.actor) || 'Tài khoản đã xoá') : '<span class="muted">Hệ thống</span>'}</td>
        <td><span class="badge ${ac}">${esc(al)}</span></td>
        <td>${r.tbl ? `<div class="small muted">${esc(TBL[r.tbl] || r.tbl)}</div>` : ''}${r.ref ? `<b>${esc(r.ref)}</b>${pt ? ` <span class="small muted">(${esc(pt)})</span>` : ''}` : `<b>${esc(pt)}</b>`}</td>
        <td class="small">${sm ? `<div>${esc(sm)}</div>` : ''}${hasDetail ? `<button class="btn sm link" data-act="log-open" data-id="${r.id}">${open ? 'Ẩn chi tiết' : 'Chi tiết'}</button>` : ''}${open ? `<div class="log-detail">${d}</div>` : ''}</td>
      </tr>`;
    }).join('')}</tbody></table></div>
    <div class="toolbar mt"><span class="small muted">${st.rows.length} hoạt động</span><span class="spacer"></span>
      ${st.more ? `<button class="btn" data-act="log-more" ${st.loading ? 'disabled' : ''}>${st.loading ? 'Đang tải…' : 'Xem thêm'}</button>` : ''}</div>`;
}

ACT['log-reload'] = () => load();
ACT['log-more'] = () => load(true);
ACT['log-open'] = b => { const id = Number(b.dataset.id) || b.dataset.id; st.open.has(id) ? st.open.delete(id) : st.open.add(id); renderLog(); };
ACT['log-csv'] = () => {
  if (!st.rows.length) return toast('Chưa có dữ liệu', 'err');
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [['Thời gian', 'Người thực hiện', 'Thao tác', 'Bảng', 'Đối tượng', 'Thuộc', 'Nội dung'].map(q).join(',')];
  for (const r of st.rows) {
    const c = r.changes || {}, ks = Object.keys(c).filter(k => !HIDE.has(k));
    const content = (r.action === 'update' || r.action === 'user_update') ? ks.map(k => `${label(k)}: ${val(k, c[k][0])} → ${val(k, c[k][1])}`).join('; ')
      : ks.filter(k => c[k] !== null && c[k] !== '').map(k => `${label(k)}: ${val(k, c[k])}`).join('; ');
    lines.push([fmtDT(r.at), r.actor ? profName(r.actor) : 'Hệ thống', (ACTION[r.action] || [r.action])[0], TBL[r.tbl] || r.tbl || '', r.ref, parentText(r), content].map(q).join(','));
  }
  downloadText('﻿' + lines.join('\r\n'), `nhat-ky-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
};
const reload = debounce(() => load(), 350);
INPUTS.push(e => {
  const k = e.target.dataset.logf; if (!k) return false;
  if ((k === 'q') !== (e.type === 'input')) return true; // ô tìm: theo 'input'; select / ngày: theo 'change' (tránh tải 2 lần)
  if (st.f[k] === e.target.value) return true;
  st.f[k] = e.target.value; k === 'q' ? reload() : load(); return true;
});
