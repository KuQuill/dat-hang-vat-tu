# Hệ thống đặt hàng vật tư (web app)

Web app chạy trên GitHub Pages, cài được lên điện thoại như ứng dụng (PWA), dữ liệu lưu trên Supabase.

```
dat-hang-vat-tu/
├── app/                               # web app (đưa lên GitHub Pages)
│   ├── index.html · styles.css · manifest.webmanifest · sw.js · icons/
│   └── js/
│       ├── config.js                  # ← cấu hình Supabase
│       ├── core.js                    # trạng thái, tiện ích, so khớp vật tư
│       ├── backend-supabase.js        # gọi Supabase
│       ├── backend-demo.js            # chế độ demo (dữ liệu mẫu trên máy)
│       ├── main.js                    # khởi động, đăng nhập, đồng bộ
│       └── views-*.js                 # các màn hình
├── supabase/migrations/001_init.sql   # bảng, phân quyền, kho ảnh, hàm
├── supabase/functions/admin-users/    # Edge Function: quản trị tạo/khoá tài khoản
└── docs/LENH_BOT.md                   # lệnh bot Telegram (giai đoạn sau)
```

## Thử ngay (chế độ demo)

Web app dùng ES module nên cần mở qua web server (không mở trực tiếp file):

```powershell
python -m http.server 8765 --directory app
```

Mở http://localhost:8765 → đăng nhập nhanh bằng 4 vai: công trường, phòng vật tư, thu mua, quản trị.

## Quy trình

```
Công trường đặt PR ──► Phòng vật tư duyệt ──► hệ thống tự lập kế hoạch giao
                                               ├─ 🏬 lấy KHO TỔNG trước (giữ hàng cho PR này)
                                               └─ 🛒 phần thiếu → "cần mua"
                                                       │
                       Phòng vật tư gom "cần mua" ──► ĐỀ XUẤT MUA ──► Thu mua
                                                       ◄── NCC / giá / ngày về / PO tự cập nhật vào PR
Phòng vật tư chuyển đợt sang "Đang giao" ──► Công trường bấm ✔ NHẬN HÀNG
      • đủ & đạt  → đã nhận, hàng/thiết bị chuyển vị trí về công trường
      • thiếu / thừa / sai chủng loại / kém chất lượng → ghi chú + ảnh → "Có vấn đề"
            └─► Phòng vật tư xử lý: Chấp nhận · Giao bù phần thiếu · Trả lại, giao lại
```

## Các màn hình

| Màn hình | Ai dùng | Nội dung |
|---|---|---|
| **1. Thông tin** | Mọi người | Công trường, ngày cần, địa điểm giao; thông tin cá nhân; đổi mật khẩu |
| **2. Đặt hàng** | Mọi người | Tên PR, vật tư (gợi ý từ kho + **số còn trống ở kho tổng**, báo **cần mua mới**), dán từ Excel, ảnh |
| **3. Theo dõi & nhận hàng** | Mọi người | Toàn bộ PR. Phòng vật tư duyệt, chia đợt, chọn nguồn kho / mua, NCC, PO, ngày về. Công trường **xác nhận nhận hàng** từng đợt |
| **4. Kho & tài sản** | Mọi người xem · phòng vật tư sửa | **Vật tư theo số lượng** (vị trí, tình trạng, ảnh, tồn tối thiểu, đang giữ cho PR) · **Tài sản từng chiếc** (mã tài sản, biển số, vị trí, tình trạng, lịch sử, **tem QR**) · **Nhóm vật tư** |
| **5. Đề xuất mua** | Phòng vật tư · Thu mua | Danh sách cần mua → lập đề xuất. Thu mua cập nhật trạng thái, NCC, đơn giá, ngày về, PO |
| **6. Tài khoản** | Quản trị | Tạo tài khoản, đổi quyền, gán công trường, khoá, đặt lại mật khẩu |

### Mã vật tư & nhóm
Mã dạng `NHÓM-0001`: **CG** Cơ giới · **MM** Máy móc · **DC** Công cụ dụng cụ · **KC** Kết cấu · **HT** Hoàn thiện · **NT** Nội thất · **MEP** · **K** Khác.
Phòng vật tư thêm nhóm / nhóm con trong *Kho & tài sản → 🗂 Nhóm vật tư*. Mỗi nhóm có:
- **Cách quản lý**: *Theo số lượng* hoặc *Từng chiếc* (CG, MM mặc định từng chiếc).
- **Theo dõi tại công trường**: bật cho đồ luân chuyển (DC – giàn giáo, cây chống…) để sau khi nhận, số lượng được ghi vào tồn của công trường và có thể **điều chuyển trả về kho**. Vật tư tiêu hao (KC, HT…) chỉ trừ kho tổng.

### Tồn kho & vị trí
- Mỗi dòng tồn = vật tư + **vị trí** (Kho tổng hoặc công trường) + **tình trạng** (Mới / Đã qua sử dụng / Hỏng / Đang sửa) + ảnh.
- Khi công trường **xác nhận nhận hàng** xuất từ kho tổng: kho tổng tự trừ; thiết bị / đồ luân chuyển tự chuyển vị trí sang công trường đó.
- **⇄ Điều chuyển**: chuyển giữa kho ↔ công trường, đổi tình trạng (vd hỏng → đang sửa). Mọi thay đổi lưu lịch sử.
- **Tem QR**: *Tài sản → 🏷 In tem QR* (khổ A4, 3 cột). Quét bằng camera điện thoại sẽ mở thẳng trang thông tin tài sản.

---

## Trạng thái hiện tại

- 🌐 **Web app**: https://kuquill.github.io/dat-hang-vat-tu/ — tự cập nhật mỗi khi push thay đổi trong `app/` lên nhánh `main`.

