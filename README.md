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

Chỉnh `DATABASE_URL` trong `backend/.env` rồi nạp bảng & dữ liệu theo hướng dẫn trong [database/README.md](./database/README.md) hoặc chạy migration qua [db-migration/README.md](./db-migration/README.md). Khi `lessons` có dữ liệu, backend tự chuyển sang chế độ `PostgreSQL`.

## Quy tắc & Phương pháp Tối ưu Dự án

Các quy ước kỹ thuật của dự án được chuẩn hóa tại [SKILL.md](./.agents/skills/chinese-study-conventions/SKILL.md) để cả developer và AI agent áp dụng xuyên suốt:

- **Dual-mode nhất quán (`PostgreSQL` + `In-Memory`)**: Mọi logic repository (`lessonRepo.ts`, `userProgressRepo.ts`) duy trì hành vi, bộ lọc và thứ tự sắp xếp đồng bộ giữa PostgreSQL và fallback In-Memory.
- **Tối ưu dưới Database qua Liquibase (`01_tables/`, `03_functions/`)**:
  - **Tìm kiếm từ vựng (`fn_search_vocabulary`)**: Dùng cột sinh tự động `search_tsv TSVECTOR` (chuẩn hóa hạ chữ thường, bỏ dấu tiếng Việt & thanh điệu Pinyin, tách trọng số `A`/`D`) + `GIN` index `idx_vocabularies_search_tsv` thay cho `LIKE '%...%'`; phân tách query Hán tự (substring) và Latin/Việt/Pinyin (khớp ranh giới từ `\m...\M`, không làm `'gia'` dính `'gian'`, xếp hạng theo `match_rank`).
  - **Đề kiểm tra tổng hợp (`fn_get_random_comprehensive_exam`)**: Single-scan CTE + `ROW_NUMBER() OVER (PARTITION BY lesson_id, category ORDER BY random())` rải đều 50 câu trên 26 bài theo đúng cơ cấu HSK 3, kết hợp partial index `idx_quiz_comprehensive_cat`.
  - **Lịch sử & Từ đánh dấu**: Sắp xếp từ đánh dấu từ Bài 1 trở về sau (`is_system DESC, sort_order ASC, created_at ASC, v.sort_order ASC`); `test_attempts` hỗ trợ cả bài từng buổi lẫn kiểm tra tổng hợp (`lesson_id NULL` + `exam_title`) với index `idx_attempts_user_submitted`.
  - Mọi changeset bảng mới đều kèm `rollback`, đồng bộ `database/schema.sql`, và chỉ test SQL trực tiếp trên DB local trong transaction `BEGIN; ... ROLLBACK;` trước khi chạy `DbMigration-Local` / `DbMigration-Supabase`.
- **Frontend & UX (`frontend/src/`)**:
  - Định tuyến SPA (`/`, `/profile`, `/exam`) bằng History API kết hợp `frontend/vercel.json`.
  - Tái sử dụng UI chuẩn (`ModalShell`, `LessonMetaFields`, `ConfirmDeleteModal`, `LoadingState`, `TestSection`, `HeaderExtensionMenu`).
  - **Lưu ý Dark Mode (Tailwind v3 specificity)**: Tránh kết hợp `dark:border-<color>` chung cho cả 4 cạnh với `border-t-*` / `border-r-*` không có `dark:`, vì `.dark .dark\:border-*` sẽ đè màu các cạnh riêng trong Dark Mode; ưu tiên SVG cho spinner (`LoadingState.tsx`) hoặc khai báo kèm `dark:border-t-*` / `dark:border-r-*`.
  - Thống kê trên `/profile` (**Tổng lượt thi**, **Điểm trung bình**, **Điểm cao nhất**) luôn tính động theo bộ lọc đang chọn.
  - Mọi ô nhập liệu hỗ trợ tiếng Trung / Telex bắt `Enter` đều kiểm tra `!e.nativeEvent.isComposing` để tránh nộp nhầm khi đang gõ IME; phần chấm dịch `zh_to_vi` đối chiếu đủ toàn câu đáp án thay vì chỉ khớp vài từ đầu.
- **Kiểm chứng bắt buộc sau khi sửa code**: Chạy `npm run typecheck` và `npm run build` cho từng package (`backend`, `frontend`) sau lần chỉnh sửa cuối cùng.
