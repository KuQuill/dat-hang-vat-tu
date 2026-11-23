-- =====================================================================
-- 001_init.sql — Hệ thống đặt hàng vật tư MKC (v2)
--
--  • Vật tư theo nhóm chính (CG, MM, DC, KC, HT, NT, MEP, K) + nhóm con
--  • Hai cách quản lý kho:
--      so_luong : vật tư quản lý theo số lượng tại từng vị trí + tình trạng
--      tung_cai : tài sản / thiết bị quản lý từng chiếc (mã tài sản, biển số, QR)
--  • PR → duyệt → tự lập kế hoạch giao (giữ hàng kho tổng, phần thiếu = cần mua)
--  • Người đặt xác nhận nhận hàng từng đợt (số lượng thực nhận, vấn đề chất lượng)
--  • Đề xuất mua gửi Thu mua; Thu mua cập nhật NCC / giá / ngày về → tự về PR
--
-- Chạy trong Supabase Dashboard → SQL Editor (hoặc `supabase db push`).
-- =====================================================================

create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;

create schema if not exists app;
revoke all on schema app from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Tiện ích
-- ---------------------------------------------------------------------
create or replace function app.norm(t text) returns text
language sql immutable parallel safe set search_path = public, extensions, app
as $$
  select trim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary,
           translate(coalesce(t, ''), 'đĐ', 'dD'))), '\s+', ' ', 'g'))
$$;

create or replace function app.today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

create or replace function app.numbers_match(q text, target text) returns boolean
language sql immutable
as $$
  select not exists (
    select 1 from regexp_matches(q, '[0-9]+(?:[.,][0-9]+)?', 'g') as m(arr)
    where target !~ ('(^|[^0-9])' || regexp_replace(m.arr[1], '[.,]', '[.,]', 'g') || '([^0-9]|$)'))
$$;

-- ---------------------------------------------------------------------
-- Danh mục
-- ---------------------------------------------------------------------
create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null, address text, manager text,
  active boolean not null default true, created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text, full_name text, phone text,
  role text not null default 'site' check (role in ('site', 'procurement', 'purchasing', 'admin')),
  site_id uuid references public.sites,
  telegram_id bigint unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- kind: so_luong = quản lý theo số lượng · tung_cai = quản lý từng chiếc
-- track_site: (so_luong) có theo dõi tồn tại công trường sau khi cấp hay không
create table if not exists public.material_groups (
  code text primary key check (code ~ '^[A-Z]{1,4}$'),
  name text not null,
  kind text not null default 'so_luong' check (kind in ('so_luong', 'tung_cai')),
  track_site boolean not null default false,
  keywords text[] not null default '{}',
  priority int not null default 100,
  seq int not null default 0,
  active boolean not null default true
);

create table if not exists public.material_subgroups (
  id uuid primary key default gen_random_uuid(),
  group_code text not null references public.material_groups on update cascade,
  name text not null,
  unique (group_code, name)
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                                  -- KC-0001
  name text not null, spec text, unit text not null,
  group_code text not null references public.material_groups on update cascade,
  subgroup_id uuid references public.material_subgroups on delete set null,
  name_norm text not null default '',
  image_path text,
  is_new boolean not null default true,
  active boolean not null default true,
  created_by uuid references public.profiles,
  created_via text not null default 'html' check (created_via in ('html', 'bot', 'import')),
  created_at timestamptz not null default now()
);
create index if not exists materials_name_norm_trgm on public.materials using gin (name_norm extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Kho: vật tư theo số lượng
-- ---------------------------------------------------------------------
create table if not exists public.stock (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials on delete cascade,
  site_id uuid references public.sites,                       -- null = KHO TỔNG
  condition text not null default 'moi' check (condition in ('moi', 'da_qua_su_dung', 'hong', 'dang_sua')),
  qty numeric not null default 0 check (qty >= 0),
  min_qty numeric check (min_qty is null or min_qty >= 0),
  location_detail text,
  image_path text,
  note text,
  updated_by uuid references public.profiles,
  updated_at timestamptz not null default now()
);
create unique index if not exists stock_key on public.stock
  (material_id, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid), condition);

