-- =====================================================================
-- 005 — Xưởng nội thất: đặt hàng 1 lần cho nhiều dự án
--   sites.is_workshop   : dự án là xưởng (đặt hàng về xưởng để sản xuất)
--   pr_items.alloc      : chia số lượng của dòng cho các dự án [{site_id, qty}];
--                         phần còn lại (nếu có) = dự phòng của xưởng
-- =====================================================================

alter table public.sites    add column if not exists is_workshop boolean not null default false;
alter table public.pr_items add column if not exists alloc jsonb;

-- Chuẩn hoá phần chia: nhận [{site:'SSD', qty:60}] hoặc [{site_id:'…', qty:60}]
create or replace function app.parse_alloc(p_pr uuid, p_line int, p_qty numeric, p_alloc jsonb) returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare v_ws boolean; a jsonb; v_site uuid; v_code text; v_q numeric; v_sum numeric := 0; v_map jsonb := '{}'::jsonb; v_out jsonb := '[]'::jsonb; k text;
begin
  if p_alloc is null or jsonb_typeof(p_alloc) <> 'array' or jsonb_array_length(p_alloc) = 0 then return null; end if;
  select s.is_workshop into v_ws from public.purchase_requests r join public.sites s on s.id = r.site_id where r.id = p_pr;
  if not coalesce(v_ws, false) then raise exception 'Dòng %: chỉ PR của xưởng mới chia số lượng cho dự án', p_line; end if;
  for a in select value from jsonb_array_elements(p_alloc) loop
    begin v_q := (a ->> 'qty')::numeric; exception when others then raise exception 'Dòng %: số lượng chia "%" không hợp lệ', p_line, a ->> 'qty'; end;
    if v_q is null or v_q = 0 then continue; end if;
    if v_q < 0 then raise exception 'Dòng %: số lượng chia phải lớn hơn 0', p_line; end if;
    if nullif(a ->> 'site_id', '') is not null then
      select id, code into v_site, v_code from public.sites where id = (a ->> 'site_id')::uuid and active and not is_workshop;
    else
      select id, code into v_site, v_code from public.sites where upper(code) = upper(trim(a ->> 'site')) and active and not is_workshop;
    end if;
    if v_site is null then raise exception 'Dòng %: dự án "%" không tồn tại hoặc đã ngừng', p_line, coalesce(a ->> 'site', a ->> 'site_id'); end if;
    v_map := jsonb_set(v_map, array[v_site::text], to_jsonb(coalesce((v_map ->> v_site::text)::numeric, 0) + v_q));
    v_sum := v_sum + v_q;
  end loop;
  if v_sum > p_qty then raise exception 'Dòng %: tổng chia cho các dự án (%) vượt số lượng đặt (%)', p_line, v_sum, p_qty; end if;
  for k in select jsonb_object_keys(v_map) loop
    v_out := v_out || jsonb_build_array(jsonb_build_object('site_id', k::uuid, 'qty', (v_map ->> k)::numeric));
  end loop;
  return nullif(v_out, '[]'::jsonb);
end $$;

create or replace function app.insert_items(p_user uuid, p_pr uuid, p_items jsonb, p_source text) returns jsonb
language plpgsql set search_path = public, extensions, app
as $$
declare v_line int := 0; it jsonb; v_mat jsonb; v_qty numeric; v_unit text; v_out jsonb := '[]'::jsonb; v_alloc jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Đơn hàng chưa có dòng vật tư nào'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Tối đa 200 dòng mỗi PR'; end if;
  for it in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1; v_mat := null;
    begin v_qty := (it ->> 'qty')::numeric; exception when others then raise exception 'Dòng %: số lượng "%" không hợp lệ', v_line, it ->> 'qty'; end;
    if v_qty is null or v_qty <= 0 then raise exception 'Dòng %: số lượng phải lớn hơn 0', v_line; end if;
    v_alloc := app.parse_alloc(p_pr, v_line, v_qty, it -> 'alloc');
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
    insert into public.pr_items (pr_id, line_no, material_id, qty, unit, note, alloc)
    values (p_pr, v_line, (v_mat ->> 'id')::uuid, v_qty, v_unit, nullif(trim(it ->> 'note'), ''), v_alloc);
    v_out := v_out || jsonb_build_array(v_mat || jsonb_build_object('line', v_line, 'qty', v_qty, 'unit', v_unit, 'input_name', it ->> 'name', 'alloc', v_alloc));
  end loop;
  return v_out;
