# Lark Payroll Sync

Giao diện web để dán URL bảng chấm công Lark Base, phân tích `Ngày công TT` / `Số lần trễ`, rồi cập nhật vào bảng lương cố định.

## Chạy local

Yêu cầu Node.js 18+.

```powershell
npm run dev
```

Mở:

```text
http://127.0.0.1:3000
```

## Deploy lên Vercel

1. Đẩy toàn bộ project này lên GitHub/GitLab/Bitbucket.
2. Vào Vercel, chọn **Add New Project** và import repo.
3. Giữ framework là **Other** hoặc để Vercel tự nhận.
4. Root Directory là thư mục chứa `package.json`, `public/`, `api/`.
5. Deploy.

Vercel sẽ phục vụ:

- UI tĩnh từ `public/`.
- API phân tích tại `/api/analyze`.
- API cập nhật tại `/api/sync`.

## Biến môi trường

App Secret không được hardcode trong repo. Khi deploy thật, đặt trong Vercel Project Settings:

```text
LARK_APP_ID=cli_a975bd3a93b99eed
LARK_APP_SECRET=your_secret_here
LARK_SOURCE_DATE_FIELD=
<<<<<<< HEAD
LARK_SOURCE_WORK_DAYS_FIELD=
LARK_SOURCE_LATE_COUNT_FIELD=
LARK_SOURCE_OT_HOURS_FIELD=
LARK_DESTINATION_OT_HOURS_FIELD=Số giờ OT
LARK_HR_TABLE_URL=https://dacsankinhdo.sg.larksuite.com/base/MYsqbAZWwamm6NsDRUNlkRc0gEg?table=tblTzjbVaEn78wQH&view=vewIliHDMf
LARK_HR_NAME_FIELD=


Sau khi đổi env var trên Vercel, redeploy project để function nhận cấu hình mới.

`Ngày công TT` được đếm unique theo `Tên + Ngày`, để một ngày có 2 dòng vào/ra chỉ tính là 1 ngày công. Script sẽ tự dò cột ngày/giờ phổ biến như `Date`, `Time`, `Ngày`, `Thời gian chấm công`. Nếu bảng nguồn dùng tên cột khác, đặt `LARK_SOURCE_DATE_FIELD` bằng đúng tên cột ngày/giờ trong bảng nguồn.
<<<<<<< HEAD

Nếu bảng nguồn đã có sẵn dữ liệu tổng hợp theo nhân viên, hệ thống sẽ lấy trực tiếp các cột như `Ngày làm việc thực tế`, `Số lần trễ`, `Số giờ OT` hoặc `Số giờ tăng ca`. Nếu tên cột khác, đặt các biến `LARK_SOURCE_WORK_DAYS_FIELD`, `LARK_SOURCE_LATE_COUNT_FIELD`, `LARK_SOURCE_OT_HOURS_FIELD`. Khi cập nhật, `Số giờ OT` sẽ được ghi vào cột đích được cấu hình bởi `LARK_DESTINATION_OT_HOURS_FIELD`.

Bảng nhân sự mặc định là `tblTzjbVaEn78wQH`. Khi phân tích, hệ thống sẽ kiểm tra tên trong bảng chấm công đã có trong bảng nhân sự chưa. Nếu có nhân sự mới, giao diện sẽ hiện nút **Thêm nhân sự** để tạo record mới với cột tên; người cập nhật cần mở bảng nhân sự và bổ sung các cột còn thiếu. Nếu cột tên của bảng nhân sự không tự dò được, đặt `LARK_HR_NAME_FIELD` bằng đúng tên cột.
```
