-- 006: Nhật ký hoạt động (audit log) — chỉ tài khoản Quản trị được xem
-- Mỗi lần thêm / sửa / xoá dữ liệu ở các bảng chính đều được trigger ghi lại: ai, lúc nào, bảng nào, trường nào đổi từ gì sang gì.
-- Đăng nhập được ghi qua public.log_login(); thao tác tài khoản (Edge Function admin-users) tự ghi kèm người thực hiện.

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid references public.profiles(id) on delete set null,
  action     text not null,          -- insert | update | delete | login | user_create | user_update | user_reset_pw
  tbl        text,                   -- bảng bị tác động
  row_id     text,                   -- khoá của dòng
  ref        text,                   -- mã dễ đọc: số PR, mã vật tư, email…
  parent     text,                   -- pr_id / item_id … để giao diện ghép số PR
  changes    jsonb                   -- update: {trường: [cũ, mới]}; insert/delete: toàn bộ dòng
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor, at desc);
create index if not exists audit_log_tbl_idx on public.audit_log (tbl, at desc);

alter table public.audit_log enable row level security;
drop policy if exists "admin_doc" on public.audit_log;
create policy "admin_doc" on public.audit_log for select to authenticated using (public.is_admin());
-- Không có policy ghi: chỉ trigger / hàm security definer / service role mới ghi được, không ai sửa hoặc xoá qua API
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

create or replace function app.audit_trg() returns trigger
language plpgsql security definer set search_path = public, extensions, app
as $$
declare
  v_old jsonb; v_new jsonb; v_row jsonb; v_diff jsonb := '{}'::jsonb; k text;
  v_actor uuid := auth.uid();
begin
  -- Hồ sơ người dùng do Edge Function (service role) sửa → hàm đó tự ghi nhật ký kèm người thực hiện
  if TG_TABLE_NAME = 'profiles' and v_actor is null then return null; end if;
  if TG_OP <> 'INSERT' then v_old := to_jsonb(OLD); end if;
  if TG_OP <> 'DELETE' then v_new := to_jsonb(NEW); end if;
  v_row := coalesce(v_new, v_old);
  if TG_OP = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at', 'seq') and (v_new -> k) is distinct from (v_old -> k) then
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
revoke all on function app.audit_trg() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['sites', 'profiles', 'work_categories', 'material_groups', 'material_subgroups', 'materials',
                           'stock', 'assets', 'purchase_requests', 'pr_items', 'pr_deliveries', 'pr_attachments',
                           'purchase_proposals', 'proposal_lines'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists zz_audit on public.%I', t);
      execute format('create trigger zz_audit after insert or update or delete on public.%I for each row execute function app.audit_trg()', t);
    end if;
  end loop;
end $$;

-- Ghi lần đăng nhập (giao diện gọi ngay sau khi đăng nhập thành công)
create or replace function public.log_login() returns void
language plpgsql security definer set search_path = public, extensions, app
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then return; end if;
  -- chống ghi trùng khi tải lại trang liên tục
  if exists (select 1 from public.audit_log where actor = auth.uid() and action = 'login' and at > now() - interval '2 minutes') then return; end if;
  insert into public.audit_log (actor, action, ref) select auth.uid(), 'login', email from public.profiles where id = auth.uid();
end $$;
revoke all on function public.log_login() from public, anon;
grant execute on function public.log_login() to authenticated;