create table if not exists public.stock_log (
  id bigserial primary key,
  stock_id uuid references public.stock on delete set null,
  material_id uuid not null references public.materials on delete cascade,
  site_id uuid, condition text,
  old_qty numeric, new_qty numeric not null,
  reason text, ref_id uuid,
  changed_by uuid references public.profiles,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Kho: tài sản / thiết bị từng chiếc
-- ---------------------------------------------------------------------
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null unique,                            -- CG-0001-01 (in trên tem QR)
  material_id uuid not null references public.materials,
  serial text,                                                -- biển số / số seri
  site_id uuid references public.sites,                       -- null = KHO TỔNG
  location_detail text,
  condition text not null default 'moi' check (condition in ('moi', 'da_qua_su_dung', 'hong', 'dang_sua')),
  image_path text,
  note text,
  active boolean not null default true,                       -- false = đã thanh lý
  created_by uuid references public.profiles,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists assets_serial on public.assets (material_id, serial) where serial is not null;

create table if not exists public.asset_history (
  id bigserial primary key,
  asset_id uuid not null references public.assets on delete cascade,
  action text not null,                                       -- tao, dieu_chuyen, tinh_trang, nhan, cap_nhat
  from_site uuid, to_site uuid, from_condition text, to_condition text,
  ref_id uuid, note text,
  changed_by uuid references public.profiles,
  created_at timestamptz not null default now()
);
create index if not exists asset_history_asset_idx on public.asset_history (asset_id);

-- ---------------------------------------------------------------------
-- Đơn hàng
-- ---------------------------------------------------------------------
create table if not exists public.doc_counters (
  kind text not null, year int not null, seq int not null default 0,
  primary key (kind, year)
);

create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  pr_no text not null unique,
  title text not null,
  site_id uuid not null references public.sites,
  requested_by uuid references public.profiles,
  need_date date, delivery_place text, note text,
  status text not null default 'cho_duyet'
    check (status in ('cho_duyet', 'da_duyet', 'tu_choi', 'da_dat', 'dang_giao', 'co_van_de', 'da_ve', 'huy')),
  source text not null default 'html' check (source in ('html', 'bot')),
  approved_by uuid references public.profiles, approved_at timestamptz, reject_reason text,
  tg_chat_id bigint, tg_message_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pr_updated_idx on public.purchase_requests (updated_at);

-- Các cột status/eta/received_date/supplier/po_no/qty_received TỰ TÍNH từ các đợt giao
create table if not exists public.pr_items (
  id uuid primary key default gen_random_uuid(),
  pr_id uuid not null references public.purchase_requests on delete cascade,
  line_no int not null,
  material_id uuid not null references public.materials,
  qty numeric not null check (qty > 0),
  unit text not null, note text,
  supplier text, po_no text, eta date, received_date date,
  qty_received numeric not null default 0,
  status text not null default 'cho_xu_ly'
    check (status in ('cho_xu_ly', 'da_dat', 'dang_giao', 'co_van_de', 'da_ve', 'huy')),
  updated_at timestamptz not null default now(),
  unique (pr_id, line_no)
);
create index if not exists pr_items_updated_idx on public.pr_items (updated_at);
create index if not exists pr_items_material_idx on public.pr_items (material_id);

-- Đợt giao. source: kho = xuất từ kho tổng (giữ hàng) · mua = cần mua mới
create table if not exists public.pr_deliveries (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.pr_items on delete cascade,
  batch_no int not null,
  qty numeric not null check (qty > 0),
  source text not null default 'mua' check (source in ('kho', 'mua')),
  stock_id uuid references public.stock on delete set null,   -- dòng tồn kho tổng (vật tư số lượng)
  asset_id uuid references public.assets on delete set null,  -- tài sản cụ thể (từng chiếc)
  supplier text, po_no text, eta date,
  status text not null default 'cho_xu_ly'
    check (status in ('cho_xu_ly', 'da_dat', 'dang_giao', 'da_ve', 'co_van_de', 'huy')),
  note text,
  -- Xác nhận nhận hàng (người đặt / cùng công trường)
  qty_actual numeric check (qty_actual is null or qty_actual >= 0),
  receipt_issues text[] not null default '{}',                -- thieu, thua, sai_hang, kem_chat_luong, khac
  receipt_note text,
  serials text,                                               -- biển số / seri khi nhận tài sản mua mới
  received_date date,
  confirmed_by uuid references public.profiles, confirmed_at timestamptz,
  -- Phòng vật tư xử lý vấn đề
  resolution text check (resolution in ('chap_nhan', 'giao_bu', 'giao_lai')),
  resolution_note text,
  resolved_by uuid references public.profiles, resolved_at timestamptz,
  stock_moved boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists pr_deliveries_item_idx on public.pr_deliveries (item_id);
create index if not exists pr_deliveries_stock_idx on public.pr_deliveries (stock_id) where stock_id is not null;
create index if not exists pr_deliveries_asset_idx on public.pr_deliveries (asset_id) where asset_id is not null;

create table if not exists public.pr_attachments (
  id uuid primary key default gen_random_uuid(),
  pr_id uuid not null references public.purchase_requests on delete cascade,
  item_id uuid references public.pr_items on delete set null,
  delivery_id uuid references public.pr_deliveries on delete set null,
  path text not null unique, file_name text,
  uploaded_by uuid references public.profiles,
  created_at timestamptz not null default now()
);

create table if not exists public.pr_history (
  id bigserial primary key,
  pr_id uuid not null references public.purchase_requests on delete cascade,
  item_id uuid references public.pr_items on delete cascade,
  changed_by uuid references public.profiles,
  field text not null, old_value text, new_value text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Đề xuất mua (Phòng vật tư → Thu mua)
-- ---------------------------------------------------------------------
create table if not exists public.purchase_proposals (
  id uuid primary key default gen_random_uuid(),
  pp_no text not null unique,                                 -- DX-2026-0001
  title text not null,
  status text not null default 'da_gui' check (status in ('da_gui', 'thu_mua_nhan', 'dang_mua', 'da_mua', 'huy')),
  note text, purchasing_note text,
  created_by uuid references public.profiles,
  handled_by uuid references public.profiles,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.proposal_lines (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.purchase_proposals on delete cascade,
  line_no int not null,
  material_id uuid not null references public.materials,
  qty numeric not null check (qty > 0), unit text not null,
  need_date date,
  supplier text, unit_price numeric check (unit_price is null or unit_price >= 0),
  eta date, po_no text, note text,
  updated_at timestamptz not null default now()
);

-- Mỗi đợt "cần mua" của PR thuộc tối đa 1 dòng đề xuất
create table if not exists public.proposal_line_batches (
  delivery_id uuid primary key references public.pr_deliveries on delete cascade,
  line_id uuid not null references public.proposal_lines on delete cascade
);
create index if not exists plb_line_idx on public.proposal_line_batches (line_id);

-- ---------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------
create or replace function app.trg_material_norm() returns trigger
language plpgsql security definer set search_path = public, extensions, app
as $$ begin new.name_norm := app.norm(new.name || ' ' || coalesce(new.spec, '')); return new; end $$;
drop trigger if exists materials_norm on public.materials;
create trigger materials_norm before insert or update of name, spec on public.materials
for each row execute function app.trg_material_norm();

create or replace function app.trg_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
do $$
declare t text;
begin
  foreach t in array array['purchase_requests', 'pr_items', 'pr_deliveries', 'assets', 'purchase_proposals', 'proposal_lines'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.trg_touch()', t || '_touch', t);
  end loop;
end $$;

create or replace function app.trg_item_touch_parent() returns trigger
language plpgsql security definer set search_path = public
as $$ begin update public.purchase_requests set updated_at = now() where id = new.pr_id; return new; end $$;
drop trigger if exists pr_items_touch_parent on public.pr_items;
create trigger pr_items_touch_parent after update on public.pr_items
for each row execute function app.trg_item_touch_parent();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Phân quyền
-- ---------------------------------------------------------------------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active $$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.my_role() = 'admin', false) $$;
create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select active from public.profiles where id = auth.uid()), false) $$;

create or replace function app.require_role(p_user uuid, p_roles text[]) returns text
language plpgsql stable set search_path = public, extensions, app
as $$
declare r text;
begin
  if p_user is null then raise exception 'Bạn chưa đăng nhập'; end if;
  select role into r from public.profiles where id = p_user and active;
  if r is null then raise exception 'Tài khoản không tồn tại hoặc đã bị khoá'; end if;
  if not (r = any (p_roles)) then raise exception 'Bạn không có quyền thực hiện thao tác này'; end if;
  return r;
end $$;

do $$
declare t text;
begin
  foreach t in array array['sites', 'profiles', 'material_groups', 'material_subgroups', 'materials', 'stock', 'stock_log',
                           'assets', 'asset_history', 'doc_counters', 'purchase_requests', 'pr_items', 'pr_deliveries',
                           'pr_attachments', 'pr_history', 'purchase_proposals', 'proposal_lines', 'proposal_line_batches'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "doc_khi_dang_nhap" on public.%I', t);
    if t <> 'doc_counters' then
      execute format('create policy "doc_khi_dang_nhap" on public.%I for select to authenticated using (public.is_active())', t);
    end if;
  end loop;
  foreach t in array array['sites', 'profiles', 'material_groups', 'material_subgroups', 'materials'] loop
    execute format('drop policy if exists "admin_ghi" on public.%I', t);
    execute format('create policy "admin_ghi" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Kho ảnh riêng tư: ảnh nằm trong thư mục <user_id>/ của người tải lên
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pr-images', 'pr-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists "pr_images_doc" on storage.objects;
drop policy if exists "pr_images_tai" on storage.objects;
drop policy if exists "pr_images_xoa" on storage.objects;
create policy "pr_images_doc" on storage.objects for select to authenticated
  using (bucket_id = 'pr-images' and public.is_active());
create policy "pr_images_tai" on storage.objects for insert to authenticated
  with check (bucket_id = 'pr-images' and public.is_active() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "pr_images_xoa" on storage.objects for delete to authenticated
  using (bucket_id = 'pr-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- Hàm dùng chung
-- ---------------------------------------------------------------------
create or replace function app.next_doc_no(p_kind text) returns text
language plpgsql set search_path = public, extensions, app
as $$
declare y int := extract(year from app.today())::int; n int;
begin
  insert into public.doc_counters (kind, year, seq) values (p_kind, y, 1)
  on conflict (kind, year) do update set seq = public.doc_counters.seq + 1
  returning seq into n;
  return p_kind || '-' || y || '-' || lpad(n::text, 4, '0');
end $$;

create or replace function app.next_material_code(p_group text) returns text
language plpgsql set search_path = public, extensions, app
as $$
declare n int; v text;
begin
  loop
    update public.material_groups set seq = seq + 1 where code = p_group returning seq into n;
    if n is null then raise exception 'Nhóm vật tư "%" không tồn tại', p_group; end if;
    v := p_group || '-' || lpad(n::text, 4, '0');
    exit when not exists (select 1 from public.materials where code = v);
  end loop;
  return v;
end $$;

create or replace function app.guess_group(q text) returns text
language sql stable set search_path = public, extensions, app
as $$
  select coalesce((
    select g.code from public.material_groups g, unnest(g.keywords) k
    where g.active and ' ' || app.norm(q) || ' ' like '% ' || k || ' %'
    order by g.priority, length(k) desc limit 1), 'K')
$$;

-- Nhận mã nhóm ("KC") hoặc tên nhóm ("Vật tư kết cấu") → mã nhóm
create or replace function app.resolve_group(p text) returns text
language sql stable set search_path = public, extensions, app
as $$
  select code from public.material_groups
  where upper(code) = upper(trim(coalesce(p, ''))) or app.norm(name) = app.norm(p)
  limit 1
$$;

create or replace function app.parse_condition(p text) returns text
language plpgsql immutable set search_path = public, extensions, app
as $$
declare n text := replace(app.norm(p), '_', ' ');
begin
  if n in ('', 'moi', 'con moi', 'new') then return 'moi';
  elsif n in ('da qua su dung', 'qua su dung', 'cu', 'da su dung', 'used') then return 'da_qua_su_dung';
  elsif n in ('hong', 'hu', 'hong hoc', 'hu hong') then return 'hong';
  elsif n in ('dang sua', 'sua chua', 'dang sua chua', 'bao duong', 'dang bao duong') then return 'dang_sua';
  end if;
  raise exception 'Tình trạng "%" không hợp lệ (Mới / Đã qua sử dụng / Hỏng / Đang sửa)', p;
end $$;

-- '' → null (kho tổng); mã công trường → id
create or replace function app.site_of(p text) returns uuid
language plpgsql stable set search_path = public, extensions, app
as $$
declare v uuid;
begin
  if coalesce(trim(p), '') = '' or app.norm(p) in ('kho tong', 'kho') then return null; end if;
  select id into v from public.sites where upper(code) = upper(trim(p)) or app.norm(name) = app.norm(p) limit 1;
  if v is null then raise exception 'Không tìm thấy công trường "%"', p; end if;
  return v;
end $$;

create or replace function app.find_pr(p text) returns uuid
language plpgsql stable set search_path = public, extensions, app
as $$
declare s text := upper(regexp_replace(coalesce(p, ''), '\s', '', 'g')); v uuid;
begin
  if s ~ '^[0-9]+$' then s := 'PR-' || extract(year from app.today())::int || '-' || lpad(s, 4, '0');
  elsif s ~ '^(PR-?)?[0-9]{4}-[0-9]+$' then
    s := 'PR-' || substring(s from '([0-9]{4})-') || '-' || lpad(substring(s from '-([0-9]+)$'), 4, '0');
  end if;
  select id into v from public.purchase_requests where pr_no = s;
  if v is null then raise exception 'Không tìm thấy phiếu %', s; end if;
  return v;
end $$;

create or replace function app.log(p_pr uuid, p_item uuid, p_user uuid, p_field text, p_old text, p_new text)
returns void language sql
as $$ insert into public.pr_history (pr_id, item_id, changed_by, field, old_value, new_value) values (p_pr, p_item, p_user, p_field, p_old, p_new) $$;

-- ---------------------------------------------------------------------
-- Vật tư: tìm kiếm & tự thêm mới
-- ---------------------------------------------------------------------
-- Điểm khớp theo từ: tỉ lệ từ khoá (đã bỏ dấu) là tiền tố của một từ trong tên vật tư
-- (giống cách web app chấm điểm — "thép D16" khớp "Thép thanh vằn D16 CB400")
create or replace function app.token_score(q text, target text) returns real
language sql immutable set search_path = public, extensions, app
as $$
  with qt as (select t from regexp_split_to_table(app.norm(q), '[^a-z0-9.,]+') t where t <> ''),
       tt as (select t from regexp_split_to_table(coalesce(target, ''), '[^a-z0-9.,]+') t where t <> '')
  select coalesce((
    select (count(*) filter (where exists (select 1 from tt where tt.t = qt.t or (length(qt.t) >= 2 and tt.t like qt.t || '%'))))::real
           / nullif(count(*), 0) * case when count(*) >= 2 then 0.9 else 0.7 end
    from qt), 0)::real
$$;

create or replace function public.search_materials(q text, lim int default 8)
returns table (id uuid, code text, name text, spec text, unit text, group_code text, score real)
language sql stable security definer set search_path = public, extensions, app
as $$
  with nq as (select app.norm(q) as v)
  select m.id, m.code, m.name, m.spec, m.unit, m.group_code,
         greatest(similarity(m.name_norm, nq.v), word_similarity(nq.v, m.name_norm), app.token_score(q, m.name_norm),
                  case when upper(m.code) = upper(trim(q)) then 1 else 0 end)::real
  from public.materials m, nq
  where m.active and nq.v <> ''
    and (m.name_norm % nq.v or nq.v <% m.name_norm or m.code ilike trim(q) || '%' or app.token_score(q, m.name_norm) >= 0.6)
    and (app.numbers_match(nq.v, m.name_norm) or m.code ilike trim(q) || '%')
  order by 7 desc, m.code
  limit greatest(1, least(coalesce(lim, 8), 50))
$$;

create or replace function app.find_or_create_material(
  p_user uuid, p_name text, p_spec text, p_unit text, p_group text, p_via text,
  p_force_new boolean default false, p_subgroup text default null)
returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare
  v_q text := trim(coalesce(p_name, '') || ' ' || coalesce(p_spec, ''));
  r record; v_hit boolean := false; v_group text; v_code text; v_id uuid; v_sub uuid;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Thiếu tên vật tư'; end if;
  if not coalesce(p_force_new, false) then
    select * into r from public.search_materials(v_q, 1) s where s.score >= 0.6;
    v_hit := found;
  end if;
  if v_hit then
    return jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name, 'spec', r.spec, 'unit', r.unit, 'created', false);
  end if;
  if coalesce(trim(p_unit), '') = '' then raise exception 'Vật tư mới "%" cần có đơn vị tính', p_name; end if;
  v_group := coalesce(app.resolve_group(p_group), app.guess_group(v_q));
  if nullif(trim(p_subgroup), '') is not null then
    select id into v_sub from public.material_subgroups where group_code = v_group and app.norm(name) = app.norm(p_subgroup);
  end if;
  v_code := app.next_material_code(v_group);
  insert into public.materials (code, name, spec, unit, group_code, subgroup_id, is_new, created_by, created_via)
  values (v_code, trim(p_name), nullif(trim(p_spec), ''), trim(p_unit), v_group, v_sub, true, p_user, p_via)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'code', v_code, 'name', trim(p_name), 'spec', nullif(trim(p_spec), ''),
                            'unit', trim(p_unit), 'created', true);
end $$;

-- ---------------------------------------------------------------------
-- Kho số lượng: ghi, tính phần còn trống (chưa giữ cho PR)
-- ---------------------------------------------------------------------
create or replace function app.stock_apply(
  p_user uuid, p_material uuid, p_site uuid, p_condition text, p_mode text, p_qty numeric,
  p_location text, p_min numeric, p_reason text, p_ref uuid default null)
returns uuid
language plpgsql set search_path = public, extensions, app
as $$
declare v_id uuid; v_old numeric; v_new numeric;
begin
  select id, qty into v_id, v_old from public.stock
   where material_id = p_material and site_id is not distinct from p_site and condition = p_condition
   for update;
  v_new := case when p_mode = 'set' then p_qty else coalesce(v_old, 0) + p_qty end;
  if v_new < 0 then raise exception 'Tồn kho không đủ (còn %, cần trừ %)', coalesce(v_old, 0), -p_qty; end if;
  if v_id is null then
    insert into public.stock (material_id, site_id, condition, qty, min_qty, location_detail, updated_by)
    values (p_material, p_site, p_condition, v_new, p_min, nullif(trim(p_location), ''), p_user)
    returning id into v_id;
  else
    update public.stock
       set qty = v_new, min_qty = coalesce(p_min, min_qty),
           location_detail = coalesce(nullif(trim(p_location), ''), location_detail),
           updated_by = p_user, updated_at = now()
     where id = v_id;
  end if;
  insert into public.stock_log (stock_id, material_id, site_id, condition, old_qty, new_qty, reason, ref_id, changed_by)
  values (v_id, p_material, p_site, p_condition, v_old, v_new, p_reason, p_ref, p_user);
  return v_id;
end $$;

-- Số lượng còn trống của 1 dòng tồn = tồn − các đợt "xuất từ kho" chưa nhận
create or replace function app.stock_free(p_stock uuid, p_exclude uuid default null) returns numeric
language sql stable set search_path = public, extensions, app
as $$
  select s.qty - coalesce((select sum(d.qty) from public.pr_deliveries d
                           where d.stock_id = s.id and d.source = 'kho'
                             and d.status in ('cho_xu_ly', 'da_dat', 'dang_giao')
                             and d.id is distinct from p_exclude), 0)
  from public.stock s where s.id = p_stock
$$;

create or replace function app.asset_busy(p_asset uuid, p_exclude uuid default null) returns boolean
language sql stable set search_path = public, extensions, app
as $$
  select exists (select 1 from public.pr_deliveries d
                 where d.asset_id = p_asset and d.status in ('cho_xu_ly', 'da_dat', 'dang_giao')
                   and d.id is distinct from p_exclude)
$$;

create or replace function app.asset_log(p_asset uuid, p_action text, p_from_site uuid, p_to_site uuid,
  p_from_cond text, p_to_cond text, p_ref uuid, p_note text, p_user uuid)
returns void language sql
as $$
  insert into public.asset_history (asset_id, action, from_site, to_site, from_condition, to_condition, ref_id, note, changed_by)
  values (p_asset, p_action, p_from_site, p_to_site, p_from_cond, p_to_cond, p_ref, p_note, p_user)
$$;

create or replace function app.create_asset(p_user uuid, p_material uuid, p_serial text, p_site uuid,
  p_condition text, p_location text, p_note text, p_ref uuid default null)
returns uuid
language plpgsql set search_path = public, extensions, app
as $$
declare v_code text; v_mcode text; n int; v_id uuid;
begin
  select code into v_mcode from public.materials where id = p_material;
  if v_mcode is null then raise exception 'Vật tư không tồn tại'; end if;
  select count(*) + 1 into n from public.assets where material_id = p_material;
  loop
    v_code := v_mcode || '-' || lpad(n::text, 2, '0');
    exit when not exists (select 1 from public.assets where asset_code = v_code);
    n := n + 1;
  end loop;
  insert into public.assets (asset_code, material_id, serial, site_id, location_detail, condition, note, created_by)
  values (v_code, p_material, nullif(trim(p_serial), ''), p_site, nullif(trim(p_location), ''), coalesce(p_condition, 'moi'),
          nullif(trim(p_note), ''), p_user)
  returning id into v_id;
  perform app.asset_log(v_id, 'tao', null, p_site, null, coalesce(p_condition, 'moi'), p_ref, p_note, p_user);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Kho: nhập / sửa / điều chuyển
-- ---------------------------------------------------------------------

-- Vật tư số lượng. p_rows: [{ material_id | code | (name, spec, unit, group, subgroup, force_new),
--   qty, site (mã CT, trống = kho tổng), condition, location, min_qty, note }]
-- p_mode: 'set' kiểm kê (đặt số tồn) · 'add' nhập/xuất (cộng thêm, âm = trừ)
create or replace function app.set_stock(p_user uuid, p_rows jsonb, p_mode text, p_reason text)
returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare
  r jsonb; v_mat jsonb; v_kind text; v_id uuid; v_qty numeric; v_min numeric; v_site uuid; v_cond text;
  n int := 0; v_ok int := 0;
  v_created jsonb := '[]'::jsonb; v_errors jsonb := '[]'::jsonb; v_ids jsonb := '[]'::jsonb;
begin
  perform app.require_role(p_user, array['procurement', 'admin']);
  if p_mode not in ('set', 'add') then raise exception 'Kiểu nhập tồn không hợp lệ'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Không có dòng nào để nhập';
  end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Tối đa 5000 dòng mỗi lần nhập'; end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    n := n + 1; v_mat := null;
    begin
      begin
        v_qty := (r ->> 'qty')::numeric;
        v_min := nullif(r ->> 'min_qty', '')::numeric;
      exception when others then raise exception 'số lượng không hợp lệ';
      end;
      if v_qty is null then raise exception 'thiếu số lượng'; end if;
      if p_mode = 'set' and v_qty < 0 then raise exception 'số tồn không được âm'; end if;
      v_site := app.site_of(r ->> 'site');
      v_cond := app.parse_condition(r ->> 'condition');

      if nullif(r ->> 'material_id', '') is not null then
        select jsonb_build_object('id', id, 'code', code, 'created', false) into v_mat from public.materials where id = (r ->> 'material_id')::uuid;
        if v_mat is null then raise exception 'vật tư không tồn tại'; end if;
      elsif nullif(trim(r ->> 'code'), '') is not null then
        select jsonb_build_object('id', id, 'code', code, 'created', false) into v_mat from public.materials where upper(code) = upper(trim(r ->> 'code'));
        if v_mat is null and coalesce(trim(r ->> 'name'), '') = '' then raise exception 'không có mã %', r ->> 'code'; end if;
      end if;
      if v_mat is null then
        v_mat := app.find_or_create_material(p_user, r ->> 'name', r ->> 'spec', r ->> 'unit', r ->> 'group', 'import',
                                             coalesce((r ->> 'force_new')::boolean, false), r ->> 'subgroup');
      end if;
      select g.kind into v_kind from public.materials m join public.material_groups g on g.code = m.group_code where m.id = (v_mat ->> 'id')::uuid;
      if v_kind = 'tung_cai' then
        raise exception '% thuộc nhóm quản lý từng chiếc — khai báo ở mục Tài sản / thiết bị', v_mat ->> 'code';
      end if;

      v_id := app.stock_apply(p_user, (v_mat ->> 'id')::uuid, v_site, v_cond, p_mode, v_qty, r ->> 'location', v_min,
                              coalesce(nullif(trim(r ->> 'note'), ''), nullif(trim(p_reason), ''), p_mode));
      v_ok := v_ok + 1;
      v_ids := v_ids || to_jsonb(v_id);
      if (v_mat ->> 'created')::boolean then v_created := v_created || to_jsonb(v_mat ->> 'code'); end if;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', n, 'error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('ok', v_ok, 'created', v_created, 'errors', v_errors, 'ids', v_ids);
end $$;

-- Sửa nhanh 1 dòng tồn: qty, min_qty, location_detail, note, image_path
create or replace function app.update_stock(p_user uuid, p_id uuid, p_fields jsonb) returns void
language plpgsql set search_path = public, extensions, app
as $$
declare s record; v_qty numeric;
begin
  perform app.require_role(p_user, array['procurement', 'admin']);
  select * into s from public.stock where id = p_id for update;
  if not found then raise exception 'Không tìm thấy dòng tồn kho'; end if;
  if p_fields ? 'image_path' and nullif(p_fields ->> 'image_path', '') is not null
     and p_fields ->> 'image_path' not like p_user::text || '/%' then
    raise exception 'Đường dẫn ảnh không hợp lệ';
  end if;
  if p_fields ? 'qty' then
    v_qty := (p_fields ->> 'qty')::numeric;
    if v_qty is null or v_qty < 0 then raise exception 'Số lượng tồn không hợp lệ'; end if;
    if v_qty < s.qty - app.stock_free(s.id) then
      raise exception 'Đang giữ % cho các PR, không thể đặt tồn thấp hơn', s.qty - app.stock_free(s.id);
    end if;
    perform app.stock_apply(p_user, s.material_id, s.site_id, s.condition, 'set', v_qty, null, null, coalesce(p_fields ->> 'note', 'Sửa trực tiếp'));
  end if;
  update public.stock
     set min_qty         = case when p_fields ? 'min_qty' then nullif(p_fields ->> 'min_qty', '')::numeric else min_qty end,
         location_detail = case when p_fields ? 'location_detail' then nullif(trim(p_fields ->> 'location_detail'), '') else location_detail end,
         image_path      = case when p_fields ? 'image_path' then nullif(p_fields ->> 'image_path', '') else image_path end,
         note            = case when p_fields ? 'note' then nullif(trim(p_fields ->> 'note'), '') else note end,
         updated_by = p_user, updated_at = now()
   where id = p_id;
end $$;

-- Điều chuyển vật tư số lượng: sang vị trí khác (kho tổng ↔ công trường) và/hoặc đổi tình trạng
create or replace function app.move_stock(p_user uuid, p_id uuid, p_qty numeric, p_to_site text,
  p_to_condition text, p_location text, p_note text)
returns uuid
language plpgsql set search_path = public, extensions, app
as $$
declare s record; v_site uuid; v_cond text; v_to uuid; v_free numeric;
begin
  perform app.require_role(p_user, array['procurement', 'admin']);
  select * into s from public.stock where id = p_id for update;
  if not found then raise exception 'Không tìm thấy dòng tồn kho'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Số lượng điều chuyển phải lớn hơn 0'; end if;
  v_free := app.stock_free(s.id);
  if p_qty > v_free then raise exception 'Chỉ điều chuyển được tối đa % (phần còn lại đang giữ cho PR)', v_free; end if;
  v_site := app.site_of(p_to_site);
  v_cond := case when coalesce(trim(p_to_condition), '') = '' then s.condition else app.parse_condition(p_to_condition) end;
  if v_site is not distinct from s.site_id and v_cond = s.condition then
    raise exception 'Vị trí và tình trạng mới trùng với hiện tại';
  end if;
  perform app.stock_apply(p_user, s.material_id, s.site_id, s.condition, 'add', -p_qty, null, null, 'Điều chuyển đi: ' || coalesce(p_note, ''));
  v_to := app.stock_apply(p_user, s.material_id, v_site, v_cond, 'add', p_qty, p_location, null, 'Điều chuyển đến: ' || coalesce(p_note, ''));
  update public.stock set image_path = coalesce(image_path, s.image_path) where id = v_to;
  return v_to;
end $$;

-- Tài sản: tạo mới (không có id) hoặc cập nhật thông tin (có id)
-- p: { id?, material_id | code | (name, spec, unit, group, subgroup, force_new), serial, site, condition,
--      location_detail, note, image_path }
create or replace function app.save_asset(p_user uuid, p jsonb) returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare a record; v_mat jsonb; v_mid uuid; v_kind text; v_id uuid; v_site uuid; v_cond text;
begin
  perform app.require_role(p_user, array['procurement', 'admin']);
  if nullif(p ->> 'image_path', '') is not null and p ->> 'image_path' not like p_user::text || '/%' then
    select * into a from public.assets where id = nullif(p ->> 'id', '')::uuid;
    if not found or a.image_path is distinct from p ->> 'image_path' then raise exception 'Đường dẫn ảnh không hợp lệ'; end if;
  end if;

  if nullif(p ->> 'id', '') is not null then
    select * into a from public.assets where id = (p ->> 'id')::uuid for update;
    if not found then raise exception 'Không tìm thấy tài sản'; end if;
    update public.assets
       set serial          = case when p ? 'serial' then nullif(trim(p ->> 'serial'), '') else serial end,
           location_detail = case when p ? 'location_detail' then nullif(trim(p ->> 'location_detail'), '') else location_detail end,
           note            = case when p ? 'note' then nullif(trim(p ->> 'note'), '') else note end,
           image_path      = case when p ? 'image_path' then nullif(p ->> 'image_path', '') else image_path end,
           active          = case when p ? 'active' then (p ->> 'active')::boolean else active end
     where id = a.id;
    perform app.asset_log(a.id, 'cap_nhat', a.site_id, a.site_id, a.condition, a.condition, null,
                          case when p ? 'active' and not (p ->> 'active')::boolean then 'Thanh lý' else 'Cập nhật thông tin' end, p_user);
    return jsonb_build_object('id', a.id, 'asset_code', a.asset_code, 'created', false);
  end if;

  if nullif(p ->> 'material_id', '') is not null then v_mid := (p ->> 'material_id')::uuid;
  elsif nullif(trim(p ->> 'code'), '') is not null then
    select id into v_mid from public.materials where upper(code) = upper(trim(p ->> 'code'));
    if v_mid is null and coalesce(trim(p ->> 'name'), '') = '' then raise exception 'Không có mã %', p ->> 'code'; end if;
  end if;
  if v_mid is null then
    v_mat := app.find_or_create_material(p_user, p ->> 'name', p ->> 'spec', coalesce(nullif(p ->> 'unit', ''), 'chiếc'),
                                         coalesce(nullif(p ->> 'group', ''), 'MM'), 'import',
                                         coalesce((p ->> 'force_new')::boolean, false), p ->> 'subgroup');
    v_mid := (v_mat ->> 'id')::uuid;
  end if;
  select g.kind into v_kind from public.materials m join public.material_groups g on g.code = m.group_code where m.id = v_mid;
  if v_kind is distinct from 'tung_cai' then
    raise exception 'Vật tư này thuộc nhóm quản lý theo số lượng — khai báo ở mục Vật tư';
  end if;
  v_site := app.site_of(p ->> 'site');
  v_cond := app.parse_condition(p ->> 'condition');
  v_id := app.create_asset(p_user, v_mid, p ->> 'serial', v_site, v_cond, p ->> 'location_detail', p ->> 'note');
  if nullif(p ->> 'image_path', '') is not null then update public.assets set image_path = p ->> 'image_path' where id = v_id; end if;
  return (select jsonb_build_object('id', id, 'asset_code', asset_code, 'created', true,
                                    'material_created', coalesce((v_mat ->> 'created')::boolean, false))
          from public.assets where id = v_id);
end $$;

-- Điều chuyển tài sản (vị trí) và/hoặc đổi tình trạng
create or replace function app.move_asset(p_user uuid, p_id uuid, p_to_site text, p_to_condition text,
  p_location text, p_note text)
returns void
language plpgsql set search_path = public, extensions, app
as $$
declare a record; v_site uuid; v_cond text;
begin
  perform app.require_role(p_user, array['procurement', 'admin']);
  select * into a from public.assets where id = p_id for update;
  if not found then raise exception 'Không tìm thấy tài sản'; end if;
  if app.asset_busy(a.id) then raise exception 'Tài sản đang được giữ / đang giao cho một PR, không điều chuyển được'; end if;
  v_site := case when p_to_site is null then a.site_id else app.site_of(p_to_site) end;
  v_cond := case when coalesce(trim(p_to_condition), '') = '' then a.condition else app.parse_condition(p_to_condition) end;
  update public.assets
     set site_id = v_site, condition = v_cond,
         location_detail = case when v_site is distinct from a.site_id then nullif(trim(p_location), '')
                                else coalesce(nullif(trim(p_location), ''), location_detail) end
   where id = a.id;
  perform app.asset_log(a.id, case when v_site is distinct from a.site_id then 'dieu_chuyen' else 'tinh_trang' end,
                        a.site_id, v_site, a.condition, v_cond, null, p_note, p_user);
end $$;

-- Nhóm & nhóm con
create or replace function app.upsert_group(p_user uuid, p_code text, p_name text, p_kind text, p_track_site boolean,
  p_keywords text, p_priority int)
returns void
language plpgsql set search_path = public, extensions, app
as $$
declare v_code text := upper(trim(coalesce(p_code, '')));
begin
  perform app.require_role(p_user, array['procurement', 'admin']);
  if v_code !~ '^[A-Z]{1,4}$' then raise exception 'Mã nhóm gồm 1–4 chữ cái in hoa, vd: KC'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Nhập tên nhóm'; end if;
  if coalesce(p_kind, 'so_luong') not in ('so_luong', 'tung_cai') then raise exception 'Kiểu quản lý không hợp lệ'; end if;
  if exists (select 1 from public.material_groups where code = v_code and kind <> coalesce(p_kind, 'so_luong'))
     and (exists (select 1 from public.stock s join public.materials m on m.id = s.material_id where m.group_code = v_code)
          or exists (select 1 from public.assets a join public.materials m on m.id = a.material_id where m.group_code = v_code)) then
    raise exception 'Nhóm đã có tồn kho, không đổi được kiểu quản lý';
  end if;
  insert into public.material_groups (code, name, kind, track_site, keywords, priority)
  values (v_code, trim(p_name), coalesce(p_kind, 'so_luong'), coalesce(p_track_site, false),
          coalesce((select array_agg(distinct app.norm(k)) from unnest(string_to_array(coalesce(p_keywords, ''), ',')) k where trim(k) <> ''), '{}'),
          coalesce(p_priority, 100))
  on conflict (code) do update
    set name = excluded.name, kind = excluded.kind, track_site = excluded.track_site,
        keywords = excluded.keywords, priority = excluded.priority;
end $$;

create or replace function app.upsert_subgroup(p_user uuid, p_group text, p_name text) returns uuid
language plpgsql set search_path = public, extensions, app
as $$
declare v uuid;
begin
  perform app.require_role(p_user, array['procurement', 'admin']);
  if coalesce(trim(p_name), '') = '' then raise exception 'Nhập tên nhóm con'; end if;
  insert into public.material_subgroups (group_code, name) values (upper(trim(p_group)), trim(p_name))
  on conflict (group_code, name) do update set name = excluded.name returning id into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Đợt giao & trạng thái
-- ---------------------------------------------------------------------
create or replace function app.recalc_item(p_item uuid) returns void
language plpgsql set search_path = public, extensions, app
as $$
declare n_live int; n_ve int; n_vd int; n_giao int; n_dat int;
        v_eta date; v_rec date; v_qrec numeric; v_sup text; v_po text; v_st text;
begin
  select count(*) filter (where status <> 'huy'),
         count(*) filter (where status = 'da_ve'),
         count(*) filter (where status = 'co_van_de'),
         count(*) filter (where status = 'dang_giao'),
         count(*) filter (where status = 'da_dat'),
         min(eta) filter (where status in ('cho_xu_ly', 'da_dat', 'dang_giao')),
         max(received_date) filter (where status in ('da_ve', 'co_van_de')),
         coalesce(sum(coalesce(qty_actual, qty)) filter (where status in ('da_ve', 'co_van_de')), 0),
         string_agg(distinct supplier, ', ') filter (where supplier is not null and status <> 'huy'),
         string_agg(distinct po_no, ', ') filter (where po_no is not null and status <> 'huy')
    into n_live, n_ve, n_vd, n_giao, n_dat, v_eta, v_rec, v_qrec, v_sup, v_po
    from public.pr_deliveries where item_id = p_item;
  if n_live is null or (n_live = 0 and not exists (select 1 from public.pr_deliveries where item_id = p_item)) then return; end if;
  v_st := case when n_live = 0 then 'huy'
               when n_vd > 0 then 'co_van_de'
               when n_ve = n_live then 'da_ve'
               when n_ve > 0 or n_giao > 0 then 'dang_giao'
               when n_dat > 0 then 'da_dat'
               else 'cho_xu_ly' end;
  update public.pr_items
     set status = v_st, eta = v_eta, received_date = v_rec, qty_received = v_qrec, supplier = v_sup, po_no = v_po
   where id = p_item;
end $$;

create or replace function app.recalc_pr_status(p_pr uuid, p_user uuid) returns void
language plpgsql set search_path = public, extensions, app
as $$
declare st text; v_new text; n_all int; n_ve int; n_vd int; n_giao int; n_dat int;
begin
  select status into st from public.purchase_requests where id = p_pr;
  if st not in ('da_duyet', 'da_dat', 'dang_giao', 'co_van_de', 'da_ve') then return; end if;
  select count(*) filter (where status <> 'huy'), count(*) filter (where status = 'da_ve'),
         count(*) filter (where status = 'co_van_de'), count(*) filter (where status = 'dang_giao'),
         count(*) filter (where status = 'da_dat')
    into n_all, n_ve, n_vd, n_giao, n_dat
    from public.pr_items where pr_id = p_pr;
  v_new := case when n_all = 0 then 'huy' when n_vd > 0 then 'co_van_de' when n_ve = n_all then 'da_ve'
                when n_giao > 0 or n_ve > 0 then 'dang_giao' when n_dat > 0 then 'da_dat' else 'da_duyet' end;
  if v_new <> st then
    update public.purchase_requests set status = v_new where id = p_pr;
    perform app.log(p_pr, null, p_user, 'status', st, v_new);
  end if;
end $$;

-- Khi duyệt PR: lập kế hoạch giao cho các dòng chưa có đợt
--  • lấy phần còn trống ở KHO TỔNG trước (giữ hàng) — ưu tiên hàng mới
--  • phần thiếu → 1 đợt "cần mua"
create or replace function app.plan_deliveries(p_pr uuid) returns void
language plpgsql set search_path = public, extensions, app
as $$
declare i record; r record; v_need numeric; v_take numeric; v_no int;
begin
  for i in select it.id, it.qty, it.material_id, g.kind
           from public.pr_items it join public.materials m on m.id = it.material_id
           join public.material_groups g on g.code = m.group_code
           where it.pr_id = p_pr and it.status <> 'huy'
             and not exists (select 1 from public.pr_deliveries d where d.item_id = it.id)
           order by it.line_no loop
    v_need := i.qty; v_no := 0;
    if i.kind = 'tung_cai' then
      for r in select a.id from public.assets a
               where a.material_id = i.material_id and a.site_id is null and a.active
                 and a.condition in ('moi', 'da_qua_su_dung') and not app.asset_busy(a.id)
               order by (a.condition = 'moi') desc, a.asset_code loop
        exit when v_need < 1;
        v_no := v_no + 1;
        insert into public.pr_deliveries (item_id, batch_no, qty, source, asset_id) values (i.id, v_no, 1, 'kho', r.id);
        v_need := v_need - 1;
      end loop;
    else
      for r in select s.id, app.stock_free(s.id) as free from public.stock s
               where s.material_id = i.material_id and s.site_id is null and s.condition in ('moi', 'da_qua_su_dung')
               order by (s.condition = 'moi') desc loop
        exit when v_need <= 0;
        if r.free > 0 then
          v_take := least(r.free, v_need); v_no := v_no + 1;
          insert into public.pr_deliveries (item_id, batch_no, qty, source, stock_id) values (i.id, v_no, v_take, 'kho', r.id);
          v_need := v_need - v_take;
        end if;
      end loop;
    end if;
    if v_need > 0 then
      v_no := v_no + 1;
      insert into public.pr_deliveries (item_id, batch_no, qty, source) values (i.id, v_no, v_need, 'mua');
    end if;
    perform app.recalc_item(i.id);
  end loop;
end $$;

-- Phòng vật tư lưu kế hoạch giao của 1 dòng (chia đợt / đổi nguồn / NCC / PO / ngày về / trạng thái)
-- Đợt đã nhận / có vấn đề / đã huỷ được giữ nguyên. Đợt mở: trạng thái chỉ cho_xu_ly, da_dat, dang_giao.
-- Tổng SL các đợt (trừ đợt huỷ) phải bằng SL đặt.
create or replace function app.save_deliveries(p_user uuid, p_item uuid, p_batches jsonb) returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare
  v_it record; v_pr record; v_kind text; b jsonb; d record; s record; a record;
  v_sum numeric := 0; v_qty numeric; v_keep uuid[]; v_no int := 0; v_hit boolean;
  v_src text; v_stock uuid; v_asset uuid; v_st text;
begin
  perform app.require_role(p_user, array['procurement', 'admin']);
  select * into v_it from public.pr_items where id = p_item for update;
  if not found then raise exception 'Không tìm thấy dòng hàng'; end if;
  select * into v_pr from public.purchase_requests where id = v_it.pr_id for update;
  if v_pr.status in ('cho_duyet', 'tu_choi', 'huy') then raise exception 'Phiếu chưa được duyệt hoặc đã đóng'; end if;
  select g.kind into v_kind from public.materials m join public.material_groups g on g.code = m.group_code where m.id = v_it.material_id;
  if p_batches is null or jsonb_typeof(p_batches) <> 'array' or jsonb_array_length(p_batches) = 0 then raise exception 'Cần ít nhất một đợt giao'; end if;
  if jsonb_array_length(p_batches) > 30 then raise exception 'Tối đa 30 đợt cho một dòng hàng'; end if;

  select coalesce(array_agg((value ->> 'id')::uuid), '{}') into v_keep
    from jsonb_array_elements(p_batches) where nullif(value ->> 'id', '') is not null;
  if exists (select 1 from public.pr_deliveries where item_id = p_item and status in ('da_ve', 'co_van_de', 'huy') and not (id = any (v_keep))) then
    raise exception 'Không xoá được đợt đã nhận, có vấn đề hoặc đã huỷ';
  end if;

  -- Kiểm tra tổng
  for b in select value from jsonb_array_elements(p_batches) loop
    v_hit := false;
    if nullif(b ->> 'id', '') is not null then
      select * into d from public.pr_deliveries where id = (b ->> 'id')::uuid and item_id = p_item; v_hit := found;
    end if;
    if v_hit and d.status in ('da_ve', 'co_van_de', 'huy') then
      if d.status <> 'huy' then v_sum := v_sum + d.qty; end if;
      continue;
    end if;
    begin v_qty := (b ->> 'qty')::numeric; exception when others then raise exception 'Số lượng đợt "%" không hợp lệ', b ->> 'qty'; end;
    if v_qty is null or v_qty <= 0 then raise exception 'Số lượng mỗi đợt phải lớn hơn 0'; end if;
    if coalesce(b ->> 'status', '') not in ('', 'cho_xu_ly', 'da_dat', 'dang_giao') then
      raise exception 'Trạng thái "Đã nhận" do người đặt hàng xác nhận ở nút Nhận hàng';
    end if;
    v_sum := v_sum + v_qty;
  end loop;
  if v_sum <> v_it.qty then raise exception 'Tổng các đợt (%) phải bằng số lượng đặt (% %)', v_sum, v_it.qty, v_it.unit; end if;

  for d in delete from public.pr_deliveries where item_id = p_item and not (id = any (v_keep)) returning * loop
    perform app.log(v_pr.id, p_item, p_user, 'xoa_dot', d.batch_no || ': ' || d.qty, null);
  end loop;

  for b in select value from jsonb_array_elements(p_batches) loop
    v_no := v_no + 1; v_hit := false;
    if nullif(b ->> 'id', '') is not null then
      select * into d from public.pr_deliveries where id = (b ->> 'id')::uuid and item_id = p_item; v_hit := found;
    end if;
    if v_hit and d.status in ('da_ve', 'co_van_de', 'huy') then
      update public.pr_deliveries set batch_no = v_no where id = d.id;
      continue;
    end if;

    v_qty := (b ->> 'qty')::numeric;
    v_src := coalesce(nullif(b ->> 'source', ''), 'mua');
    v_st  := coalesce(nullif(b ->> 'status', ''), 'cho_xu_ly');
    v_stock := null; v_asset := null;
    if v_src not in ('kho', 'mua') then raise exception 'Nguồn hàng không hợp lệ'; end if;
    if v_src = 'kho' then
      if v_kind = 'tung_cai' then
        v_asset := nullif(b ->> 'asset_id', '')::uuid;
        if v_asset is null then raise exception 'Đợt %: chọn tài sản xuất từ kho tổng', v_no; end if;
        if v_qty <> 1 then raise exception 'Đợt %: tài sản xuất từ kho tính từng chiếc (SL = 1)', v_no; end if;
        select * into a from public.assets where id = v_asset;
        if not found or a.material_id <> v_it.material_id or a.site_id is not null or not a.active then
          raise exception 'Đợt %: tài sản không ở kho tổng hoặc không đúng loại', v_no;
        end if;
        if app.asset_busy(v_asset, case when v_hit then d.id end) then raise exception 'Đợt %: tài sản % đang giữ cho PR khác', v_no, a.asset_code; end if;
      else
        v_stock := nullif(b ->> 'stock_id', '')::uuid;
        if v_stock is null then raise exception 'Đợt %: chọn dòng tồn kho tổng để xuất', v_no; end if;
        select * into s from public.stock where id = v_stock;
        if not found or s.material_id <> v_it.material_id or s.site_id is not null then
          raise exception 'Đợt %: dòng tồn phải ở kho tổng và đúng vật tư', v_no;
        end if;
        if app.stock_free(v_stock, case when v_hit then d.id end) < v_qty then
          raise exception 'Đợt %: kho tổng chỉ còn trống % %', v_no, app.stock_free(v_stock, case when v_hit then d.id end), v_it.unit;
        end if;
      end if;
    end if;

    if v_hit then
      if d.eta is distinct from nullif(b ->> 'eta', '')::date then
        perform app.log(v_pr.id, p_item, p_user, 'dot_' || v_no || '_eta', d.eta::text, b ->> 'eta');
      end if;
      update public.pr_deliveries
         set batch_no = v_no, qty = v_qty, source = v_src, stock_id = v_stock, asset_id = v_asset, status = v_st,
             eta = nullif(b ->> 'eta', '')::date,
             supplier = nullif(trim(b ->> 'supplier'), ''), po_no = nullif(trim(b ->> 'po_no'), ''),
             note = nullif(trim(b ->> 'note'), '')
       where id = d.id;
      if v_src <> 'mua' then delete from public.proposal_line_batches where delivery_id = d.id; end if;
    else
      insert into public.pr_deliveries (item_id, batch_no, qty, source, stock_id, asset_id, status, eta, supplier, po_no, note)
      values (p_item, v_no, v_qty, v_src, v_stock, v_asset, v_st, nullif(b ->> 'eta', '')::date,
              nullif(trim(b ->> 'supplier'), ''), nullif(trim(b ->> 'po_no'), ''), nullif(trim(b ->> 'note'), ''));
      perform app.log(v_pr.id, p_item, p_user, 'them_dot', null, v_no || ': ' || v_qty || ' (' || v_src || ')');
    end if;
  end loop;

  perform app.recalc_item(p_item);
  perform app.recalc_pr_status(v_pr.id, p_user);
  return public.track_pr(v_pr.pr_no);
end $$;

-- Cập nhật nhanh cả phiếu: áp cho mọi đợt đang mở
create or replace function app.update_items(p_user uuid, p_pr text, p_line int, p_status text, p_eta date,
  p_supplier text, p_po text)
returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare v_pr uuid; v_no text; v_st text; r record; v_found boolean := false;
begin
  perform app.require_role(p_user, array['procurement', 'admin']);
  v_pr := app.find_pr(p_pr);
  select status, pr_no into v_st, v_no from public.purchase_requests where id = v_pr for update;
  if v_st in ('cho_duyet', 'tu_choi', 'huy') then raise exception 'Phiếu chưa được duyệt hoặc đã đóng'; end if;
  if nullif(p_status, '') is not null and p_status not in ('cho_xu_ly', 'da_dat', 'dang_giao') then
    raise exception 'Trạng thái "Đã nhận" do người đặt hàng xác nhận';
  end if;
  perform app.plan_deliveries(v_pr);
  for r in select * from public.pr_items where pr_id = v_pr and (p_line is null or line_no = p_line) order by line_no loop
    v_found := true;
    update public.pr_deliveries
       set eta = coalesce(p_eta, eta), status = coalesce(nullif(p_status, ''), status),
           supplier = coalesce(nullif(trim(p_supplier), ''), supplier), po_no = coalesce(nullif(trim(p_po), ''), po_no)
     where item_id = r.id and status in ('cho_xu_ly', 'da_dat', 'dang_giao');
    perform app.log(v_pr, r.id, p_user, 'cap_nhat_nhanh', null,
                    concat_ws(' · ', 'eta=' || p_eta, 'status=' || nullif(p_status, ''), 'ncc=' || nullif(trim(p_supplier), ''), 'po=' || nullif(trim(p_po), '')));
    perform app.recalc_item(r.id);
  end loop;
  if not v_found then raise exception 'Phiếu không có dòng %', p_line; end if;
  perform app.recalc_pr_status(v_pr, p_user);
  return public.track_pr(v_no);
end $$;

-- Ghi hàng đã nhận vào kho / vị trí công trường (gọi khi xác nhận OK hoặc khi xử lý vấn đề)
create or replace function app.receive_to_site(p_user uuid, p_delivery uuid) returns void
language plpgsql set search_path = public, extensions, app
as $$
declare d record; v_it record; v_pr record; v_kind text; v_track boolean; s record; a record;
        v_qty numeric; v_serials text[]; k int;
begin
  select * into d from public.pr_deliveries where id = p_delivery for update;
  if d.stock_moved then return; end if;
  select * into v_it from public.pr_items where id = d.item_id;
  select * into v_pr from public.purchase_requests where id = v_it.pr_id;
  select g.kind, g.track_site into v_kind, v_track
    from public.materials m join public.material_groups g on g.code = m.group_code where m.id = v_it.material_id;
  v_qty := coalesce(d.qty_actual, d.qty);

  if v_kind = 'tung_cai' then
    if d.source = 'kho' and d.asset_id is not null then
      select * into a from public.assets where id = d.asset_id for update;
      if found then
        update public.assets set site_id = v_pr.site_id, location_detail = null where id = a.id;
        perform app.asset_log(a.id, 'nhan', a.site_id, v_pr.site_id, a.condition, a.condition, d.id, 'Nhận theo ' || v_pr.pr_no, p_user);
      end if;
    elsif d.source = 'mua' and v_qty >= 1 then
      v_serials := regexp_split_to_array(coalesce(d.serials, ''), '\s*[,;\n]\s*');
      for k in 1 .. floor(v_qty)::int loop
        perform app.create_asset(p_user, v_it.material_id, v_serials[k], v_pr.site_id, 'moi', null, 'Mua mới theo ' || v_pr.pr_no, d.id);
      end loop;
    end if;
  else
    if d.source = 'kho' and d.stock_id is not null then
      select * into s from public.stock where id = d.stock_id for update;
      if found then
        v_qty := least(v_qty, s.qty);
        if v_qty > 0 then
          perform app.stock_apply(p_user, s.material_id, null, s.condition, 'add', -v_qty, null, null, 'Xuất cho ' || v_pr.pr_no, d.id);
          if v_track then
            perform app.stock_apply(p_user, s.material_id, v_pr.site_id, s.condition, 'add', v_qty, null, null, 'Nhận từ kho tổng — ' || v_pr.pr_no, d.id);
          end if;
        end if;
      end if;
    elsif d.source = 'mua' and v_track and v_qty > 0 then
      perform app.stock_apply(p_user, v_it.material_id, v_pr.site_id, 'moi', 'add', v_qty, null, null, 'Mua mới — ' || v_pr.pr_no, d.id);
    end if;
  end if;
  update public.pr_deliveries set stock_moved = true where id = d.id;
end $$;

-- Người đặt (hoặc người cùng công trường / phòng vật tư nhận thay) xác nhận nhận hàng 1 đợt
-- p_issues: thieu, thua, sai_hang, kem_chat_luong, khac
create or replace function app.confirm_receipt(p_user uuid, p_delivery uuid, p_qty numeric, p_issues text[],
  p_note text, p_date date, p_serials text)
returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare d record; v_it record; v_pr record; v_role text; v_site uuid; v_issues text[]; v_st text;
begin
  select role, site_id into v_role, v_site from public.profiles where id = p_user and active;
  if v_role is null then raise exception 'Bạn chưa đăng nhập'; end if;
  select * into d from public.pr_deliveries where id = p_delivery for update;
  if not found then raise exception 'Không tìm thấy đợt giao'; end if;
  select * into v_it from public.pr_items where id = d.item_id for update;
  select * into v_pr from public.purchase_requests where id = v_it.pr_id for update;
  if not (v_pr.requested_by = p_user or v_role in ('procurement', 'admin') or v_site is not distinct from v_pr.site_id and v_site is not null) then
    raise exception 'Chỉ người đặt hàng, người cùng công trường hoặc phòng vật tư mới được xác nhận nhận hàng';
  end if;
  if v_pr.status in ('cho_duyet', 'tu_choi', 'huy') then raise exception 'Phiếu chưa được duyệt hoặc đã huỷ'; end if;
  if d.status not in ('cho_xu_ly', 'da_dat', 'dang_giao') then raise exception 'Đợt này đã được xác nhận hoặc đã huỷ'; end if;
  if p_qty is null or p_qty < 0 then raise exception 'Số lượng thực nhận không hợp lệ'; end if;
  if p_date is not null and p_date > app.today() then raise exception 'Ngày nhận không được sau hôm nay'; end if;

  v_issues := coalesce((select array_agg(distinct x) from unnest(coalesce(p_issues, '{}')) x where coalesce(x, '') <> ''), '{}');
  if exists (select 1 from unnest(v_issues) x where x not in ('thieu', 'thua', 'sai_hang', 'kem_chat_luong', 'khac')) then
    raise exception 'Loại vấn đề không hợp lệ';
  end if;
  if p_qty < d.qty and not ('thieu' = any (v_issues)) then v_issues := v_issues || 'thieu'::text; end if;
  if p_qty > d.qty and not ('thua' = any (v_issues)) then v_issues := v_issues || 'thua'::text; end if;
  if cardinality(v_issues) > 0 and coalesce(trim(p_note), '') = '' then
    raise exception 'Vui lòng ghi chú vấn đề về số lượng / chất lượng';
  end if;
  v_st := case when cardinality(v_issues) = 0 then 'da_ve' else 'co_van_de' end;

  update public.pr_deliveries
     set status = v_st, qty_actual = p_qty, receipt_issues = v_issues, receipt_note = nullif(trim(p_note), ''),
         serials = nullif(trim(p_serials), ''), received_date = coalesce(p_date, app.today()),
         confirmed_by = p_user, confirmed_at = now()
   where id = d.id;

  -- Hàng đúng loại, đạt chất lượng (kể cả thiếu/thừa) → ghi nhận vào vị trí ngay.
  -- Sai hàng / kém chất lượng → chờ phòng vật tư xử lý.
  if not (v_issues && array['sai_hang', 'kem_chat_luong']) then perform app.receive_to_site(p_user, d.id); end if;

  perform app.log(v_pr.id, v_it.id, p_user, 'nhan_hang_dot_' || d.batch_no,
                  null, p_qty || ' ' || v_it.unit || case when cardinality(v_issues) > 0 then ' · ' || array_to_string(v_issues, ',') else ' · OK' end);
  perform app.recalc_item(v_it.id);
  perform app.recalc_pr_status(v_pr.id, p_user);
  return public.track_pr(v_pr.pr_no);
end $$;

-- Phòng vật tư xử lý đợt có vấn đề
--  chap_nhan : chấp nhận như đã nhận, đóng vấn đề
--  giao_bu   : đã nhận 1 phần → chốt phần đã nhận, tạo đợt mới cho phần thiếu
--  giao_lai  : trả lại toàn bộ (sai hàng / kém chất lượng) → huỷ đợt, tạo đợt mới đủ số lượng
create or replace function app.resolve_issue(p_user uuid, p_delivery uuid, p_action text, p_note text, p_eta date)
returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare d record; v_it record; v_pr record; v_no int; v_new uuid; v_line uuid;
begin
  perform app.require_role(p_user, array['procurement', 'admin']);
  select * into d from public.pr_deliveries where id = p_delivery for update;
  if not found then raise exception 'Không tìm thấy đợt giao'; end if;
  if d.status <> 'co_van_de' then raise exception 'Đợt này không ở trạng thái có vấn đề'; end if;
  if p_action not in ('chap_nhan', 'giao_bu', 'giao_lai') then raise exception 'Cách xử lý không hợp lệ'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Ghi chú cách xử lý'; end if;
  select * into v_it from public.pr_items where id = d.item_id for update;
  select * into v_pr from public.purchase_requests where id = v_it.pr_id;
  select line_id into v_line from public.proposal_line_batches where delivery_id = d.id;
  if p_action = 'giao_bu' and (coalesce(d.qty_actual, 0) <= 0 or d.qty_actual >= d.qty) then
    raise exception 'Giao bù chỉ dùng khi đã nhận một phần (thực nhận nhỏ hơn số lượng đợt)';
  end if;
  if p_action = 'giao_lai' and d.stock_moved then
    raise exception 'Phần hàng đã nhận đã được ghi vào kho — hãy dùng "Giao bù" hoặc "Chấp nhận"';
  end if;
  select coalesce(max(batch_no), 0) + 1 into v_no from public.pr_deliveries where item_id = d.item_id;

  update public.pr_deliveries
     set resolution = p_action, resolution_note = trim(p_note), resolved_by = p_user, resolved_at = now(),
         status = case when p_action = 'giao_lai' then 'huy' else 'da_ve' end,
         qty = case when p_action = 'giao_bu' then d.qty_actual else qty end
   where id = d.id;

  if p_action in ('chap_nhan', 'giao_bu') then perform app.receive_to_site(p_user, d.id); end if;

  if p_action in ('giao_bu', 'giao_lai') then
    insert into public.pr_deliveries (item_id, batch_no, qty, source, stock_id, asset_id, supplier, po_no, eta, status, note)
    values (d.item_id, v_no, case when p_action = 'giao_bu' then d.qty - d.qty_actual else d.qty end,
            d.source, d.stock_id, d.asset_id, d.supplier, d.po_no, p_eta,
            case when d.source = 'mua' and v_line is not null then 'da_dat' else 'cho_xu_ly' end,
            case when p_action = 'giao_bu' then 'Giao bù cho đợt ' else 'Giao lại thay đợt ' end || d.batch_no)
    returning id into v_new;
    if v_line is not null then insert into public.proposal_line_batches (delivery_id, line_id) values (v_new, v_line); end if;
  end if;

  perform app.log(v_pr.id, v_it.id, p_user, 'xu_ly_dot_' || d.batch_no, null, p_action || ': ' || trim(p_note));
  perform app.recalc_item(v_it.id);
  perform app.recalc_pr_status(v_pr.id, p_user);
  return public.track_pr(v_pr.pr_no);
end $$;

-- ---------------------------------------------------------------------
-- PR: tạo, đính kèm, duyệt, huỷ
-- ---------------------------------------------------------------------
create or replace function app.attach(p_user uuid, p_pr uuid, p_files jsonb) returns int
language plpgsql set search_path = public, extensions, app
as $$
declare f jsonb; n int := 0; v_item uuid; v_del uuid;
begin
  if p_files is null or jsonb_typeof(p_files) <> 'array' then return 0; end if;
  if (select count(*) from public.pr_attachments where pr_id = p_pr) + jsonb_array_length(p_files) > 40 then
    raise exception 'Tối đa 40 ảnh cho một PR';
  end if;
  for f in select value from jsonb_array_elements(p_files) loop
    if coalesce(f ->> 'path', '') not like p_user::text || '/%' then raise exception 'Đường dẫn ảnh không hợp lệ'; end if;
    v_item := null; v_del := null;
    if nullif(f ->> 'delivery_id', '') is not null then
      select d.id, d.item_id into v_del, v_item from public.pr_deliveries d join public.pr_items i on i.id = d.item_id
       where d.id = (f ->> 'delivery_id')::uuid and i.pr_id = p_pr;
    elsif nullif(f ->> 'line', '') is not null then
      select id into v_item from public.pr_items where pr_id = p_pr and line_no = (f ->> 'line')::int;
    end if;
    insert into public.pr_attachments (pr_id, item_id, delivery_id, path, file_name, uploaded_by)
    values (p_pr, v_item, v_del, f ->> 'path', nullif(f ->> 'name', ''), p_user)
    on conflict (path) do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function app.create_pr(
  p_user uuid, p_site_code text, p_need_date date, p_items jsonb,
  p_title text, p_note text, p_delivery_place text, p_source text,
  p_attachments jsonb default null, p_chat_id bigint default null, p_message_id bigint default null)
returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare
  v_site uuid; v_site_code text; v_pr uuid; v_no text; v_title text;
  v_line int := 0; it jsonb; v_mat jsonb; v_qty numeric; v_unit text; v_out jsonb := '[]'::jsonb; v_files int;
begin
  perform app.require_role(p_user, array['site', 'procurement', 'purchasing', 'admin']);
  select id, code into v_site, v_site_code from public.sites where upper(code) = upper(trim(p_site_code)) and active;
  if v_site is null then raise exception 'Không tìm thấy công trường "%"', p_site_code; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Đơn hàng chưa có dòng vật tư nào'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Tối đa 200 dòng mỗi PR'; end if;
  if p_need_date is null then raise exception 'Thiếu ngày cần hàng'; end if;
  if p_need_date < app.today() then raise exception 'Ngày cần hàng % đã qua', to_char(p_need_date, 'DD/MM/YYYY'); end if;

  v_title := left(coalesce(nullif(trim(p_title), ''),
                  (select string_agg(coalesce(nullif(e ->> 'name', ''), e ->> 'code', 'vật tư'), ', ') from jsonb_array_elements(p_items) e)), 200);
  v_no := app.next_doc_no('PR');
  insert into public.purchase_requests (pr_no, title, site_id, requested_by, need_date, note, delivery_place, source, tg_chat_id, tg_message_id)
  values (v_no, v_title, v_site, p_user, p_need_date, nullif(trim(p_note), ''), nullif(trim(p_delivery_place), ''), p_source, p_chat_id, p_message_id)
  returning id into v_pr;

  for it in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1; v_mat := null;
    begin v_qty := (it ->> 'qty')::numeric; exception when others then raise exception 'Dòng %: số lượng "%" không hợp lệ', v_line, it ->> 'qty'; end;
    if v_qty is null or v_qty <= 0 then raise exception 'Dòng %: số lượng phải lớn hơn 0', v_line; end if;
    if nullif(it ->> 'material_id', '') is not null then
      select jsonb_build_object('id', id, 'code', code, 'name', name, 'unit', unit, 'created', false) into v_mat
        from public.materials where id = (it ->> 'material_id')::uuid;
      if v_mat is null then raise exception 'Dòng %: vật tư không tồn tại', v_line; end if;
    elsif nullif(it ->> 'code', '') is not null then
      select jsonb_build_object('id', id, 'code', code, 'name', name, 'unit', unit, 'created', false) into v_mat
        from public.materials where upper(code) = upper(trim(it ->> 'code'));
      if v_mat is null then raise exception 'Dòng %: không có mã vật tư %', v_line, it ->> 'code'; end if;
    else
      v_mat := app.find_or_create_material(p_user, it ->> 'name', it ->> 'spec', it ->> 'unit', it ->> 'group', p_source,
                                           coalesce((it ->> 'force_new')::boolean, false), it ->> 'subgroup');
    end if;
    v_unit := coalesce(nullif(trim(it ->> 'unit'), ''), v_mat ->> 'unit');
    insert into public.pr_items (pr_id, line_no, material_id, qty, unit, note)
    values (v_pr, v_line, (v_mat ->> 'id')::uuid, v_qty, v_unit, nullif(trim(it ->> 'note'), ''));
    v_out := v_out || jsonb_build_array(v_mat || jsonb_build_object('line', v_line, 'qty', v_qty, 'unit', v_unit, 'input_name', it ->> 'name'));
  end loop;

  v_files := app.attach(p_user, v_pr, p_attachments);
  perform app.log(v_pr, null, p_user, 'tao_pr', null, p_source);
  return jsonb_build_object('id', v_pr, 'pr_no', v_no, 'title', v_title, 'site', v_site_code, 'need_date', p_need_date,
                            'status', 'cho_duyet', 'items', v_out, 'images', v_files);
end $$;

create or replace function app.approve_pr(p_user uuid, p_pr text, p_ok boolean, p_reason text) returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare v_pr uuid; v_st text; v_new text;
begin
  perform app.require_role(p_user, array['procurement', 'admin']);
  v_pr := app.find_pr(p_pr);
  select status into v_st from public.purchase_requests where id = v_pr for update;
  if v_st <> 'cho_duyet' then raise exception 'Phiếu không ở trạng thái chờ duyệt'; end if;
  if not p_ok and coalesce(trim(p_reason), '') = '' then raise exception 'Cần ghi lý do từ chối'; end if;
  v_new := case when p_ok then 'da_duyet' else 'tu_choi' end;
  update public.purchase_requests
     set status = v_new, approved_by = p_user, approved_at = now(), reject_reason = case when p_ok then null else trim(p_reason) end
   where id = v_pr;
  if p_ok then perform app.plan_deliveries(v_pr); end if;
  perform app.log(v_pr, null, p_user, 'status', v_st, v_new);
  return (select jsonb_build_object('pr_no', r.pr_no, 'title', r.title, 'status', r.status, 'reject_reason', r.reject_reason,
                                    'approved_by', (select full_name from public.profiles where id = p_user),
                                    'requester_tg', p.telegram_id, 'tg_chat_id', r.tg_chat_id, 'tg_message_id', r.tg_message_id)
          from public.purchase_requests r left join public.profiles p on p.id = r.requested_by where r.id = v_pr);
end $$;

create or replace function app.cancel_pr(p_user uuid, p_pr text, p_reason text) returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare v_pr uuid; v_no text; v_st text; v_owner uuid; v_role text; r record;
begin
  v_pr := app.find_pr(p_pr);
  select status, requested_by, pr_no into v_st, v_owner, v_no from public.purchase_requests where id = v_pr for update;
  select role into v_role from public.profiles where id = p_user and active;
  if v_role is null then raise exception 'Bạn chưa đăng nhập'; end if;
  if not ((v_owner = p_user and v_st = 'cho_duyet') or (v_role in ('procurement', 'admin') and v_st not in ('da_ve', 'huy'))) then
    raise exception 'Không thể huỷ phiếu ở trạng thái hiện tại';
  end if;
  -- huỷ đợt đang mở → nhả hàng đang giữ ở kho tổng, gỡ khỏi đề xuất mua
  delete from public.proposal_line_batches where delivery_id in
    (select d.id from public.pr_deliveries d join public.pr_items i on i.id = d.item_id
      where i.pr_id = v_pr and d.status in ('cho_xu_ly', 'da_dat', 'dang_giao'));
  update public.pr_deliveries set status = 'huy'
   where item_id in (select id from public.pr_items where pr_id = v_pr) and status in ('cho_xu_ly', 'da_dat', 'dang_giao');
  for r in select id from public.pr_items where pr_id = v_pr loop
    if exists (select 1 from public.pr_deliveries where item_id = r.id) then perform app.recalc_item(r.id);
    else update public.pr_items set status = 'huy' where id = r.id; end if;
  end loop;
  update public.purchase_requests set status = 'huy', reject_reason = nullif(trim(p_reason), '') where id = v_pr;
  perform app.log(v_pr, null, p_user, 'status', v_st, 'huy');
  return public.track_pr(v_no);
end $$;

-- ---------------------------------------------------------------------
-- Đề xuất mua
-- ---------------------------------------------------------------------
-- p_batches: id các đợt "cần mua" (gom theo vật tư thành từng dòng đề xuất)
-- p_manual : [{ material_id | code, qty, need_date, note }] — mua bổ sung kho tổng
create or replace function app.create_proposal(p_user uuid, p_title text, p_note text, p_batches uuid[], p_manual jsonb)
returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare v_id uuid; v_no text; v_line int := 0; v_lid uuid; r record; m jsonb; v_mid uuid; v_unit text; v_qty numeric; v_bad int;
begin
  perform app.require_role(p_user, array['procurement', 'admin']);
  if coalesce(trim(p_title), '') = '' then raise exception 'Nhập tiêu đề đề xuất'; end if;
  if cardinality(coalesce(p_batches, '{}')) = 0 and (p_manual is null or jsonb_array_length(p_manual) = 0) then
    raise exception 'Chưa chọn vật tư nào';
  end if;
  select count(*) into v_bad from unnest(coalesce(p_batches, '{}')) b(id)
   where not exists (select 1 from public.pr_deliveries d join public.pr_items i on i.id = d.item_id
                     join public.purchase_requests pr on pr.id = i.pr_id
                     where d.id = b.id and d.source = 'mua' and d.status in ('cho_xu_ly', 'da_dat', 'dang_giao')
                       and pr.status in ('da_duyet', 'da_dat', 'dang_giao', 'co_van_de'))
      or exists (select 1 from public.proposal_line_batches l where l.delivery_id = b.id);
  if v_bad > 0 then raise exception '% đợt không hợp lệ hoặc đã nằm trong đề xuất khác — bấm Update rồi thử lại', v_bad; end if;

  v_no := app.next_doc_no('DX');
  insert into public.purchase_proposals (pp_no, title, note, created_by)
  values (v_no, trim(p_title), nullif(trim(p_note), ''), p_user) returning id into v_id;

  for r in select i.material_id, i.unit, sum(d.qty) as qty, min(pr.need_date) as need, array_agg(d.id) as ids
           from public.pr_deliveries d join public.pr_items i on i.id = d.item_id join public.purchase_requests pr on pr.id = i.pr_id
           where d.id = any (p_batches)
           group by i.material_id, i.unit order by min(pr.need_date) nulls last loop
    v_line := v_line + 1;
    insert into public.proposal_lines (proposal_id, line_no, material_id, qty, unit, need_date)
    values (v_id, v_line, r.material_id, r.qty, r.unit, r.need) returning id into v_lid;
    insert into public.proposal_line_batches (delivery_id, line_id) select x, v_lid from unnest(r.ids) x;
  end loop;

  for m in select value from jsonb_array_elements(coalesce(p_manual, '[]'::jsonb)) loop
    v_mid := null;
    if nullif(m ->> 'material_id', '') is not null then v_mid := (m ->> 'material_id')::uuid;
    else select id into v_mid from public.materials where upper(code) = upper(trim(m ->> 'code')); end if;
    select unit into v_unit from public.materials where id = v_mid;
    if v_unit is null then raise exception 'Vật tư "%" không tồn tại', coalesce(m ->> 'code', m ->> 'material_id'); end if;
    v_qty := (m ->> 'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Số lượng mua phải lớn hơn 0'; end if;
    v_line := v_line + 1;
    insert into public.proposal_lines (proposal_id, line_no, material_id, qty, unit, need_date, note)
    values (v_id, v_line, v_mid, v_qty, v_unit, nullif(m ->> 'need_date', '')::date, coalesce(nullif(trim(m ->> 'note'), ''), 'Mua bổ sung kho tổng'));
  end loop;

  return jsonb_build_object('id', v_id, 'pp_no', v_no, 'lines', v_line);
end $$;

-- Thu mua / phòng vật tư cập nhật trạng thái đề xuất
create or replace function app.update_proposal(p_user uuid, p_pp text, p_status text, p_note text) returns void
language plpgsql set search_path = public, extensions, app
as $$
declare v_role text; p record; r record;
begin
  v_role := app.require_role(p_user, array['purchasing', 'procurement', 'admin']);
  select * into p from public.purchase_proposals where pp_no = upper(trim(p_pp)) for update;
  if not found then raise exception 'Không tìm thấy đề xuất %', p_pp; end if;
  if p_status not in ('da_gui', 'thu_mua_nhan', 'dang_mua', 'da_mua', 'huy') then raise exception 'Trạng thái không hợp lệ'; end if;
  if p_status = 'huy' and v_role = 'purchasing' then raise exception 'Chỉ phòng vật tư mới huỷ được đề xuất'; end if;
  if p.status = 'huy' then raise exception 'Đề xuất đã huỷ'; end if;
  update public.purchase_proposals
     set status = p_status, purchasing_note = coalesce(nullif(trim(p_note), ''), purchasing_note),
         handled_by = case when v_role = 'purchasing' then p_user else handled_by end
   where id = p.id;
  if p_status = 'huy' then
    -- trả các đợt về danh sách "cần mua"
    delete from public.proposal_line_batches where line_id in (select id from public.proposal_lines where proposal_id = p.id)
      and delivery_id in (select id from public.pr_deliveries where status in ('cho_xu_ly', 'da_dat'));
  elsif p_status in ('dang_mua', 'da_mua') then
    for r in select distinct d.item_id from public.pr_deliveries d join public.proposal_line_batches l on l.delivery_id = d.id
             join public.proposal_lines pl on pl.id = l.line_id where pl.proposal_id = p.id and d.status = 'cho_xu_ly' loop
      update public.pr_deliveries set status = 'da_dat'
       where item_id = r.item_id and status = 'cho_xu_ly'
         and id in (select delivery_id from public.proposal_line_batches l join public.proposal_lines pl on pl.id = l.line_id where pl.proposal_id = p.id);
      perform app.recalc_item(r.item_id);
    end loop;
    for r in select distinct i.pr_id from public.pr_items i join public.pr_deliveries d on d.item_id = i.id
             join public.proposal_line_batches l on l.delivery_id = d.id join public.proposal_lines pl on pl.id = l.line_id
             where pl.proposal_id = p.id loop
      perform app.recalc_pr_status(r.pr_id, p_user);
    end loop;
  end if;
end $$;

-- Thu mua cập nhật 1 dòng đề xuất: NCC, đơn giá, ngày về, số PO → tự chuyển sang các đợt giao của PR
create or replace function app.update_proposal_line(p_user uuid, p_line uuid, p_fields jsonb) returns void
language plpgsql set search_path = public, extensions, app
as $$
declare l record; p record; r record;
begin
  perform app.require_role(p_user, array['purchasing', 'procurement', 'admin']);
  select * into l from public.proposal_lines where id = p_line for update;
  if not found then raise exception 'Không tìm thấy dòng đề xuất'; end if;
  select * into p from public.purchase_proposals where id = l.proposal_id;
  if p.status = 'huy' then raise exception 'Đề xuất đã huỷ'; end if;
  update public.proposal_lines
     set supplier   = case when p_fields ? 'supplier' then nullif(trim(p_fields ->> 'supplier'), '') else supplier end,
         unit_price = case when p_fields ? 'unit_price' then nullif(p_fields ->> 'unit_price', '')::numeric else unit_price end,
         eta        = case when p_fields ? 'eta' then nullif(p_fields ->> 'eta', '')::date else eta end,
         po_no      = case when p_fields ? 'po_no' then nullif(trim(p_fields ->> 'po_no'), '') else po_no end,
         note       = case when p_fields ? 'note' then nullif(trim(p_fields ->> 'note'), '') else note end
   where id = l.id
   returning * into l;
  for r in select d.id, d.item_id from public.pr_deliveries d join public.proposal_line_batches b on b.delivery_id = d.id
           where b.line_id = l.id and d.status in ('cho_xu_ly', 'da_dat', 'dang_giao') loop
    update public.pr_deliveries
       set eta = coalesce(l.eta, eta), supplier = coalesce(l.supplier, supplier), po_no = coalesce(l.po_no, p.pp_no)
     where id = r.id;
    perform app.recalc_item(r.item_id);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Tra cứu (dùng cho bot sau này)
-- ---------------------------------------------------------------------
create or replace function public.track_pr(p_pr text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, app
as $$
declare v uuid;
begin
  v := app.find_pr(p_pr);
  return (
    select jsonb_build_object(
      'pr_no', r.pr_no, 'title', r.title, 'status', r.status, 'site', s.code, 'site_name', s.name,
      'need_date', r.need_date, 'requested_by', p.full_name, 'created_at', r.created_at, 'reject_reason', r.reject_reason,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'line', i.line_no, 'code', m.code, 'name', m.name, 'qty', i.qty, 'unit', i.unit,
                 'qty_received', i.qty_received, 'status', i.status, 'eta', i.eta, 'received_date', i.received_date,
                 'deliveries', coalesce((select jsonb_agg(jsonb_build_object(
                     'batch', d.batch_no, 'qty', d.qty, 'source', d.source, 'status', d.status, 'eta', d.eta,
                     'qty_actual', d.qty_actual, 'issues', d.receipt_issues, 'received_date', d.received_date,
                     'supplier', d.supplier, 'po_no', d.po_no) order by d.batch_no)
                   from public.pr_deliveries d where d.item_id = i.id), '[]'::jsonb)) order by i.line_no)
        from public.pr_items i join public.materials m on m.id = i.material_id where i.pr_id = r.id), '[]'::jsonb))
    from public.purchase_requests r join public.sites s on s.id = r.site_id
    left join public.profiles p on p.id = r.requested_by where r.id = v);
end $$;

create or replace function public.track_material(q text) returns jsonb
language sql stable security definer set search_path = public, extensions, app
as $$
  select coalesce(jsonb_agg(x order by x ->> 'eta' nulls last), '[]'::jsonb)
  from (
    select jsonb_build_object('pr_no', r.pr_no, 'title', r.title, 'site', s.code, 'code', m.code, 'name', m.name,
             'batch', d.batch_no, 'qty', coalesce(d.qty, i.qty), 'unit', i.unit, 'source', d.source,
             'status', coalesce(d.status, i.status), 'eta', coalesce(d.eta, i.eta), 'need_date', r.need_date) as x
    from (select * from public.search_materials(q, 5) where score >= 0.45) sm
    join public.materials m on m.id = sm.id
    join public.pr_items i on i.material_id = m.id
    join public.purchase_requests r on r.id = i.pr_id
    join public.sites s on s.id = r.site_id
    left join public.pr_deliveries d on d.item_id = i.id
    where r.status not in ('tu_choi', 'huy')
      and ((d.id is null and i.status not in ('da_ve', 'huy')) or d.status in ('cho_xu_ly', 'da_dat', 'dang_giao'))
    order by coalesce(d.eta, i.eta) nulls last limit 30
  ) t
$$;

-- ---------------------------------------------------------------------
-- Hàm public cho web app (người dùng đã đăng nhập)
-- ---------------------------------------------------------------------
create or replace function public.create_pr(p_site_code text, p_need_date date, p_items jsonb, p_title text,
  p_note text default null, p_delivery_place text default null, p_attachments jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, app
as $$
begin
  if coalesce(trim(p_title), '') = '' then raise exception 'Thiếu tên PR'; end if;
  return app.create_pr(auth.uid(), p_site_code, p_need_date, p_items, p_title, p_note, p_delivery_place, 'html', p_attachments);
end $$;

create or replace function public.add_attachments(p_pr text, p_files jsonb) returns int
language plpgsql security definer set search_path = public, extensions, app
as $$
declare v_pr uuid; v_owner uuid; v_site uuid; v_my_site uuid;
begin
  if auth.uid() is null then raise exception 'Bạn chưa đăng nhập'; end if;
  v_pr := app.find_pr(p_pr);
  select requested_by, site_id into v_owner, v_site from public.purchase_requests where id = v_pr;
  select site_id into v_my_site from public.profiles where id = auth.uid();
  if v_owner is distinct from auth.uid() and v_my_site is distinct from v_site then
    perform app.require_role(auth.uid(), array['procurement', 'admin']);
  else
    perform app.require_role(auth.uid(), array['site', 'procurement', 'purchasing', 'admin']);
  end if;
  return app.attach(auth.uid(), v_pr, p_files);
end $$;

create or replace function public.approve_pr(p_pr text, p_ok boolean, p_reason text default null) returns jsonb
language sql security definer set search_path = public, extensions, app as $$ select app.approve_pr(auth.uid(), p_pr, p_ok, p_reason) $$;
create or replace function public.cancel_pr(p_pr text, p_reason text default null) returns jsonb
language sql security definer set search_path = public, extensions, app as $$ select app.cancel_pr(auth.uid(), p_pr, p_reason) $$;
create or replace function public.save_deliveries(p_item uuid, p_batches jsonb) returns jsonb
language sql security definer set search_path = public, extensions, app as $$ select app.save_deliveries(auth.uid(), p_item, p_batches) $$;
create or replace function public.update_items(p_pr text, p_line int default null, p_status text default null,
  p_eta date default null, p_supplier text default null, p_po text default null) returns jsonb
language sql security definer set search_path = public, extensions, app as $$ select app.update_items(auth.uid(), p_pr, p_line, p_status, p_eta, p_supplier, p_po) $$;
create or replace function public.confirm_receipt(p_delivery uuid, p_qty numeric, p_issues text[] default '{}',
  p_note text default null, p_date date default null, p_serials text default null) returns jsonb
language sql security definer set search_path = public, extensions, app as $$ select app.confirm_receipt(auth.uid(), p_delivery, p_qty, p_issues, p_note, p_date, p_serials) $$;
create or replace function public.resolve_issue(p_delivery uuid, p_action text, p_note text, p_eta date default null) returns jsonb
language sql security definer set search_path = public, extensions, app as $$ select app.resolve_issue(auth.uid(), p_delivery, p_action, p_note, p_eta) $$;
create or replace function public.set_stock(p_rows jsonb, p_mode text default 'set', p_reason text default null) returns jsonb
language sql security definer set search_path = public, extensions, app as $$ select app.set_stock(auth.uid(), p_rows, p_mode, p_reason) $$;
create or replace function public.update_stock(p_id uuid, p_fields jsonb) returns void
language sql security definer set search_path = public, extensions, app as $$ select app.update_stock(auth.uid(), p_id, p_fields) $$;
create or replace function public.move_stock(p_id uuid, p_qty numeric, p_to_site text, p_to_condition text default null,
  p_location text default null, p_note text default null) returns uuid
language sql security definer set search_path = public, extensions, app as $$ select app.move_stock(auth.uid(), p_id, p_qty, p_to_site, p_to_condition, p_location, p_note) $$;
create or replace function public.save_asset(p jsonb) returns jsonb
language sql security definer set search_path = public, extensions, app as $$ select app.save_asset(auth.uid(), p) $$;
create or replace function public.move_asset(p_id uuid, p_to_site text, p_to_condition text default null,
  p_location text default null, p_note text default null) returns void
language sql security definer set search_path = public, extensions, app as $$ select app.move_asset(auth.uid(), p_id, p_to_site, p_to_condition, p_location, p_note) $$;
create or replace function public.upsert_group(p_code text, p_name text, p_kind text default 'so_luong',
  p_track_site boolean default false, p_keywords text default '', p_priority int default 100) returns void
language sql security definer set search_path = public, extensions, app as $$ select app.upsert_group(auth.uid(), p_code, p_name, p_kind, p_track_site, p_keywords, p_priority) $$;
create or replace function public.upsert_subgroup(p_group text, p_name text) returns uuid
language sql security definer set search_path = public, extensions, app as $$ select app.upsert_subgroup(auth.uid(), p_group, p_name) $$;
create or replace function public.create_proposal(p_title text, p_note text, p_batches uuid[], p_manual jsonb default '[]') returns jsonb
language sql security definer set search_path = public, extensions, app as $$ select app.create_proposal(auth.uid(), p_title, p_note, p_batches, p_manual) $$;
create or replace function public.update_proposal(p_pp text, p_status text, p_note text default null) returns void
language sql security definer set search_path = public, extensions, app as $$ select app.update_proposal(auth.uid(), p_pp, p_status, p_note) $$;
create or replace function public.update_proposal_line(p_line uuid, p_fields jsonb) returns void
language sql security definer set search_path = public, extensions, app as $$ select app.update_proposal_line(auth.uid(), p_line, p_fields) $$;

create or replace function public.update_my_profile(p_full_name text, p_phone text, p_site_code text) returns void
language plpgsql security definer set search_path = public, extensions, app
as $$
declare v_site uuid;
begin
  if auth.uid() is null then raise exception 'Bạn chưa đăng nhập'; end if;
  if nullif(trim(p_site_code), '') is not null then
    select id into v_site from public.sites where upper(code) = upper(trim(p_site_code));
    if v_site is null then raise exception 'Không tìm thấy công trường "%"', p_site_code; end if;
  end if;
  update public.profiles
     set full_name = coalesce(nullif(trim(p_full_name), ''), full_name), phone = nullif(trim(p_phone), ''), site_id = coalesce(v_site, site_id)
   where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- Quyền gọi hàm
-- ---------------------------------------------------------------------
revoke execute on all functions in schema app    from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.my_role(), public.is_admin(), public.is_active(),
  public.search_materials(text, int), public.track_pr(text), public.track_material(text),
  public.create_pr(text, date, jsonb, text, text, text, jsonb), public.add_attachments(text, jsonb),
  public.approve_pr(text, boolean, text), public.cancel_pr(text, text),
  public.save_deliveries(uuid, jsonb), public.update_items(text, int, text, date, text, text),
  public.confirm_receipt(uuid, numeric, text[], text, date, text), public.resolve_issue(uuid, text, text, date),
  public.set_stock(jsonb, text, text), public.update_stock(uuid, jsonb),
  public.move_stock(uuid, numeric, text, text, text, text),
  public.save_asset(jsonb), public.move_asset(uuid, text, text, text, text),
  public.upsert_group(text, text, text, boolean, text, int), public.upsert_subgroup(text, text),
  public.create_proposal(text, text, uuid[], jsonb), public.update_proposal(text, text, text),
  public.update_proposal_line(uuid, jsonb), public.update_my_profile(text, text, text)
to authenticated;

grant usage on schema app to service_role;
grant execute on all functions in schema app    to service_role;
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------------
-- Dữ liệu khởi tạo: nhóm & nhóm con (sửa được trong web app)
-- ---------------------------------------------------------------------
insert into public.material_groups (code, name, kind, track_site, keywords, priority) values
  ('CG',  'Cơ giới',            'tung_cai', true,  array['xe dao', 'xe cuoc', 'may xuc', 'may dao', 'xe ui', 'xe lu', 'xe cau', 'can cau', 'xe tai', 'xe nang', 'xe ben'], 10),
  ('MM',  'Máy móc',            'tung_cai', true,  array['may tron', 'may dam', 'may han', 'may cat', 'may khoan', 'may bom', 'may phat dien', 'may nen khi', 'may mai', 'may uon'], 20),
  ('DC',  'Công cụ dụng cụ',    'so_luong', true,  array['gian giao', 'cay chong', 'xa go', 'bua', 'xeng', 'xe rua', 'thuoc', 'mu bao ho', 'gang tay', 'day an toan', 'bao ho'], 30),
  ('KC',  'Vật tư kết cấu',     'so_luong', false, array['thep', 'sat', 'xi mang', 'cat', 'da', 'soi', 'gach', 'be tong', 'cop pha', 'van ep', 'bu long', 'que han', 'day buoc', 'phu gia'], 40),
  ('HT',  'Vật tư hoàn thiện',  'so_luong', false, array['son', 'bot tret', 'gach men', 'gach op', 'gach lat', 'thach cao', 'tran', 'vach', 'kinh', 'cua', 'chong tham', 'keo dan'], 50),
  ('NT',  'Vật tư nội thất',    'so_luong', false, array['ban', 'ghe', 'tu', 'giuong', 'sofa', 'rem', 'ke', 'tham'], 60),
  ('MEP', 'Vật tư MEP',         'so_luong', false, array['day dien', 'cap dien', 'aptomat', 'mcb', 'cb', 'den', 'o cam', 'cong tac', 'ong luon', 'ong nuoc', 'ppr', 'upvc', 'hdpe', 'pvc', 'van', 'dieu hoa', 'quat', 'binh chua chay', 'sprinkler'], 70),
  ('K',   'Khác',               'so_luong', false, array[]::text[], 999)
on conflict (code) do nothing;

insert into public.material_subgroups (group_code, name) values
  ('CG', 'Xe đào'), ('CG', 'Xe cẩu'), ('CG', 'Xe tải'), ('CG', 'Xe lu'),
  ('MM', 'Máy trộn'), ('MM', 'Máy hàn'), ('MM', 'Máy phát điện'), ('MM', 'Máy đầm'),
  ('DC', 'Giàn giáo'), ('DC', 'Dụng cụ cầm tay'), ('DC', 'An toàn lao động'),
  ('KC', 'Thép'), ('KC', 'Xi măng'), ('KC', 'Cát đá'), ('KC', 'Gạch'), ('KC', 'Bê tông'), ('KC', 'Cốp pha'),
  ('HT', 'Sơn'), ('HT', 'Gạch ốp lát'), ('HT', 'Trần vách'), ('HT', 'Cửa'),
  ('NT', 'Bàn ghế'), ('NT', 'Tủ kệ'),
  ('MEP', 'Điện'), ('MEP', 'Cấp thoát nước'), ('MEP', 'Điều hòa thông gió'), ('MEP', 'PCCC')
on conflict do nothing;

-- Ví dụ thêm công trường:
-- insert into public.sites (code, name, address, manager) values ('LA01', 'Nhà xưởng Long An', 'KCN ...', 'Nguyễn Văn A');
-- Quản trị đầu tiên: update public.profiles set role = 'admin' where email = 'admin@congty.vn';

-- Cố định search_path cho các hàm tiện ích (theo khuyến nghị bảo mật của Supabase)
alter function app.log(uuid, uuid, uuid, text, text, text) set search_path = public, extensions, app;
alter function app.numbers_match(text, text) set search_path = public, extensions, app;
alter function app.trg_touch() set search_path = public, extensions, app;
alter function app.today() set search_path = public, extensions, app;
alter function app.asset_log(uuid, text, uuid, uuid, text, text, uuid, text, uuid) set search_path = public, extensions, app;
