/* =====================================================================
   CẤU HÌNH — sửa file này khi triển khai
   Để trống SUPABASE_URL / SUPABASE_ANON_KEY → chạy CHẾ ĐỘ DEMO (dữ liệu mẫu trên máy)
   ===================================================================== */
export const CONFIG = {
  COMPANY: 'Mekocons E&C',
  SUPABASE_URL: 'https://kzuztlkygufpojphyyzf.supabase.co',
  // Khoá công khai (anon) — được phép để trong code; dữ liệu được bảo vệ bằng đăng nhập + RLS. KHÔNG dùng service_role.
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6dXp0bGt5Z3VmcG9qcGh5eXpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU0MjE0MjcsImV4cCI6MjExMDk5NzQyN30._ycKgJg2Xn40yTYbjLSiCBWZFweX2j5uukhE2Txhs-s',
  APP_VERSION: '2.8.0',      // tăng mỗi lần phát hành, đồng thời sửa CACHE trong sw.js
};
