-- =====================================================================
-- 004 — Phân cấp quyền mới
--   site        Công trường : đặt hàng, theo dõi, nhận hàng, thu hồi / sửa / huỷ PR của mình, xuất PDF
--   manager     Quản lý     : như Công trường cho mọi dự án + duyệt PR + khai báo dự án / hạng mục thi công
--   procurement Phòng vật tư: (gộp Thu mua) cập nhật kho, tài sản, giao hàng, ETA, đề xuất mua
--   admin       Quản trị    : toàn quyền
-- Các hàm cũ được sửa bằng thay chuỗi trên định nghĩa hiện hành; mỗi lần thay đều được kiểm tra.
-- =====================================================================

update public.profiles set role = 'procurement' where role = 'purchasing';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('site', 'manager', 'procurement', 'admin'));

do $mig$
declare
  r record; v_def text; v_new text;
  -- hàm | chuỗi cũ | chuỗi mới
  rules text[][] := array[
    ['app.approve_pr',            $s$array['procurement', 'admin']$s$,                   $s$array['manager', 'admin']$s$],
    ['app.upsert_site',           $s$array['procurement', 'admin']$s$,                   $s$array['manager', 'admin']$s$],
    ['app.upsert_work_category',  $s$array['procurement', 'admin']$s$,                   $s$array['manager', 'admin']$s$],
    ['app.create_pr',             $s$array['site', 'procurement', 'purchasing', 'admin']$s$, $s$array['site', 'manager', 'admin']$s$],
    ['app.recall_pr',             $s$v_role in ('procurement', 'admin')$s$,              $s$v_role in ('manager', 'admin')$s$],
    ['app.recall_pr',             'người đặt hàng hoặc phòng vật tư',                     'người đặt hàng hoặc quản lý'],
    ['app.update_pr',             $s$v_role in ('procurement', 'admin')$s$,              $s$v_role in ('manager', 'admin')$s$],
    ['app.update_pr',             'người đặt hàng hoặc phòng vật tư',                     'người đặt hàng hoặc quản lý'],
    -- Quản lý huỷ được PR khi chưa có hàng đi đường; quản trị huỷ được đến trước khi nhận đủ
    ['app.cancel_pr',             $s$(v_role in ('procurement', 'admin') and v_st not in ('da_ve', 'huy'))$s$,
                                  $s$(v_role = 'manager' and v_st in ('cho_duyet', 'thu_hoi', 'tu_choi', 'da_duyet', 'da_dat')) or (v_role = 'admin' and v_st not in ('da_ve', 'huy'))$s$],
    ['app.confirm_receipt',       $s$v_role in ('procurement', 'admin')$s$,              $s$v_role in ('manager', 'procurement', 'admin')$s$],
    ['public.add_attachments',    $s$array['procurement', 'admin']$s$,                   $s$array['manager', 'procurement', 'admin']$s$],
    ['public.add_attachments',    $s$array['site', 'procurement', 'purchasing', 'admin']$s$, $s$array['site', 'manager', 'procurement', 'admin']$s$],
    ['app.update_proposal',       $s$array['purchasing', 'procurement', 'admin']$s$,     $s$array['procurement', 'admin']$s$],
    ['app.update_proposal_line',  $s$array['purchasing', 'procurement', 'admin']$s$,     $s$array['procurement', 'admin']$s$],
    ['app.update_proposal',       $s$case when v_role = 'purchasing' then p_user else handled_by end$s$, $s$coalesce(handled_by, p_user)$s$]
  ];
  i int; v_oid oid;
begin
  for i in 1 .. array_length(rules, 1) loop
    select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname || '.' || p.proname = rules[i][1];
    if v_oid is null then raise exception 'Không thấy hàm %', rules[i][1]; end if;
    v_def := pg_get_functiondef(v_oid);
    if position(rules[i][3] in v_def) > 0 and position(rules[i][2] in v_def) = 0 then continue; end if;  -- đã áp dụng
    v_new := replace(v_def, rules[i][2], rules[i][3]);
    if v_new = v_def then raise exception 'Hàm % không chứa "%"', rules[i][1], rules[i][2]; end if;
    execute v_new;
  end loop;
end $mig$;

revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
