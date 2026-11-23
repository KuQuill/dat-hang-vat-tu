-- =====================================================================
-- 002 — Mã PR theo dự án, thu hồi & sửa PR, khai báo dự án / công trường
--   Mã PR: <MÃ DỰ ÁN>.<HẠNG MỤC>.PR<số>.R<lần sửa>   vd: SSD.MEP.PR01.R1
--   Thu hồi PR (đặt nhầm) → sửa → gửi lại thành R2, R3…
-- =====================================================================

alter table public.purchase_requests
  add column if not exists category text,
  add column if not exists base_no  text,
  add column if not exists revision int not null default 1;
alter table public.purchase_requests alter column title drop not null;
alter table public.purchase_requests drop constraint if exists purchase_requests_status_check;
alter table public.purchase_requests add constraint purchase_requests_status_check
  check (status in ('cho_duyet', 'da_duyet', 'tu_choi', 'da_dat', 'dang_giao', 'co_van_de', 'da_ve', 'huy', 'thu_hoi'));
create index if not exists pr_base_no_idx on public.purchase_requests (base_no);

-- Số gốc của PR: <mã dự án>.<hạng mục>.PR<nn> — đếm riêng theo dự án + hạng mục
create or replace function app.next_pr_base(p_site uuid, p_cat text) returns text
language plpgsql set search_path = public, extensions, app
as $$
declare v_code text; n int;
begin
  select code into v_code from public.sites where id = p_site;
  insert into public.doc_counters (kind, year, seq) values ('PR:' || v_code || '.' || p_cat, 0, 1)
  on conflict (kind, year) do update set seq = public.doc_counters.seq + 1
  returning seq into n;
  return v_code || '.' || p_cat || '.PR' || lpad(n::text, 2, '0');
end $$;

-- Nhận mã PR đầy đủ (SSD.MEP.PR01.R2), mã gốc (SSD.MEP.PR01 → bản mới nhất) hoặc số cũ (PR-2026-0001, 153)
create or replace function app.find_pr(p text) returns uuid
language plpgsql stable set search_path = public, extensions, app
as $$
declare s text := upper(regexp_replace(coalesce(p, ''), '\s', '', 'g')); v uuid;
begin
  select id into v from public.purchase_requests where upper(pr_no) = s;
  if v is null then
    select id into v from public.purchase_requests where upper(base_no) = s order by revision desc limit 1;
  end if;
  if v is null and s ~ '^[0-9]+$' then
    select id into v from public.purchase_requests where pr_no = 'PR-' || extract(year from app.today())::int || '-' || lpad(s, 4, '0');
  end if;
  if v is null then raise exception 'Không tìm thấy phiếu %', s; end if;
  return v;
end $$;

-- Thêm các dòng vật tư cho 1 PR (dùng chung cho tạo mới & sửa)
create or replace function app.insert_items(p_user uuid, p_pr uuid, p_items jsonb, p_source text) returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare v_line int := 0; it jsonb; v_mat jsonb; v_qty numeric; v_unit text; v_out jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Đơn hàng chưa có dòng vật tư nào'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Tối đa 200 dòng mỗi PR'; end if;
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
    values (p_pr, v_line, (v_mat ->> 'id')::uuid, v_qty, v_unit, nullif(trim(it ->> 'note'), ''));
    v_out := v_out || jsonb_build_array(v_mat || jsonb_build_object('line', v_line, 'qty', v_qty, 'unit', v_unit, 'input_name', it ->> 'name'));
  end loop;
  return v_out;
end $$;

drop function if exists public.create_pr(text, date, jsonb, text, text, text, jsonb);
drop function if exists app.create_pr(uuid, text, date, jsonb, text, text, text, text, jsonb, bigint, bigint);

create or replace function app.create_pr(
  p_user uuid, p_site_code text, p_need_date date, p_items jsonb,
  p_title text, p_note text, p_delivery_place text, p_source text,
  p_attachments jsonb default null, p_chat_id bigint default null, p_message_id bigint default null,
  p_category text default null)
returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare v_site uuid; v_site_code text; v_pr uuid; v_base text; v_no text; v_cat text; v_out jsonb; v_files int;
begin
  perform app.require_role(p_user, array['site', 'procurement', 'purchasing', 'admin']);
  select id, code into v_site, v_site_code from public.sites where upper(code) = upper(trim(p_site_code)) and active;
  if v_site is null then raise exception 'Không tìm thấy dự án / công trường "%"', p_site_code; end if;
  v_cat := coalesce(app.resolve_group(p_category), 'K');
  if p_need_date is null then raise exception 'Thiếu ngày cần hàng'; end if;
  if p_need_date < app.today() then raise exception 'Ngày cần hàng % đã qua', to_char(p_need_date, 'DD/MM/YYYY'); end if;

  v_base := app.next_pr_base(v_site, v_cat);
  v_no := v_base || '.R1';
  insert into public.purchase_requests (pr_no, base_no, revision, category, title, site_id, requested_by, need_date, note, delivery_place, source, tg_chat_id, tg_message_id)
  values (v_no, v_base, 1, v_cat, coalesce(nullif(left(trim(p_title), 200), ''), v_no), v_site, p_user, p_need_date,
          nullif(trim(p_note), ''), nullif(trim(p_delivery_place), ''), p_source, p_chat_id, p_message_id)
  returning id into v_pr;

  v_out := app.insert_items(p_user, v_pr, p_items, p_source);
  v_files := app.attach(p_user, v_pr, p_attachments);
  perform app.log(v_pr, null, p_user, 'tao_pr', null, p_source);
  return jsonb_build_object('id', v_pr, 'pr_no', v_no, 'title', coalesce(nullif(trim(p_title), ''), v_no), 'site', v_site_code,
                            'need_date', p_need_date, 'status', 'cho_duyet', 'items', v_out, 'images', v_files);
