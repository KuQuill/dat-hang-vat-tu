# Câu lệnh bot vật tư (@MKC_VatTu_bot)

Trong nhóm chat, gõ lệnh kèm tên bot, ví dụ `/dat@MKC_VatTu_bot`. Telegram sẽ tự gợi ý lệnh khi gõ `/`.
Cũng có thể tag bot ở đầu câu: `@MKC_VatTu_bot dat ...`.
Lệnh không phân biệt chữ hoa/thường, có dấu hay không dấu.

## 1. Liên kết tài khoản (làm 1 lần, nhắn RIÊNG cho bot)

```
/link 482913
```
Lấy mã 6 số trong file đặt hàng → Sheet 1 → nút "Lấy mã liên kết Telegram". Mã hết hạn sau 15 phút.

## 2. Đặt hàng

```
/dat <mã công trường> <ngày cần> [ghi chú]
<tên vật tư hoặc mã VT> | <số lượng> | <đơn vị> | <quy cách> | <ghi chú>
...
```

Ví dụ:
```
/dat LA01 05/12 Giao cổng số 2
Thép thanh vằn D16 | 5 | tấn | CB400
Xi măng PCB40 | 200 | bao
DC-0012 | 50
```

- Mỗi dòng là một vật tư; chỉ **tên** và **số lượng** là bắt buộc. Vật tư mới (chưa có trong kho) phải có **đơn vị**.
- Có thể viết số lượng kèm đơn vị: `Thép D16 | 5 tấn`.
- Số thập phân dùng dấu phẩy hoặc chấm (`2,5`), **không** dùng dấu phân cách hàng nghìn (`1000`, không viết `1.000`).
- Ngày dạng `dd/mm` hoặc `dd/mm/yyyy`.
- Đặt nhanh 1 dòng: `/dat LA01 05/12 Thép D16 | 5 | tấn`
- Bot tự tìm vật tư tương tự trong kho. Nếu không có → tự cấp mã mới (đánh dấu 🆕). Các con số trong tên phải trùng khớp (D16 không bị nhận nhầm thành D18).
- Muốn chắc chắn đúng vật tư → ghi thẳng mã `KC-0001`, `MEP-0003`… (tra bằng `/kho`).

## 3. Tra cứu (mọi người)

| Lệnh | Ví dụ | Kết quả |
|---|---|---|
| `/pr <số PR>` | `/pr 153` hoặc `/pr PR-2026-0153` | Trạng thái và ngày về từng dòng |
| `/ve <tên/mã vật tư>` | `/ve thep D16` | Các đơn đang mở có vật tư đó + ngày về dự kiến |
| `/kho <từ khoá>` | `/kho xi mang` | Tìm mã vật tư trong kho |
| `/cuatoi` | | Các PR đang mở do mình đặt |
| `/huongdan` | | Xem hướng dẫn |

## 4. Phòng vật tư (tài khoản quyền `procurement` / `admin`)

| Lệnh | Ví dụ |
|---|---|
| `/cho` | Danh sách PR chờ duyệt |
| `/duyet <PR>` | `/duyet 153` (hoặc bấm nút ✅ bot gửi) |
| `/tuchoi <PR> <lý do>` | `/tuchoi 153 Trùng đơn PR-0150` |
| `/dadat <PR> <dòng> [nhà cung cấp] [\| số PO]` | `/dadat 153 all Hòa Phát \| PO-889` |
| `/eta <PR> <dòng> <ngày>` | `/eta 153 1,2 20/12` |
| `/danggiao <PR> <dòng>` | `/danggiao 153 1` |
| `/dave <PR> <dòng> [ngày]` | `/dave 153 all` (mặc định hôm nay) |

`<dòng>`: số thứ tự dòng (`1`), nhiều dòng (`1,3`) hoặc `all` cho cả phiếu.

## Trạng thái

PR: Chờ duyệt → Đã duyệt → Đã đặt → Đang giao → Đã về (hoặc Từ chối / Huỷ).
Trạng thái PR tự cập nhật theo các dòng hàng.
