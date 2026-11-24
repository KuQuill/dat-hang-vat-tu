-- 007: xoá dự án / hạng mục thi công (chỉ khi chưa có dữ liệu gắn vào — có rồi thì chuyển "Ngừng"/"Ẩn")
-- Xoá tài khoản nằm trong Edge Function admin-users (cần service role để xoá auth.users).

create or replace function app.delete_site(p_user uuid, p_id uuid) returns text
language plpgsql set search_path = public, extensions, app as $$
declare v_code text; v_n int;
begin
  perform app.require_role(p_user, array['manager', 'admin']);
  select code into v_code from public.sites where id = p_id;
  if v_code is null then raise exception 'Không tìm thấy dự án'; end if;
  select count(*) into v_n from public.purchase_requests where site_id = p_id;
  if v_n > 0 then raise exception 'Dự án % đã có % PR — không xoá được. Hãy chuyển trạng thái sang "Ngừng" để ẩn.', v_code, v_n; end if;
  if exists (select 1 from public.pr_items i, jsonb_array_elements(i.alloc) a where i.alloc is not null and (a ->> 'site_id')::uuid = p_id) then
    raise exception 'Dự án % đang được xưởng chia hàng trong PR — không xoá được. Hãy chuyển sang "Ngừng".', v_code;
  end if;
  if exists (select 1 from public.stock where site_id = p_id) then
    raise exception 'Dự án % còn dòng tồn kho — chuyển hết tồn kho đi trước, hoặc chuyển sang "Ngừng".', v_code;
  end if;
  if exists (select 1 from public.assets where site_id = p_id) then
    raise exception 'Dự án % còn tài sản / thiết bị — chuyển tài sản đi trước, hoặc chuyển sang "Ngừng".', v_code;
  end if;
  update public.profiles set site_id = null where site_id = p_id; -- nhân sự của dự án → bỏ gán dự án
  delete from public.sites where id = p_id;
  return v_code;
end $$;

create or replace function app.delete_work_category(p_user uuid, p_code text) returns void
language plpgsql set search_path = public, extensions, app as $$
declare v_code text := upper(trim(coalesce(p_code, ''))); v_n int;
begin
  perform app.require_role(p_user, array['manager', 'admin']);
  if not exists (select 1 from public.work_categories where code = v_code) then raise exception 'Không tìm thấy hạng mục %', v_code; end if;
  select count(*) into v_n from public.purchase_requests where category = v_code;
  if v_n > 0 then raise exception 'Hạng mục % đã dùng trong % PR — không xoá được. Hãy chuyển sang "Ẩn khỏi danh sách đặt hàng".', v_code, v_n; end if;
  delete from public.work_categories where code = v_code;
end $$;

create or replace function public.delete_site(p_id uuid) returns text
language sql security definer set search_path = public, extensions, app as $$ select app.delete_site(auth.uid(), p_id) $$;
create or replace function public.delete_work_category(p_code text) returns void
language sql security definer set search_path = public, extensions, app as $$ select app.delete_work_category(auth.uid(), p_code) $$;

revoke all on function public.delete_site(uuid), public.delete_work_category(text) from public, anon;
grant execute on function public.delete_site(uuid), public.delete_work_category(text) to authenticated;