end $$;

-- Thu hồi PR (đặt nhầm) để sửa: nhả hàng đang giữ ở kho, xoá kế hoạch giao, chuyển sang "đã thu hồi"
create or replace function app.recall_pr(p_user uuid, p_pr text, p_reason text) returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare v_id uuid; v record; v_role text;
begin
  v_id := app.find_pr(p_pr);
  select * into v from public.purchase_requests where id = v_id for update;
  select role into v_role from public.profiles where id = p_user and active;
  if v_role is null then raise exception 'Bạn chưa đăng nhập'; end if;
  if not (v.requested_by = p_user or v_role in ('procurement', 'admin')) then
    raise exception 'Chỉ người đặt hàng hoặc phòng vật tư mới thu hồi được PR';
  end if;
  if v.status = 'thu_hoi' then return public.track_pr(v.pr_no); end if;
  if v.status not in ('cho_duyet', 'tu_choi', 'da_duyet', 'da_dat') then
    raise exception 'PR đang giao, đã nhận hoặc đã đóng — không thu hồi được, hãy liên hệ phòng vật tư';
  end if;
  if exists (select 1 from public.pr_deliveries d join public.pr_items i on i.id = d.item_id
             where i.pr_id = v.id and d.status in ('dang_giao', 'da_ve', 'co_van_de')) then
    raise exception 'PR đã có đợt đang giao hoặc đã nhận — không thu hồi được';
  end if;
  if exists (select 1 from public.proposal_line_batches l join public.pr_deliveries d on d.id = l.delivery_id
             join public.pr_items i on i.id = d.item_id join public.proposal_lines pl on pl.id = l.line_id
             join public.purchase_proposals pp on pp.id = pl.proposal_id
             where i.pr_id = v.id and pp.status in ('dang_mua', 'da_mua')) then
    raise exception 'Thu mua đang mua hàng cho PR này — liên hệ phòng vật tư trước khi thu hồi';
  end if;
  delete from public.pr_deliveries where item_id in (select id from public.pr_items where pr_id = v.id);
  update public.pr_items set status = 'cho_xu_ly', eta = null, received_date = null, qty_received = 0, supplier = null, po_no = null
   where pr_id = v.id;
  update public.purchase_requests
     set status = 'thu_hoi', approved_by = null, approved_at = null, reject_reason = nullif(trim(p_reason), '')
   where id = v.id;
  perform app.log(v.id, null, p_user, 'thu_hoi', v.status, coalesce(nullif(trim(p_reason), ''), 'thu hồi để sửa'));
  return public.track_pr(v.pr_no);
end $$;

-- Sửa PR đã thu hồi (hoặc đang chờ duyệt / bị từ chối) và gửi lại → tăng số R
create or replace function app.update_pr(p_user uuid, p_pr text, p_need_date date, p_items jsonb, p_title text,
  p_note text, p_delivery_place text, p_attachments jsonb)
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
  if p_need_date is null then raise exception 'Thiếu ngày cần hàng'; end if;
  if p_need_date < app.today() then raise exception 'Ngày cần hàng % đã qua', to_char(p_need_date, 'DD/MM/YYYY'); end if;

  delete from public.pr_items where pr_id = v.id;
  v_out := app.insert_items(p_user, v.id, p_items, 'html');
  v_base := coalesce(v.base_no, regexp_replace(v.pr_no, '\.R[0-9]+$', ''));
  v_rev := coalesce(v.revision, 1) + 1;
  v_no := v_base || '.R' || v_rev;
  update public.purchase_requests
     set pr_no = v_no, base_no = v_base, revision = v_rev, need_date = p_need_date,
         title = coalesce(nullif(left(trim(p_title), 200), ''), v_no), note = nullif(trim(p_note), ''),
         delivery_place = nullif(trim(p_delivery_place), ''), status = 'cho_duyet', reject_reason = null
   where id = v.id;
  v_files := app.attach(p_user, v.id, p_attachments);
  perform app.log(v.id, null, p_user, 'sua_pr', v.pr_no, v_no);
  select code into v_site_code from public.sites where id = v.site_id;
  return jsonb_build_object('id', v.id, 'pr_no', v_no, 'title', coalesce(nullif(trim(p_title), ''), v_no), 'site', v_site_code,
                            'need_date', p_need_date, 'status', 'cho_duyet', 'items', v_out, 'images', v_files);
