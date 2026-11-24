// Tên tiếng Anh của danh mục (Phòng vật tư / Quản trị): xem, sửa bản dịch tự động, dịch phần còn trống
import { S, ctx, ACT, $, esc, norm, debounce, modal, toast, runAction } from './core.js';
import { autoTranslate, setCatalog } from './i18n.js';

function rows() {
  const out = [];
  for (const m of S.materials) out.push({ t: 'materials', id: m.id, kind: 'Vật tư', code: m.code, vi: m.name, en: m.name_en || '', svi: m.spec || '', sen: m.spec_en || '' });
  for (const g of S.groups) out.push({ t: 'material_groups', id: g.code, kind: 'Nhóm vật tư', code: g.code, vi: g.name, en: g.name_en || '' });
  for (const s of S.subgroups) out.push({ t: 'material_subgroups', id: s.id, kind: 'Nhóm con', code: s.group_code, vi: s.name, en: s.name_en || '' });
  for (const w of S.workCats || []) out.push({ t: 'work_categories', id: w.code, kind: 'Hạng mục thi công', code: w.code, vi: w.name, en: w.name_en || '' });
  return out;
}
const key = r => r.t + ':' + r.id;
function tableHTML(q, onlyMissing) {
  const n = norm(q || '');
  const list = rows().filter(r => (!onlyMissing || !r.en || (r.svi && /[À-ỹĐđ]/.test(r.svi) && !r.sen)) && (!n || norm([r.code, r.vi, r.en, r.svi, r.sen].join(' ')).includes(n)));
  return `<p class="small muted">${list.length} dòng</p><div class="table-wrap" style="max-height:60vh"><table class="en-table"><thead><tr><th>Loại</th><th>Mã</th><th>Tên tiếng Việt</th><th>Tên tiếng Anh</th><th>Quy cách</th><th>Quy cách (tiếng Anh)</th></tr></thead><tbody>
    ${list.slice(0, 500).map(r => `<tr data-k="${esc(key(r))}"><td class="small">${esc(r.kind)}</td><td class="mono small">${esc(r.code)}</td>
      <td data-notr>${esc(r.vi)}</td><td><input data-en="name_en" value="${esc(r.en)}" data-orig="${esc(r.en)}" placeholder="—"></td>
      <td class="small" data-notr>${esc(r.svi || '')}</td><td>${r.t === 'materials' ? `<input data-en="spec_en" value="${esc(r.sen)}" data-orig="${esc(r.sen)}" placeholder="—">` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}

ACT['en-names'] = async () => {
  let q = '', miss = false;
  const { action, data } = await modal({
    title: '🌐 Tên tiếng Anh của danh mục', wide: true,
    body: `<p class="small">Khi chọn giao diện tiếng Anh, tên vật tư, nhóm và hạng mục hiển thị theo cột <b>Tên tiếng Anh</b>. Tên mới khai báo bằng tiếng Việt được tự dịch (dịch máy) khi cập nhật dữ liệu — sửa lại ở đây nếu dịch chưa chuẩn.</p>
      <div class="toolbar mb"><input id="en-q" placeholder="🔍 Tìm mã, tên…" class="w240"><label class="nowrap"><input type="checkbox" id="en-miss"> Chỉ dòng chưa có bản dịch</label>
        <span class="spacer"></span><button class="btn sm" id="en-auto" type="button">🔄 Tự dịch phần còn trống</button></div>
      <div id="en-body">${tableHTML('', false)}</div>`,
    onOpen: ov => {
      const redraw = () => { $('#en-body', ov).innerHTML = tableHTML(q, miss); };
      $('#en-q', ov).addEventListener('input', debounce(e => { q = e.target.value; redraw(); }, 200));
      $('#en-miss', ov).addEventListener('change', e => { miss = e.target.checked; redraw(); });
      $('#en-auto', ov).addEventListener('click', async () => {
        toast('Đang dịch…', '');
        try { const n = await autoTranslate(S, items => ctx.B.setTranslations(items)); toast(n ? `Đã dịch ${n} tên` : 'Không còn tên nào cần dịch (hoặc dịch vụ dịch đã hết lượt hôm nay)', n ? 'ok' : ''); redraw(); }
        catch (e) { toast(e.message, 'err'); }
      });
    },
    actions: [{ label: 'Đóng', value: null }, { label: 'Lưu thay đổi', value: 'ok', primary: true }],
    read: ov => [...ov.querySelectorAll('tr[data-k]')].map(tr => {
      const [t, ...id] = tr.dataset.k.split(':'); const row = { t, id: id.join(':') }; let changed = false;
      tr.querySelectorAll('input[data-en]').forEach(i => { if (i.value.trim() !== i.dataset.orig) { row[i.dataset.en] = i.value.trim(); changed = true; } });
      return changed ? row : null;
    }).filter(Boolean),
  });
  if (action !== 'ok') return;
  if (!data.length) { toast('Chưa thay đổi gì', ''); return; }
  runAction(() => ctx.B.setTranslations(data, true), `Đã lưu ${data.length} tên tiếng Anh`, () => setCatalog(S));
};