- Đã tạo project Supabase **dat-hang-vat-tu** (Singapore, gói miễn phí), đã chạy toàn bộ SQL, đã triển khai Edge Function `admin-users`.
- `app/js/config.js` đã trỏ tới project này.
- Có 2 công trường thử nghiệm (TEST01, TEST02), 4 tài khoản thử nghiệm và 1 PR mẫu (PR-2026-0001).
  Mật khẩu nằm trong `TAI_KHOAN_THU_NGHIEM.md` (đã đưa vào `.gitignore`, không đẩy lên GitHub).
- **Việc còn lại trong Dashboard** (Authentication): tắt *Allow new users to sign up*; đặt *Site URL* = link GitHub Pages; bật *Leaked password protection* nếu gói cho phép.
- Khi dùng thật: tạo tài khoản quản trị thật → khoá các tài khoản `@vattu.test` → xoá dữ liệu thử (xem cuối file).

## Bước 1 — Tạo Supabase

1. https://supabase.com → **New project** → Region **Southeast Asia (Singapore)**.
2. **SQL Editor** → dán toàn bộ `supabase/migrations/001_init.sql` → **Run**.
3. Thêm công trường:
   ```sql
   insert into public.sites (code, name, address, manager) values
     ('LA01', 'Nhà xưởng Long An', 'KCN Tân Đức, Long An', 'Phạm Văn Hùng');
   ```
4. **Authentication → Sign In / Providers → Email**: tắt *Allow new users to sign up*.
5. **Authentication → URL Configuration → Site URL**: điền link GitHub Pages (Bước 4).

## Bước 2 — Tài khoản

Quản trị đầu tiên (1 lần): *Authentication → Users → Add user* (tick Auto Confirm), rồi:
```sql
update public.profiles set role = 'admin' where email = 'admin@congty.vn';
```
Các tài khoản khác tạo trong web app (màn hình **Tài khoản**) sau khi triển khai Edge Function:
```powershell
npx supabase login
```
```powershell
npx supabase link --project-ref <mã-project>
```
```powershell
npx supabase functions deploy admin-users
```

| Quyền | Được làm |
|---|---|
| `site` Công trường | Xem đơn, kho; đặt PR; **xác nhận nhận hàng** PR của mình / công trường mình; thêm ảnh |
| `procurement` Phòng vật tư | + Duyệt, kế hoạch giao, xử lý vấn đề nhận hàng, cập nhật kho & tài sản, lập đề xuất mua |
| `purchasing` Thu mua | Xem; cập nhật trạng thái, NCC, giá, ngày về, PO của đề xuất mua |
| `admin` Quản trị | Tất cả + quản lý tài khoản |

## Bước 3 — Nhập dữ liệu ban đầu

Đăng nhập phòng vật tư → **Kho & tài sản**:
- **Vật tư**: *📋 Nhập từ Excel* (bấm *⬇ File mẫu* để lấy mẫu cột). Chọn *Kiểm kê*.
- **Tài sản**: *📋 Nhập từ Excel*, mỗi dòng một chiếc (mã loại, tên, biển số, vị trí, tình trạng).

Nếu muốn giữ **mã cũ**: nhập danh mục vào bảng `materials` trước (Table Editor → Import CSV), rồi đồng bộ bộ đếm:
```sql
update public.material_groups g set seq = greatest(seq, coalesce((select max(substring(m.code from '[0-9]+$')::int)
  from public.materials m where m.group_code = g.code), 0));
```

## Bước 4 — Đưa web app lên GitHub Pages

1. Sửa `app/js/config.js`: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (anon / publishable key — **không** dùng service_role).
2. Tạo repo GitHub, đưa thư mục lên.
3. **Settings → Pages → Build and deployment**: chọn *GitHub Actions* và thêm workflow đưa thư mục `app/` lên Pages,
   hoặc đơn giản: đặt nội dung `app/` vào thư mục `docs/` của nhánh `main` và chọn *Deploy from a branch → main /docs*.
4. Mọi người mở link `https://<to-chuc>.github.io/<repo>/` → đăng nhập. Trên điện thoại: menu trình duyệt → **Thêm vào màn hình chính**.

**Phát hành bản mới**: sửa code → tăng `APP_VERSION` trong `config.js` **và** `CACHE` trong `sw.js` → push. Người dùng mở lại app là có bản mới.

## Lưu ý

- Mất mạng: vẫn xem dữ liệu đã lưu, đặt đơn (kể cả ảnh) → tự gửi khi có mạng.
- Ảnh tự nén ≤1600px, lưu trong kho ảnh riêng tư; link xem ảnh có hạn 1 giờ.
- Chưa có: phiếu xuất kho / biên bản giao nhận PDF có QR (giai đoạn sau), bot Telegram (`docs/LENH_BOT.md`).

## Xoá dữ liệu thử nghiệm (trước khi dùng thật)

Chạy trong SQL Editor (giữ nguyên nhóm vật tư; xoá PR, kho, tài sản, vật tư, công trường TEST):
```sql
truncate public.proposal_line_batches, public.proposal_lines, public.purchase_proposals,
         public.pr_attachments, public.pr_history, public.pr_deliveries, public.pr_items, public.purchase_requests,
         public.asset_history, public.assets, public.stock_log, public.stock, public.doc_counters cascade;
delete from public.materials;
update public.material_groups set seq = 0;
update public.profiles set site_id = null where site_id in (select id from public.sites where code like 'TEST%');
delete from public.sites where code like 'TEST%';
```
Ảnh thử trong Storage → bucket `pr-images` xoá thủ công nếu cần.
