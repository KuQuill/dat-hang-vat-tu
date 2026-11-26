-- 010: nhập kho bằng file đã đặt sẵn mã mới (vd MEP-0006).
--  * Mã chưa có trên hệ thống, đúng dạng <mã nhóm>-<số> và nhóm tồn tại → tạo vật tư với đúng mã đó
--    (không dò tên gần giống, tránh gộp nhầm "Co PVC Ø55" vào "Co PVC Ø60"); số thứ tự của nhóm được đẩy lên tương ứng.
--  * Mã đã có nhưng tên trong file khác hẳn tên trên hệ thống → báo lỗi dòng đó thay vì ghi nhầm vào vật tư khác.
--  * Nhóm MM (Máy móc) chuyển sang quản lý theo số lượng (máy cầm tay quản lý theo mẫu máy); CG (Cơ giới) vẫn từng chiếc.

create or replace function app.name_overlap(a text, b text) returns numeric
language sql immutable set search_path = public, extensions, app as $$
  with ta as (select distinct t from unnest(regexp_split_to_array(app.norm(a), '[^a-z0-9]+')) t where length(t) >= 2),
       tb as (select distinct t from unnest(regexp_split_to_array(app.norm(b), '[^a-z0-9]+')) t where length(t) >= 2)
  select case when (select count(*) from ta) = 0 then 1
              else (select count(*) from ta where t in (select t from tb))::numeric / (select count(*) from ta) end
$$;

-- Tìm vật tư theo mã; tạo mới đúng mã nếu chưa có. Trả về null nếu mã không đúng dạng (để dùng cách cũ).
create or replace function app.material_by_code(p_user uuid, p_code text, p_name text, p_spec text, p_unit text, p_subgroup text)
returns jsonb language plpgsql set search_path = public, extensions, app as $$
declare v_code text := upper(trim(coalesce(p_code, ''))); m record; v_grp text; v_num int; v_sub uuid; v_id uuid;
begin
  if v_code = '' then return null; end if;
  select id, code, name into m from public.materials where upper(code) = v_code;
  if found then
    if coalesce(trim(p_name), '') <> '' and app.name_overlap(p_name, m.name) < 0.5 and app.name_overlap(m.name, p_name) < 0.5 then
      raise exception 'Mã % trên hệ thống là "%", khác tên trong file "%"', m.code, m.name, trim(p_name);
    end if;
    return jsonb_build_object('id', m.id, 'code', m.code, 'created', false);
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'không có mã %', v_code; end if;
  if v_code !~ '^[A-Z]{1,4}-[0-9]{3,6}$' then return null; end if;
  v_grp := split_part(v_code, '-', 1); v_num := split_part(v_code, '-', 2)::int;
  if not exists (select 1 from public.material_groups where code = v_grp) then return null; end if;
  if coalesce(trim(p_unit), '') = '' then raise exception 'Vật tư mới "%" cần có đơn vị tính', p_name; end if;
  if nullif(trim(p_subgroup), '') is not null then
    select id into v_sub from public.material_subgroups where group_code = v_grp and app.norm(name) = app.norm(p_subgroup);
  end if;
  insert into public.materials (code, name, spec, unit, group_code, subgroup_id, is_new, created_by, created_via)
  values (v_code, trim(p_name), nullif(trim(p_spec), ''), trim(p_unit), v_grp, v_sub, false, p_user, 'import')
  returning id into v_id;
  update public.material_groups set seq = greatest(seq, v_num) where code = v_grp;
  return jsonb_build_object('id', v_id, 'code', v_code, 'created', true);
end $$;

create or replace function app.set_stock(p_user uuid, p_rows jsonb, p_mode text, p_reason text) returns jsonb
language plpgsql set search_path = public, extensions, app as $$
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
        v_mat := app.material_by_code(p_user, r ->> 'code', r ->> 'name', r ->> 'spec', r ->> 'unit', r ->> 'subgroup');
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

-- Tài sản (từng chiếc): cùng cách xử lý mã mới
create or replace function app.save_asset(p_user uuid, p jsonb) returns jsonb
language plpgsql set search_path = public, extensions, app as $$
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
    v_mat := app.material_by_code(p_user, p ->> 'code', p ->> 'name', p ->> 'spec', coalesce(nullif(p ->> 'unit', ''), 'chiếc'), p ->> 'subgroup');
    v_mid := (v_mat ->> 'id')::uuid;
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

-- Máy móc quản lý theo số lượng (chỉ đổi khi nhóm chưa có tồn / tài sản)
update public.material_groups set kind = 'so_luong'
 where code = 'MM' and kind = 'tung_cai'
   and not exists (select 1 from public.stock s join public.materials m on m.id = s.material_id where m.group_code = 'MM')
   and not exists (select 1 from public.assets a join public.materials m on m.id = a.material_id where m.group_code = 'MM');
