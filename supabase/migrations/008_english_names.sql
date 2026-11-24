-- 008: tên tiếng Anh cho danh mục (giao diện EN)
-- Trình duyệt tự dịch tên tiếng Việt chưa có bản dịch (dịch vụ MyMemory) rồi lưu lại qua set_translations.
-- Ai đang đăng nhập cũng được điền bản dịch còn trống; sửa bản dịch đã có: Phòng vật tư / Quản trị.

alter table public.materials add column if not exists name_en text, add column if not exists spec_en text;
alter table public.material_groups add column if not exists name_en text;
alter table public.material_subgroups add column if not exists name_en text;
alter table public.work_categories add column if not exists name_en text;

-- Đổi tên tiếng Việt → xoá bản dịch cũ để dịch lại
create or replace function app.trg_clear_en() returns trigger language plpgsql as $$
begin
  if NEW.name is distinct from OLD.name and NEW.name_en is not distinct from OLD.name_en then NEW.name_en := null; end if;
  if TG_TABLE_NAME = 'materials' and NEW.spec is distinct from OLD.spec and NEW.spec_en is not distinct from OLD.spec_en then NEW.spec_en := null; end if;
  return NEW;
end $$;
drop trigger if exists clear_en on public.materials;
create trigger clear_en before update on public.materials for each row execute function app.trg_clear_en();
drop trigger if exists clear_en on public.material_groups;
create trigger clear_en before update on public.material_groups for each row execute function app.trg_clear_en();
drop trigger if exists clear_en on public.material_subgroups;
create trigger clear_en before update on public.material_subgroups for each row execute function app.trg_clear_en();
drop trigger if exists clear_en on public.work_categories;
create trigger clear_en before update on public.work_categories for each row execute function app.trg_clear_en();

-- Nhật ký: không ghi lần dịch tự động (bản dịch đang trống → có); vẫn ghi khi sửa bản dịch đã có
create or replace function app.audit_trg() returns trigger
language plpgsql security definer set search_path = public, extensions, app as $$
declare
  v_old jsonb; v_new jsonb; v_row jsonb; v_diff jsonb := '{}'::jsonb; k text;
  v_actor uuid := auth.uid();
begin
  if TG_TABLE_NAME = 'profiles' and v_actor is null then return null; end if;
  if TG_OP <> 'INSERT' then v_old := to_jsonb(OLD); end if;
  if TG_OP <> 'DELETE' then v_new := to_jsonb(NEW); end if;
  v_row := coalesce(v_new, v_old);
  if TG_OP = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at', 'seq') and (v_new -> k) is distinct from (v_old -> k)
         and not (k in ('name_en', 'spec_en') and jsonb_typeof(v_old -> k) = 'null' or k in ('name_en', 'spec_en') and jsonb_typeof(v_new -> k) = 'null') then
        v_diff := v_diff || jsonb_build_object(k, jsonb_build_array(v_old -> k, v_new -> k));
      end if;
    end loop;
    if v_diff = '{}'::jsonb then return null; end if;
  else
    v_diff := v_row - 'updated_at';
  end if;
  insert into public.audit_log (actor, action, tbl, row_id, ref, parent, changes)
  values (case when exists (select 1 from public.profiles where id = v_actor) then v_actor end,
          lower(TG_OP), TG_TABLE_NAME, coalesce(v_row ->> 'id', v_row ->> 'code'),
          coalesce(v_row ->> 'pr_no', v_row ->> 'pp_no', v_row ->> 'asset_code', v_row ->> 'code',
                   v_row ->> 'email', v_row ->> 'file_name', v_row ->> 'title', v_row ->> 'name',
                   case when v_row ? 'batch_no' then 'Đợt ' || (v_row ->> 'batch_no') end,
                   case when v_row ? 'line_no' then 'Dòng ' || (v_row ->> 'line_no') end),
          coalesce(v_row ->> 'pr_id', v_row ->> 'item_id', v_row ->> 'proposal_id', v_row ->> 'material_id'),
          v_diff);
  return null;
end $$;

-- p_items: [{t: 'materials'|'material_groups'|'material_subgroups'|'work_categories', id, name_en, spec_en?}]
-- p_force = true: ghi đè bản dịch đã có (chỉ Phòng vật tư / Quản trị); '' = xoá bản dịch để dịch lại
create or replace function app.set_translations(p_user uuid, p_items jsonb, p_force boolean) returns int
language plpgsql set search_path = public, extensions, app as $$
declare it jsonb; v_n int := 0; c int; v_name text; v_spec text; v_t text; v_id text;
begin
  if p_force then perform app.require_role(p_user, array['procurement', 'admin']);
  else perform app.require_role(p_user, array['site', 'manager', 'procurement', 'admin']); end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then raise exception 'Dữ liệu không hợp lệ'; end if;
  for it in select value from jsonb_array_elements(p_items) loop
    v_t := it ->> 't'; v_id := it ->> 'id';
    v_name := left(nullif(trim(it ->> 'name_en'), ''), 300);
    v_spec := left(nullif(trim(it ->> 'spec_en'), ''), 300);
    if v_id is null then continue; end if;
    if v_t = 'materials' then
      update public.materials set
        name_en = case when p_force or name_en is null then case when it ? 'name_en' then v_name else name_en end else name_en end,
        spec_en = case when p_force or spec_en is null then case when it ? 'spec_en' then v_spec else spec_en end else spec_en end
       where id::text = v_id;
    elsif v_t = 'material_groups' then
      update public.material_groups set name_en = v_name where code = v_id and (p_force or name_en is null);
    elsif v_t = 'material_subgroups' then
      update public.material_subgroups set name_en = v_name where id::text = v_id and (p_force or name_en is null);
    elsif v_t = 'work_categories' then
      update public.work_categories set name_en = v_name where code = v_id and (p_force or name_en is null);
    else continue;
    end if;
    get diagnostics c = row_count; v_n := v_n + c;
  end loop;
  return v_n;
end $$;

create or replace function public.set_translations(p_items jsonb, p_force boolean default false) returns int
language sql security definer set search_path = public, extensions, app as $$ select app.set_translations(auth.uid(), p_items, p_force) $$;
revoke all on function public.set_translations(jsonb, boolean) from public, anon;
grant execute on function public.set_translations(jsonb, boolean) to authenticated;
