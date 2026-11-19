---
name: chinese-study-conventions
description: >-
  Project-specific architecture rules, PostgreSQL/Liquibase optimization patterns,
  FE/BE coding conventions, IME/grading safeguards, and verification workflows for
  the Chinese Study Full-Stack repository (React + Express + PostgreSQL + Liquibase).
  Read this skill whenever adding features, editing search/exam/profile logic,
  writing DB migrations, or verifying changes in this workspace.
---

# Chinese Study — Quy tắc & Phương pháp Tối ưu Dự án

Tài liệu chuẩn hóa các rule, pattern tối ưu và quy trình kiểm chứng đang áp dụng trong dự án `汉语学堂` để duy trì tính nhất quán cho các phiên làm việc tiếp theo.

---

## 1. Kiến trúc Dual-Mode (PostgreSQL + In-Memory Fallback)

- Mọi repository trong `backend/src/repositories/` **bắt buộc** giữ hành vi nhất quán giữa chế độ `postgres` và chế độ `memory` (`memoryStore` đọc từ `data.js`).
- Khi thay đổi logic truy vấn, sắp xếp, tìm kiếm hoặc chấm điểm ở PostgreSQL, phải cập nhật logic tương đương trong nhánh `if (getDbMode() === 'memory')`.
- Cấu hình SSL PostgreSQL cho môi trường cloud (Render → Supabase) dùng helper `sanitizeSslConnectionString` trong `backend/src/db/pool.ts` — không tự sửa connection string thủ công ở nơi khác.
- Cấu trúc deploy tách root directory:
  - `frontend/` → Vercel (SPA fallback qua `frontend/vercel.json`).
  - `backend/` → Render.
  - `db-migration/` → Spring Boot 3 + Liquibase YAML (chạy vào Local PG và Supabase).

---

## 2. Database & Liquibase Optimization Rules (`db-migration/` + `database/`)

### 2.1. Quy chuẩn Changeset
- Sinh changeset mới bằng script chuẩn timestamp:
  ```powershell
  node db-migration/scripts/gen-changeset.mjs table <mo_ta>
  node db-migration/scripts/gen-changeset.mjs view <mo_ta>
  node db-migration/scripts/gen-changeset.mjs function <mo_ta>
  node db-migration/scripts/gen-changeset.mjs seed <mo_ta>
  node db-migration/scripts/gen-changeset.mjs procedure <mo_ta>
  ```
- Thứ tự quét của `db.changelog-master.yml`: `01_tables/` → `02_views/` → `03_functions/` → `05_seed_data/` → `06_procedures/`.
- `01_tables/` (versioned): **luôn kèm `rollback`**, ưu tiên `IF NOT EXISTS` / `IF EXISTS` và đồng bộ lại `database/schema.sql`.
- `03_functions/` (repeatable): **luôn đặt `runOnChange: true`**, `splitStatements: false`, `stripComments: false` cho khối `$$...$$`, kèm `rollback` `DROP FUNCTION IF EXISTS ...`.
- Khi chỉnh sửa `data.js`, cần chạy generator (`database/generate-seed.mjs`) và đồng bộ `database/seed.sql` lẫn `db-migration/src/main/resources/db/migration/sql/seed_data.sql`.
- **Quy tắc Xoá mềm (Soft Delete)**: Tuyệt đối không dùng `DELETE FROM` vật lý trong repository; các bảng nghiệp vụ sử dụng cờ `is_deleted SMALLINT NOT NULL DEFAULT 0` (chuyển sang `1` kèm `deleted_at = NOW()` khi xoá, khôi phục về `0` khi upsert trùng khoá) và mọi câu `SELECT` / PostgreSQL function phải lọc `is_deleted = 0`.

### 2.2. Đẩy logic nặng xuống PostgreSQL Function & Index chuyên biệt
- **Tránh `Seq Scan` từ `LIKE '%...%'`**:
  - Không dùng `LOWER(col) LIKE '%...%'` cho tìm kiếm toàn cục.
  - Dùng cột sinh tự động `search_tsv TSVECTOR GENERATED ALWAYS AS (...) STORED` trên `vocabularies` kèm `GIN` index `idx_vocabularies_search_tsv`.
  - Chuẩn hóa chữ thường + bỏ dấu tiếng Việt & thanh điệu Pinyin bằng hàm thuần SQL `IMMUTABLE` (`translate(lower(...), ...)`), không phụ thuộc extension đặc quyền trên Supabase (`unaccent`/`pg_trgm`).
  - Đánh trọng số: `'A'` cho `hanzi`, `pinyin`, `sino_vietnamese`, `meaning`; `'D'` cho `radical` để tránh từ khóa nằm trong giải thích bộ thủ nhảy lên đầu kết quả.
