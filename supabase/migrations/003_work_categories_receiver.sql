-- =====================================================================
-- 003 — Hạng mục thi công (dùng trong số PR) · người nhận hàng + SĐT
-- =====================================================================

create table if not exists public.work_categories (
  code   text primary key check (code ~ '^[A-Z0-9]{1,6}$'),
  name   text not null,
  sort   int not null default 100,
  active boolean not null default true
);
alter table public.work_categories enable row level security;
drop policy if exists "doc_khi_dang_nhap" on public.work_categories;
create policy "doc_khi_dang_nhap" on public.work_categories for select to authenticated using (public.is_active());

insert into public.work_categories (code, name, sort) values
  ('CB',   'Công tác chuẩn bị, lán trại, tạm', 10),
  ('XD',   'Xây dựng – kết cấu', 20),
  ('MEP',  'Cơ điện (M&E)', 30),
  ('PCCC', 'Phòng cháy chữa cháy', 40),
  ('HT',   'Hoàn thiện', 50),
  ('NT',   'Nội thất', 60),
  ('HTKT', 'Hạ tầng kỹ thuật', 70),
  ('CQ',   'Cảnh quan', 80),
  ('TB',   'Thiết bị', 90),
  ('K',    'Khác', 999)
on conflict (code) do nothing;

alter table public.purchase_requests
  add column if not exists receiver_name  text,
  add column if not exists receiver_phone text;

create or replace function app.resolve_work_category(p text) returns text
language sql stable set search_path = public, extensions, app
as $$ select code from public.work_categories where active and (upper(code) = upper(trim(coalesce(p, ''))) or app.norm(name) = app.norm(p)) limit 1 $$;

-- Tạo PR: hạng mục thi công + người nhận
drop function if exists public.create_pr(text, text, date, jsonb, text, text, text, jsonb);
drop function if exists app.create_pr(uuid, text, date, jsonb, text, text, text, text, jsonb, bigint, bigint, text);

create or replace function app.create_pr(
  p_user uuid, p_site_code text, p_need_date date, p_items jsonb,
  p_title text, p_note text, p_delivery_place text, p_source text,
  p_attachments jsonb default null, p_chat_id bigint default null, p_message_id bigint default null,
  p_category text default null, p_receiver_name text default null, p_receiver_phone text default null)
returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare v_site uuid; v_site_code text; v_pr uuid; v_base text; v_no text; v_cat text; v_out jsonb; v_files int;
begin
  perform app.require_role(p_user, array['site', 'procurement', 'purchasing', 'admin']);
  select id, code into v_site, v_site_code from public.sites where upper(code) = upper(trim(p_site_code)) and active;
  if v_site is null then raise exception 'Không tìm thấy dự án / công trường "%"', p_site_code; end if;
  v_cat := app.resolve_work_category(p_category);
  if v_cat is null then
    if coalesce(trim(p_category), '') <> '' then raise exception 'Hạng mục thi công "%" không tồn tại', p_category; end if;
    v_cat := 'K';
  end if;
  if p_need_date is null then raise exception 'Thiếu ngày cần có hàng'; end if;
  if p_need_date < app.today() then raise exception 'Ngày cần có hàng % đã qua', to_char(p_need_date, 'DD/MM/YYYY'); end if;

  v_base := app.next_pr_base(v_site, v_cat);
  v_no := v_base || '.R1';
  insert into public.purchase_requests (pr_no, base_no, revision, category, title, site_id, requested_by, need_date, note, delivery_place,
                                        receiver_name, receiver_phone, source, tg_chat_id, tg_message_id)
  values (v_no, v_base, 1, v_cat, coalesce(nullif(left(trim(p_title), 200), ''), v_no), v_site, p_user, p_need_date,
          nullif(trim(p_note), ''), nullif(trim(p_delivery_place), ''), nullif(trim(p_receiver_name), ''), nullif(trim(p_receiver_phone), ''),
          p_source, p_chat_id, p_message_id)
  returning id into v_pr;

  v_out := app.insert_items(p_user, v_pr, p_items, p_source);
  v_files := app.attach(p_user, v_pr, p_attachments);
  perform app.log(v_pr, null, p_user, 'tao_pr', null, p_source);
  return jsonb_build_object('id', v_pr, 'pr_no', v_no, 'title', coalesce(nullif(trim(p_title), ''), v_no), 'site', v_site_code,
                            'need_date', p_need_date, 'status', 'cho_duyet', 'items', v_out, 'images', v_files);
end $$;

drop function if exists public.update_pr(text, date, jsonb, text, text, text, jsonb);
drop function if exists app.update_pr(uuid, text, date, jsonb, text, text, text, jsonb);

create or replace function app.update_pr(p_user uuid, p_pr text, p_need_date date, p_items jsonb, p_title text,
  p_note text, p_delivery_place text, p_attachments jsonb, p_receiver_name text default null, p_receiver_phone text default null)
returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare v_id uuid; v record; v_role text; v_base text; v_rev int; v_no text; v_out jsonb; v_files int; v_site_code text;
begin
  v_id := app.find_pr(p_pr);
  select * into v from public.purchase_requests where id = v_id for update;
  select role into v_role from public.profiles where id = p_user and active;
  if v_role is null then raise exception 'Bạn chưa đăng nhập'; end if;
  if not (v.requested_by = p_user or v_role in ('procurement', 'admin')) then
    raise exception 'Chỉ người đặt hàng hoặc phòng vật tư mới sửa được PR';
  end if;
  if v.status in ('cho_duyet', 'tu_choi') then perform app.recall_pr(p_user, v.pr_no, 'sửa PR');
  elsif v.status <> 'thu_hoi' then raise exception 'Hãy thu hồi PR trước khi sửa';
  end if;
  if p_need_date is null then raise exception 'Thiếu ngày cần có hàng'; end if;
  if p_need_date < app.today() then raise exception 'Ngày cần có hàng % đã qua', to_char(p_need_date, 'DD/MM/YYYY'); end if;

  delete from public.pr_items where pr_id = v.id;
  v_out := app.insert_items(p_user, v.id, p_items, 'html');
  v_base := coalesce(v.base_no, regexp_replace(v.pr_no, '\.R[0-9]+$', ''));
  v_rev := coalesce(v.revision, 1) + 1;
  v_no := v_base || '.R' || v_rev;
  update public.purchase_requests
     set pr_no = v_no, base_no = v_base, revision = v_rev, need_date = p_need_date,
         title = coalesce(nullif(left(trim(p_title), 200), ''), v_no), note = nullif(trim(p_note), ''),
         delivery_place = nullif(trim(p_delivery_place), ''), receiver_name = nullif(trim(p_receiver_name), ''),
         receiver_phone = nullif(trim(p_receiver_phone), ''), status = 'cho_duyet', reject_reason = null
   where id = v.id;
  v_files := app.attach(p_user, v.id, p_attachments);
  perform app.log(v.id, null, p_user, 'sua_pr', v.pr_no, v_no);
  select code into v_site_code from public.sites where id = v.site_id;
  return jsonb_build_object('id', v.id, 'pr_no', v_no, 'title', coalesce(nullif(trim(p_title), ''), v_no), 'site', v_site_code,
                            'need_date', p_need_date, 'status', 'cho_duyet', 'items', v_out, 'images', v_files);
end $$;

create or replace function app.upsert_work_category(p_user uuid, p_code text, p_name text, p_sort int, p_active boolean) returns void
language plpgsql set search_path = public, extensions, app
as $$
declare v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
begin
  perform app.require_role(p_user, array['procurement', 'admin']);
  if v_code !~ '^[A-Z0-9]{1,6}$' then raise exception 'Mã hạng mục gồm 1–6 chữ in hoa hoặc số, vd: MEP'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Nhập tên hạng mục'; end if;
  insert into public.work_categories (code, name, sort, active) values (v_code, trim(p_name), coalesce(p_sort, 100), coalesce(p_active, true))
  on conflict (code) do update set name = excluded.name, sort = excluded.sort, active = excluded.active;
end $$;

-- Hàm public
create or replace function public.create_pr(p_site_code text, p_category text, p_need_date date, p_items jsonb,
  p_title text default null, p_note text default null, p_delivery_place text default null, p_attachments jsonb default null,
  p_receiver_name text default null, p_receiver_phone text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, app
as $$
begin
  if app.resolve_work_category(p_category) is null then raise exception 'Chọn hạng mục thi công cho PR'; end if;
  if coalesce(trim(p_delivery_place), '') = '' then raise exception 'Nhập nơi nhận hàng'; end if;
  if coalesce(trim(p_receiver_name), '') = '' or coalesce(trim(p_receiver_phone), '') = '' then raise exception 'Nhập tên và số điện thoại người nhận hàng'; end if;
  return app.create_pr(auth.uid(), p_site_code, p_need_date, p_items, p_title, p_note, p_delivery_place, 'html', p_attachments, null, null,
                       p_category, p_receiver_name, p_receiver_phone);
end $$;
create or replace function public.update_pr(p_pr text, p_need_date date, p_items jsonb, p_title text default null,
  p_note text default null, p_delivery_place text default null, p_attachments jsonb default null,
  p_receiver_name text default null, p_receiver_phone text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions, app
as $$
begin
  if coalesce(trim(p_delivery_place), '') = '' then raise exception 'Nhập nơi nhận hàng'; end if;
  if coalesce(trim(p_receiver_name), '') = '' or coalesce(trim(p_receiver_phone), '') = '' then raise exception 'Nhập tên và số điện thoại người nhận hàng'; end if;
  return app.update_pr(auth.uid(), p_pr, p_need_date, p_items, p_title, p_note, p_delivery_place, p_attachments, p_receiver_name, p_receiver_phone);
end $$;
create or replace function public.upsert_work_category(p_code text, p_name text, p_sort int default 100, p_active boolean default true) returns void
language sql security definer set search_path = public, extensions, app as $$ select app.upsert_work_category(auth.uid(), p_code, p_name, p_sort, p_active) $$;

revoke execute on all functions in schema app from public, anon, authenticated;
revoke execute on function public.create_pr(text, text, date, jsonb, text, text, text, jsonb, text, text),
  public.update_pr(text, date, jsonb, text, text, text, jsonb, text, text),
  public.upsert_work_category(text, text, int, boolean) from public, anon;
grant execute on function public.create_pr(text, text, date, jsonb, text, text, text, jsonb, text, text),
  public.update_pr(text, date, jsonb, text, text, text, jsonb, text, text),
  public.upsert_work_category(text, text, int, boolean) to authenticated;
grant execute on all functions in schema app to service_role;
grant execute on all functions in schema public to service_role;
