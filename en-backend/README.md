# en-backend — English Studio Backend Service (CEFR A1)

Service Backend độc lập cho phân hệ **Tiếng Anh CEFR** (Express + TypeScript, cổng mặc định `4001`), phục vụ cho đường dẫn `/en` của Frontend thông qua `VITE_EN_API_BASE` (local proxy `/api-en` → `http://localhost:4001/api`), dùng chung PostgreSQL Database và `db-migration/` với `backend/` Tiếng Trung (tách biệt dữ liệu qua cột `language_code = 'zh' | 'en'`).

## Cấu trúc liên quan trong repo
- `en-backend/` — Express + TypeScript API Server cho Tiếng Anh (port `4001`).
- `database/en/` — Dữ liệu đã dịch `word-atlas-vi.json` (785 từ A1) & `lessons-a1.json` (31 bài CEFR A1 cho chế độ In-Memory).
- `db-migration/` — Bộ Liquibase chung cho toàn hệ thống (nạp cả 26 bài HSK lẫn 31 bài CEFR A1).
- `scripts/` — Script dịch (`translate-word-atlas.mjs`) và upload media WebP/MP3 lên Supabase Storage (`upload-en-media-supabase.mjs`).

## Chạy nhanh trên máy local

### 1. Chạy Backend Service (port 4001)
```bash
cd en-backend
cp .env.example .env   # điền DATABASE_URL + JWT_SECRET giống backend/.env và GEMINI_API_KEY (tuỳ chọn)
npm install
npm run dev            # chạy tại http://localhost:4001
```
> Nếu để `ALLOW_MEMORY_FALLBACK=true`, service chạy ngay lập tức từ `../database/en/lessons-a1.json` (31 bài / 785 từ) mà không cần cài PostgreSQL trước.

### 2. Kết nối từ Frontend
- **Local dev**: Frontend tự proxy `/api-en/*` → `http://localhost:4001/api/*`. Mở trình duyệt tại `http://localhost:5173/en`.
- **Production (Vercel + Render)**: Trên Render tạo Web Service thứ 2 trỏ cùng repo `Nghich` với `Root Directory = en-backend` (dùng chung `DATABASE_URL` và `JWT_SECRET` với service Tiếng Trung), sau đó cấu hình trên Frontend:
  ```env
  VITE_API_BASE=https://<chinese-backend>.onrender.com/api
  VITE_EN_API_BASE=https://<en-backend>.onrender.com/api
  ```

### 3. Database Migration (dùng chung cho cả Tiếng Trung & Tiếng Anh)
```bash
cd db-migration
mvn spring-boot:run
```

## Bản quyền dữ liệu
- Dữ liệu hình ảnh minh họa WebP và phát âm chuẩn UK/US MP3 được trích từ **Word Atlas contributors** theo giấy phép **CC BY 4.0**.