end $$;

-- Huỷ: người đặt huỷ được khi chờ duyệt hoặc đã thu hồi
create or replace function app.cancel_pr(p_user uuid, p_pr text, p_reason text) returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare v_pr uuid; v_no text; v_st text; v_owner uuid; v_role text; r record;
begin
  v_pr := app.find_pr(p_pr);
  select status, requested_by, pr_no into v_st, v_owner, v_no from public.purchase_requests where id = v_pr for update;
  select role into v_role from public.profiles where id = p_user and active;
  if v_role is null then raise exception 'Bạn chưa đăng nhập'; end if;
  if not ((v_owner = p_user and v_st in ('cho_duyet', 'thu_hoi', 'tu_choi')) or (v_role in ('procurement', 'admin') and v_st not in ('da_ve', 'huy'))) then
    raise exception 'Không thể huỷ phiếu ở trạng thái hiện tại';
  end if;
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

-- Khai báo / sửa dự án (công trường)
create or replace function app.upsert_site(p_user uuid, p_id uuid, p_code text, p_name text, p_address text, p_manager text, p_active boolean)
returns uuid
language plpgsql set search_path = public, extensions, app
as $$
declare v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')); v_id uuid; v_old text;
begin
  perform app.require_role(p_user, array['procurement', 'admin']);
  if v_code !~ '^[A-Z0-9-]{2,15}$' then raise exception 'Mã dự án gồm 2–15 ký tự chữ in hoa / số / gạch ngang, vd: SSD'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Nhập tên dự án'; end if;
  if exists (select 1 from public.sites where upper(code) = v_code and id is distinct from p_id) then
    raise exception 'Mã dự án % đã tồn tại', v_code;
  end if;
  if p_id is null then
    insert into public.sites (code, name, address, manager, active)
    values (v_code, trim(p_name), nullif(trim(p_address), ''), nullif(trim(p_manager), ''), coalesce(p_active, true))
    returning id into v_id;
  else
    select code into v_old from public.sites where id = p_id;
    if v_old is null then raise exception 'Không tìm thấy dự án'; end if;
    if v_old <> v_code and exists (select 1 from public.purchase_requests where site_id = p_id) then
      raise exception 'Dự án đã có PR, không đổi được mã (mã nằm trong số PR)';
    end if;
    update public.sites set code = v_code, name = trim(p_name), address = nullif(trim(p_address), ''),
           manager = nullif(trim(p_manager), ''), active = coalesce(p_active, active)
     where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

-- Hàm public
create or replace function public.create_pr(p_site_code text, p_category text, p_need_date date, p_items jsonb,
  p_title text default null, p_note text default null, p_delivery_place text default null, p_attachments jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, app
as $$
begin
  if app.resolve_group(p_category) is null then raise exception 'Chọn hạng mục cho PR'; end if;
  if coalesce(trim(p_delivery_place), '') = '' then raise exception 'Nhập nơi nhận hàng'; end if;
  return app.create_pr(auth.uid(), p_site_code, p_need_date, p_items, p_title, p_note, p_delivery_place, 'html', p_attachments, null, null, p_category);
end $$;
create or replace function public.recall_pr(p_pr text, p_reason text default null) returns jsonb
language sql security definer set search_path = public, extensions, app as $$ select app.recall_pr(auth.uid(), p_pr, p_reason) $$;
create or replace function public.update_pr(p_pr text, p_need_date date, p_items jsonb, p_title text default null,
  p_note text default null, p_delivery_place text default null, p_attachments jsonb default null) returns jsonb
language plpgsql security definer set search_path = public, extensions, app
as $$
begin
  if coalesce(trim(p_delivery_place), '') = '' then raise exception 'Nhập nơi nhận hàng'; end if;
  return app.update_pr(auth.uid(), p_pr, p_need_date, p_items, p_title, p_note, p_delivery_place, p_attachments);
end $$;
create or replace function public.upsert_site(p_id uuid, p_code text, p_name text, p_address text default null,
  p_manager text default null, p_active boolean default true) returns uuid
language sql security definer set search_path = public, extensions, app as $$ select app.upsert_site(auth.uid(), p_id, p_code, p_name, p_address, p_manager, p_active) $$;
create or replace function public.cancel_pr(p_pr text, p_reason text default null) returns jsonb
language sql security definer set search_path = public, extensions, app as $$ select app.cancel_pr(auth.uid(), p_pr, p_reason) $$;

revoke execute on all functions in schema app from public, anon, authenticated;
revoke execute on function public.create_pr(text, text, date, jsonb, text, text, text, jsonb),
  public.recall_pr(text, text), public.update_pr(text, date, jsonb, text, text, text, jsonb),
  public.upsert_site(uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.create_pr(text, text, date, jsonb, text, text, text, jsonb),
  public.recall_pr(text, text), public.update_pr(text, date, jsonb, text, text, text, jsonb),
  public.upsert_site(uuid, text, text, text, text, boolean), public.cancel_pr(text, text) to authenticated;
grant execute on all functions in schema app to service_role;
grant execute on all functions in schema public to service_role;
