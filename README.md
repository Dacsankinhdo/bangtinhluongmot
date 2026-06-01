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
```

Sau khi đổi env var trên Vercel, redeploy project để function nhận cấu hình mới.