- **Tìm kiếm phân nhánh CJK vs Latin (`fn_search_vocabulary`)**:
  - Query chứa Hán tự (`[\u4E00-\u9FFF]`): cho phép khớp chuỗi con (`exact` > `prefix` > `substring` > `radical`).
  - Query Latin / Tiếng Việt / Pinyin: dùng `search_tsv @@ phraseto_tsquery('simple', ...)` kết hợp regex ranh giới từ `\m...\M` (ví dụ tìm `'gia'` không dính `'gian'` trong `thời gian`), hỗ trợ tìm không dấu khi query không dấu, và giữ khớp đúng dấu khi query đã có dấu (`q_raw <> q_norm`).
  - Luôn xếp hạng bằng `match_rank DESC, lesson_sort ASC, vocab_sort ASC`.
- **Sampling phân tầng trong 1 lượt quét (`fn_get_random_comprehensive_exam`)**:
  - Dùng single-scan CTE + `ROW_NUMBER() OVER (PARTITION BY q.lesson_id, q.category ORDER BY random())` để rải đều 50 câu trên 26 bài hệ thống theo cơ cấu HSK 3 (25 Nghe, 9 Đọc, 6 Điền từ, 4 Từ vựng, 3 Dịch Trung→Việt, 3 Dịch Việt→Trung), lọc nhanh bằng partial index `idx_quiz_comprehensive_cat WHERE scope = 'comprehensive_test'`.
- **Thứ tự danh sách học tập của User (`userProgressRepo.ts`)**:
  - `getMarkedVocabCards`: sắp xếp theo thứ tự bài học từ Bài 1 trở về sau (`ORDER BY l.is_system DESC, l.sort_order ASC, l.created_at ASC, v.sort_order ASC, m.marked_at DESC`).
  - `listTestAttempts`: không cắt cứng `LIMIT 30` khi phục vụ màn tổng hợp lịch sử; hỗ trợ cả `lesson_id IS NULL` (kèm `exam_title`) và bài học cụ thể qua `LEFT JOIN lessons` + index `idx_attempts_user_submitted (user_id, submitted_at DESC)`.

### 2.3. Kiểm thử SQL an toàn
- **Không tự ý execute SQL làm thay đổi DB local ngoài Liquibase** (tránh lệch bảng `databasechangelog`).
- Khi cần test DDL/Function mới trên PostgreSQL local, đọc SQL trực tiếp từ file `.yml` và bọc trong transaction **`BEGIN; ... ROLLBACK;`**. Nhắc người dùng chạy `DbMigration-Local` / `DbMigration-Supabase` qua IntelliJ để apply chính thức.

---

## 3. Frontend Rules & UX Safeguards (`frontend/src/`)

- **Tái sử dụng UI primitives & Tailwind Dark Mode**:
  - Modal dùng `components/common/ModalShell.tsx` và `ConfirmDeleteModal.tsx`.
  - Mọi nút đóng (close button) trên modal/popup **bắt buộc dùng icon dấu `X`** (`ModalCloseButton` từ `components/common/ModalShell.tsx` hoặc `<X />` kèm `aria-label="Đóng"`), không dùng nút chữ `"Đóng"` hay `"Close"`.
  - Metadata buổi học dùng `components/common/LessonMetaFields.tsx`; trạng thái loading dùng `components/common/LoadingState.tsx` (`LoadingScreen`, `LoadingCard`, `LoadingSpinner`).
  - **Cảnh báo specificity của Tailwind v3 Dark Mode (`dark:border-*`)**: Class `dark:border-slate-800` sinh selector `.dark .dark\:border-*` có độ ưu tiên CSS cao hơn `border-t-*` / `border-r-*` (khi không có tiền tố `dark:`), nên sẽ đè mất màu cạnh riêng của spinner/viền trong Dark Mode. Khi dùng border theo cạnh kết hợp `dark:border-*`, luôn phải kèm `dark:border-t-*` / `dark:border-r-*` tương ứng — hoặc dùng SVG (`LoadingState.tsx`).
  - Hằng số dùng `lib/constants.ts`; kiểm tra HSK / Import Excel 3 sheet dùng `lib/lessonImport.ts` (`xlsx-js-style`).
  - Tái sử dụng `TestSection.tsx` cho cả kiểm tra từng bài và màn kiểm tra tổng hợp (`/exam` với `isComprehensiveExam`).
