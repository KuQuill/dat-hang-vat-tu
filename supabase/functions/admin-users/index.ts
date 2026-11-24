// Edge Function: admin-users
// Cho phép tài khoản có quyền 'admin' tạo / sửa / khoá / xoá tài khoản và đặt lại mật khẩu
// ngay trong file HTML (Sheet "Tài khoản").
//
// Triển khai:  supabase functions deploy admin-users
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY có sẵn trong môi trường Edge Function)

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ROLES = ["site", "manager", "procurement", "admin"];
const BAN_FOREVER = "876000h"; // ~100 năm

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. Xác thực người gọi
  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "Bạn chưa đăng nhập" }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: me } = await admin.from("profiles").select("role, active").eq("id", user.id).single();
  if (!me || me.role !== "admin" || !me.active) return json({ error: "Chỉ quản trị mới được quản lý tài khoản" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Dữ liệu không hợp lệ" }, 400); }
  // Ghi nhật ký hoạt động kèm người thực hiện (trigger không biết ai gọi khi dùng service role)
  const audit = (action: string, row_id: string, ref: string, changes: unknown) =>
    admin.from("audit_log").insert({ actor: user.id, action, tbl: "profiles", row_id, ref, changes }).then(() => {}, () => {});
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");

  try {
    switch (body.action) {
      case "create": {
        const email = str("email").toLowerCase();
        const password = str("password");
        const role = str("role") || "site";
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Email không hợp lệ" }, 400);
        if (password.length < 8) return json({ error: "Mật khẩu tối thiểu 8 ký tự" }, 400);
        if (!ROLES.includes(role)) return json({ error: "Quyền không hợp lệ" }, 400);

        const { data, error } = await admin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { full_name: str("full_name") },
        });
        if (error) return json({ error: /already/i.test(error.message) ? "Email này đã có tài khoản" : error.message }, 400);

        // profile được trigger tạo sẵn → cập nhật thêm thông tin
        const { error: e2 } = await admin.from("profiles").update({
          full_name: str("full_name") || email.split("@")[0],
          phone: str("phone") || null,
          role,
          site_id: str("site_id") || null,
          active: true,
        }).eq("id", data.user.id);
        if (e2) return json({ error: e2.message }, 400);
        await audit("user_create", data.user.id, email, { full_name: str("full_name") || email.split("@")[0], role, site_id: str("site_id") || null });
        return json({ id: data.user.id });
      }

      case "update": {
        const id = str("id");
        if (!id) return json({ error: "Thiếu id" }, 400);
        const { data: before } = await admin.from("profiles").select("email, full_name, phone, role, site_id, active").eq("id", id).single();
        const patch: Record<string, unknown> = {};
        if ("full_name" in body) patch.full_name = str("full_name") || null;
        if ("phone" in body) patch.phone = str("phone") || null;
        if ("site_id" in body) patch.site_id = str("site_id") || null;
        if ("role" in body) {
          if (!ROLES.includes(str("role"))) return json({ error: "Quyền không hợp lệ" }, 400);
          if (id === user.id && str("role") !== "admin") return json({ error: "Không thể tự bỏ quyền quản trị của mình" }, 400);
          patch.role = str("role");
        }
        if ("active" in body) {
          if (id === user.id && body.active === false) return json({ error: "Không thể tự khoá tài khoản của mình" }, 400);
          patch.active = body.active === true;
          const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: patch.active ? "none" : BAN_FOREVER });
          if (error) return json({ error: error.message }, 400);
        }
        const { error } = await admin.from("profiles").update(patch).eq("id", id);
        if (error) return json({ error: error.message }, 400);
        const diff: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(patch)) {
          const old = before ? (before as Record<string, unknown>)[k] ?? null : null;
          if (old !== v) diff[k] = [old, v];
        }
        if (Object.keys(diff).length) await audit("user_update", id, before?.email ?? "", diff);
        return json({ ok: true });
      }

      case "reset_password": {
        const id = str("id");
        const password = str("password");
        if (!id) return json({ error: "Thiếu id" }, 400);
        if (password.length < 8) return json({ error: "Mật khẩu tối thiểu 8 ký tự" }, 400);
        const { error } = await admin.auth.admin.updateUserById(id, { password });
        if (error) return json({ error: error.message }, 400);
        const { data: who } = await admin.from("profiles").select("email").eq("id", id).single();
        await audit("user_reset_pw", id, who?.email ?? "", null);
        return json({ ok: true });
      }

      case "delete": {
        // Chỉ xoá được tài khoản chưa có dữ liệu (PR, giao nhận, kho…). Có rồi → khoá để giữ lịch sử.
        const id = str("id");
        if (!id) return json({ error: "Thiếu id" }, 400);
        if (id === user.id) return json({ error: "Không thể tự xoá tài khoản của mình" }, 400);
        const { data: p } = await admin.from("profiles").select("email, full_name, role, site_id").eq("id", id).single();
        if (!p) return json({ error: "Không tìm thấy tài khoản" }, 404);
        const REFS: [string, string, string][] = [
          ["purchase_requests", "requested_by", "PR đã lập"], ["purchase_requests", "approved_by", "PR đã duyệt"],
          ["pr_history", "changed_by", "lịch sử PR"], ["pr_deliveries", "confirmed_by", "lần nhận hàng"],
          ["pr_deliveries", "resolved_by", "xử lý giao hàng"], ["pr_attachments", "uploaded_by", "file đính kèm"],
          ["purchase_proposals", "created_by", "đề xuất mua"], ["purchase_proposals", "handled_by", "đề xuất mua"],
          ["stock", "updated_by", "dòng tồn kho"], ["stock_log", "changed_by", "lịch sử kho"],
          ["materials", "created_by", "vật tư đã tạo"], ["assets", "created_by", "tài sản"], ["asset_history", "changed_by", "lịch sử tài sản"],
        ];
        const used = new Set<string>();
        for (const [t, c, label] of REFS) {
          const { count, error } = await admin.from(t).select("*", { count: "exact", head: true }).eq(c, id);
          if (error) return json({ error: error.message }, 500);
          if (count) used.add(label);
        }
        if (used.size) return json({ error: `Tài khoản đã có dữ liệu (${[...used].join(", ")}) nên không xoá được — hãy bỏ dấu "Đang dùng" để khoá tài khoản.` }, 400);
        await audit("user_delete", id, p.email ?? "", p);
        const { error } = await admin.auth.admin.deleteUser(id); // profile tự xoá theo (on delete cascade)
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      default:
        return json({ error: "Thao tác không hợp lệ" }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
