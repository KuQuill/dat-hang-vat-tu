-- 009: thuộc tính vật tư để lọc / báo cáo kho: độ dày, phân loại (melamine, laminate, ván thô…), mã phủ.
-- Để trống thì giao diện tự đoán từ tên / quy cách (vd "MDF 17MM PHỦ MELAMINE 2 MẶT 104").
alter table public.materials
  add column if not exists thickness text,
  add column if not exists kind text,
  add column if not exists coat_code text;

create or replace function app.update_material_attrs(p_user uuid, p_id uuid, p_fields jsonb) returns void
language plpgsql set search_path = public, extensions, app as $$
begin
  perform app.require_role(p_user, array['procurement', 'admin']);
  if not exists (select 1 from public.materials where id = p_id) then raise exception 'Vật tư không tồn tại'; end if;
  update public.materials set
    thickness = case when p_fields ? 'thickness' then left(nullif(trim(p_fields ->> 'thickness'), ''), 20) else thickness end,
    kind      = case when p_fields ? 'kind'      then left(nullif(trim(p_fields ->> 'kind'), ''), 60) else kind end,
    coat_code = case when p_fields ? 'coat_code' then left(nullif(trim(p_fields ->> 'coat_code'), ''), 60) else coat_code end
   where id = p_id;
end $$;

create or replace function public.update_material_attrs(p_id uuid, p_fields jsonb) returns void
language sql security definer set search_path = public, extensions, app as $$ select app.update_material_attrs(auth.uid(), p_id, p_fields) $$;
revoke all on function public.update_material_attrs(uuid, jsonb) from public, anon;
grant execute on function public.update_material_attrs(uuid, jsonb) to authenticated;