end $$;

-- Khai báo dự án: thêm cờ "là xưởng"
drop function if exists public.upsert_site(uuid, text, text, text, text, boolean);
drop function if exists app.upsert_site(uuid, uuid, text, text, text, text, boolean);

create or replace function app.upsert_site(p_user uuid, p_id uuid, p_code text, p_name text, p_address text, p_manager text,
  p_active boolean, p_is_workshop boolean default null)
returns uuid
language plpgsql set search_path = public, extensions, app
as $$
declare v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')); v_id uuid; v_old text; v_old_ws boolean;
begin
  perform app.require_role(p_user, array['manager', 'admin']);
  if v_code !~ '^[A-Z0-9-]{2,15}$' then raise exception 'Mã dự án gồm 2–15 ký tự chữ in hoa / số / gạch ngang, vd: SSD'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Nhập tên dự án'; end if;
  if exists (select 1 from public.sites where upper(code) = v_code and id is distinct from p_id) then
    raise exception 'Mã dự án % đã tồn tại', v_code;
  end if;
  if p_id is null then
    insert into public.sites (code, name, address, manager, active, is_workshop)
    values (v_code, trim(p_name), nullif(trim(p_address), ''), nullif(trim(p_manager), ''), coalesce(p_active, true), coalesce(p_is_workshop, false))
    returning id into v_id;
  else
    select code, is_workshop into v_old, v_old_ws from public.sites where id = p_id;
    if v_old is null then raise exception 'Không tìm thấy dự án'; end if;
    if v_old <> v_code and exists (select 1 from public.purchase_requests where site_id = p_id) then
      raise exception 'Dự án đã có PR, không đổi được mã (mã nằm trong số PR)';
    end if;
    if p_is_workshop is not null and p_is_workshop <> v_old_ws then
      if not p_is_workshop and exists (select 1 from public.pr_items i join public.purchase_requests r on r.id = i.pr_id
                                        where r.site_id = p_id and i.alloc is not null and r.status <> 'huy') then
        raise exception 'Xưởng đã có PR chia theo dự án — không bỏ đánh dấu xưởng được';
      end if;
      if p_is_workshop and exists (select 1 from public.pr_items i, jsonb_array_elements(i.alloc) a
                                    join public.purchase_requests r on true
                                   where r.id = i.pr_id and r.status <> 'huy' and (a ->> 'site_id')::uuid = p_id) then
        raise exception 'Dự án này đang được xưởng đặt hàng cho — không chuyển thành xưởng được';
      end if;
    end if;
    update public.sites set code = v_code, name = trim(p_name), address = nullif(trim(p_address), ''),
           manager = nullif(trim(p_manager), ''), active = coalesce(p_active, active), is_workshop = coalesce(p_is_workshop, is_workshop)
     where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.upsert_site(p_id uuid, p_code text, p_name text, p_address text default null, p_manager text default null,
  p_active boolean default true, p_is_workshop boolean default null) returns uuid
language sql security definer set search_path = public, extensions, app
as $$ select app.upsert_site(auth.uid(), p_id, p_code, p_name, p_address, p_manager, p_active, p_is_workshop) $$;

revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
revoke execute on function public.upsert_site(uuid, text, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.upsert_site(uuid, text, text, text, text, boolean, boolean) to authenticated, service_role;
