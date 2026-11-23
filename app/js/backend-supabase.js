// Kết nối Supabase (dữ liệu thật)
import { CONFIG, NS, S, uid } from './core.js';

export function SupaBackend() {
  if (!window.supabase) throw Object.assign(new Error('Không tải được thư viện Supabase (kiểm tra mạng)'), { network: true });
  const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: NS + 'auth' },
  });
  const BUCKET = 'pr-images';
  const toErr = e => Object.assign(new Error(e.message || String(e)), { network: /fetch|network/i.test(e.message || '') });
  async function rpc(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw toErr(error); return data; }
  async function all(table, select, build) {
    let out = [], from = 0;
    for (;;) {
      let q = sb.from(table).select(select);
      if (build) q = build(q);
      const { data, error } = await q.range(from, from + 999);
      if (error) throw toErr(error);
      out = out.concat(data || []);
      if (!data || data.length < 1000) return out;
      from += 1000;
    }
  }
  return {
    async session() { const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null; },
    async signIn(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw toErr(error); return data.user; },
    async signOut() { await sb.auth.signOut(); },
    async changePassword(pw) { const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw toErr(error); },

    async pull(since) {
      const [sites, groups, subgroups, materials, profiles, stock, assets, proposals, lines, links, prs, items, atts] = await Promise.all([
        all('sites', '*', q => q.order('code')),
        all('material_groups', '*', q => q.order('priority')),
        all('material_subgroups', '*', q => q.order('name')),
        all('materials', 'id,code,name,spec,unit,group_code,subgroup_id,image_path,is_new,active', q => q.order('code')),
        all('profiles', 'id,email,full_name,phone,role,site_id,active', q => q.order('full_name')),
        all('stock', '*'),
        all('assets', '*', q => q.order('asset_code')),
        all('purchase_proposals', '*', q => q.order('created_at', { ascending: false })),
        all('proposal_lines', '*', q => q.order('line_no')),
        all('proposal_line_batches', '*'),
        all('purchase_requests', '*', q => (since.pr ? q.gte('updated_at', since.pr) : q).order('updated_at')),
        all('pr_items', '*', q => (since.item ? q.gte('updated_at', since.item) : q).order('updated_at')),
        all('pr_attachments', '*', q => (since.att ? q.gte('created_at', since.att) : q).order('created_at')),
      ]);
      let deliveries = [], changedItems = null;
      if (!since.item) deliveries = await all('pr_deliveries', '*', q => q.order('batch_no'));
      else {
        changedItems = items.map(i => i.id);
        for (let k = 0; k < changedItems.length; k += 100) {
          const chunk = changedItems.slice(k, k + 100);
          deliveries = deliveries.concat(await all('pr_deliveries', '*', q => q.in('item_id', chunk)));
        }
      }
      return { sites, groups, subgroups, materials, profiles, stock, assets, proposals, lines, links, prs, items, atts, deliveries, changedItems, full: !since.pr };
    },
    async assetHistory(id) {
      const { data, error } = await sb.from('asset_history').select('*').eq('asset_id', id).order('created_at', { ascending: false }).limit(200);
      if (error) throw toErr(error); return data;
    },
    async uploadImage(blob) {
      const path = `${S.user.id}/${uid()}.jpg`;
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw toErr(error);
      return path;
    },
    async imageUrls(paths) {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
      if (error) throw toErr(error);
      return Object.fromEntries((data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]));
    },

    createPR: p => rpc('create_pr', { p_site_code: p.site_code, p_need_date: p.need_date, p_items: p.items, p_title: p.title,
                                      p_note: p.note || null, p_delivery_place: p.delivery_place || null, p_attachments: p.attachments || null }),
    addAttachments: (pr, files) => rpc('add_attachments', { p_pr: pr, p_files: files }),
    approvePR: (pr, ok, reason) => rpc('approve_pr', { p_pr: pr, p_ok: ok, p_reason: reason || null }),
    cancelPR: (pr, reason) => rpc('cancel_pr', { p_pr: pr, p_reason: reason || null }),
    saveDeliveries: (item, batches) => rpc('save_deliveries', { p_item: item, p_batches: batches }),
    updateItems: (pr, line, f) => rpc('update_items', { p_pr: pr, p_line: line, p_status: f.status || null, p_eta: f.eta || null, p_supplier: f.supplier || null, p_po: f.po || null }),
    confirmReceipt: (id, f) => rpc('confirm_receipt', { p_delivery: id, p_qty: f.qty, p_issues: f.issues || [], p_note: f.note || null, p_date: f.date || null, p_serials: f.serials || null }),
    resolveIssue: (id, action, note, eta) => rpc('resolve_issue', { p_delivery: id, p_action: action, p_note: note, p_eta: eta || null }),

    setStock: (rows, mode, reason) => rpc('set_stock', { p_rows: rows, p_mode: mode, p_reason: reason || null }),
    updateStock: (id, fields) => rpc('update_stock', { p_id: id, p_fields: fields }),
    moveStock: (id, f) => rpc('move_stock', { p_id: id, p_qty: f.qty, p_to_site: f.site || '', p_to_condition: f.condition || null, p_location: f.location || null, p_note: f.note || null }),
    saveAsset: p => rpc('save_asset', { p }),
    moveAsset: (id, f) => rpc('move_asset', { p_id: id, p_to_site: f.site ?? '', p_to_condition: f.condition || null, p_location: f.location || null, p_note: f.note || null }),
    upsertGroup: g => rpc('upsert_group', { p_code: g.code, p_name: g.name, p_kind: g.kind, p_track_site: !!g.track_site, p_keywords: g.keywords || '', p_priority: g.priority ?? 100 }),
    upsertSubgroup: (group, name) => rpc('upsert_subgroup', { p_group: group, p_name: name }),

    createProposal: (title, note, batches, manual) => rpc('create_proposal', { p_title: title, p_note: note || null, p_batches: batches, p_manual: manual || [] }),
    updateProposal: (pp, status, note) => rpc('update_proposal', { p_pp: pp, p_status: status, p_note: note || null }),
    updateProposalLine: (id, fields) => rpc('update_proposal_line', { p_line: id, p_fields: fields }),

    updateProfile: p => rpc('update_my_profile', { p_full_name: p.full_name, p_phone: p.phone, p_site_code: p.site_code }),
    async adminUsers(body) {
      const { data, error } = await sb.functions.invoke('admin-users', { body });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); msg = j.error || msg; } catch {}
        if (/not found|404/i.test(msg)) msg = 'Chưa triển khai Edge Function "admin-users" (xem README)';
        throw Object.assign(new Error(msg), { network: /fetch|network/i.test(msg) });
      }
      if (data && data.error) throw new Error(data.error);
      return data;
    },
  };
}
