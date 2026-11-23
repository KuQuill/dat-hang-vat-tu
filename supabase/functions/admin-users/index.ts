// Edge Function: admin-users
// Cho phép tài khoản có quyền 'admin' tạo / sửa / khoá tài khoản và đặt lại mật khẩu
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

const ROLES = ["site", "procurement", "purchasing", "admin"];
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
        return json({ id: data.user.id });
      }

      case "update": {
        const id = str("id");
        if (!id) return json({ error: "Thiếu id" }, 400);
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
        return json({ ok: true });
      }

      case "reset_password": {
        const id = str("id");
        const password = str("password");
        if (!id) return json({ error: "Thiếu id" }, 400);
        if (password.length < 8) return json({ error: "Mật khẩu tối thiểu 8 ký tự" }, 400);
        const { error } = await admin.auth.admin.updateUserById(id, { password });
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
