# 汉语学堂 — Hệ thống Học Tiếng Trung Full-Stack (React + Express + PostgreSQL)

Nâng cấp từ phiên bản web tĩnh (`index.html`, `style.css`, `app.js`, `data.js`) sang kiến trúc **FE + BE + DB** chuẩn chỉnh, có sẵn fallback In-Memory để chạy thử ngay cả khi chưa nạp PostgreSQL.

## Cấu trúc dự án

- `frontend/`: **React + Vite + TypeScript + Tailwind CSS + HanziWriter** (cổng `5173`)
- `backend/`: **Node.js + Express + TypeScript + pg + JWT** (cổng `4000`)
- `database/`: `schema.sql`, `seed.sql` (26 bài học HSK / 3.414 bản ghi), `generate-seed.mjs`

## Chạy ở Local

1. **Chạy Backend** (mặc định tự động dùng dữ liệu từ `data.js` nếu PostgreSQL chưa sẵn sàng):
   ```powershell
   cd backend
   npm run dev
   ```
2. **Chạy Frontend**:
   ```powershell
   cd frontend
   npm run dev
   ```
3. Mở trình duyệt tại `http://localhost:5173`.

## Kết nối PostgreSQL Local hoặc Supabase

Chỉnh `DATABASE_URL` trong `backend/.env` rồi nạp bảng & dữ liệu theo hướng dẫn trong `database/README.md`. Khi `lessons` có dữ liệu, backend tự chuyển sang chế độ `PostgreSQL`.