- **SPA Routing & Menu Extension**:
  - Các màn `/`, `/profile`, `/exam` đồng bộ qua `window.history.pushState`/`replaceState` và lắng nghe `popstate` (kết hợp `frontend/vercel.json`).
  - `HeaderExtensionMenu`: truyền danh sách `ExtensionMenuItem`; đặt `active: true` khi đang đứng tại màn tương ứng để highlight trạng thái đang chọn và khóa click lặp (nhưng không làm mờ bằng `opacity-40` như disabled thường).
  - Giữ mô tả UI gọn theo đúng yêu cầu (ví dụ mục Kiểm tra tổng hợp chỉ mô tả `"50 câu ngẫu nhiên"`).
  - **Không để lộ thông tin cấu hình / trạng thái kỹ thuật nội bộ lên giao diện người dùng (UI)**: Tuyệt đối không hiển thị các nhãn hay thông báo nhắc tới trạng thái key/môi trường (`chưa có AI key`, `AI sẵn sàng (model...)`, tên biến môi trường như `GEMINI_API_KEY`/`AI_API_KEY`, đường dẫn `backend/.env`, `schema.sql` hay hướng dẫn setup cho developer) trên màn hình hoặc thông báo trả về cho user cuối. Nếu thiếu cấu hình trên server, ghi log qua `console.warn` ở backend và hiển thị thông báo thân thiện cho người dùng.
- **Trang cá nhân (`ProfilePage.tsx`)**:
  - Dữ liệu tab **Từ đã đánh dấu** và **Lịch sử làm bài** lấy mới trực tiếp từ DB qua API (`/api/progress/marked`, `/api/tests/attempts`) khi mở tab.
  - Mọi thẻ thống kê (**Tổng lượt thi**, **Điểm trung bình**, **Điểm cao nhất**) phải tính từ tập dữ liệu **đã áp dụng bộ lọc (`filteredAttempts`)**, đồng bộ tức thì với bộ lọc loại bài & từ khóa.
- **Nhập liệu, Bộ gõ IME & Chấm điểm (`GamesSection.tsx`)**:
  - Khi xử lý phím `Enter` trên `<input>` tiếng Trung hoặc tiếng Việt Telex, **luôn kiểm tra** `!e.nativeEvent.isComposing && e.keyCode !== 229` để tránh nộp nhầm câu dở dang khi đang xác nhận ký tự IME.
  - Khóa nút `Kiểm tra` khi ô nhập rỗng (hoặc chưa chọn đủ từ ở `Sắp xếp câu`); khi `onChange` sửa input, reset trạng thái kết quả cũ (`setTransChecked(false)`).
  - Chấm dịch `zh_to_vi` phải đối chiếu độ phủ trên toàn câu `expectedMeaning` (cả phần cuối câu dài), tuyệt đối không chấm đúng chỉ vì khớp 2–3 từ đầu trong `acceptedKeywords`.

---

## 4. Quy trình Kiểm chứng (Verification Checklist)

Trên Windows PowerShell, nối lệnh bằng `;` (không dùng `&&`) và kiểm tra `$LASTEXITCODE`:

1. **Backend**:
   ```powershell
   Push-Location backend; npm run typecheck; if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }; npm run build; $ec = $LASTEXITCODE; Pop-Location; exit $ec
   ```
   - Chạy thêm smoke test node trên `backend/dist/` (chế độ In-Memory) và/hoặc `BEGIN ... ROLLBACK` trên PostgreSQL local nếu sửa repository/function DB.
2. **Frontend**:
   ```powershell
   Push-Location frontend; npm run typecheck; if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }; npm run build; $ec = $LASTEXITCODE; Pop-Location; exit $ec
   ```
3. **Git**: Không tự ý `git push` khi chưa có yêu cầu rõ từ người dùng.
