# Database Setup (PostgreSQL Local -> Supabase)

Thư mục này chứa thiết kế cơ sở dữ liệu PostgreSQL cho hệ thống **汉语学堂 (Chinese Study Web App)**, tương thích đồng thời với **PostgreSQL chạy local** và **Supabase PostgreSQL**.

## Cấu trúc file

- `schema.sql`: Toàn bộ định nghĩa bảng (`users`, `lessons`, `vocabularies`, `grammars`, `texts`, `text_sentences`, `sentence_scrambles`, `translation_exercises`, `quiz_questions`, `user_vocab_progress`, `test_attempts`), khóa ngoại và index.
- `generate-seed.mjs`: Script Node.js đọc dữ liệu 26 bài học chuẩn HSK từ `../data.js` và sinh ra `seed.sql` (an toàn khi chạy lại nhờ `ON CONFLICT ... DO UPDATE`).
- `seed.sql`: File SQL chứa toàn bộ **3.414 bản ghi** học liệu (26 bài học, 670 từ vựng, 96 điểm ngữ pháp, 81 bài khoá, 632 câu hội thoại, 156 bài sắp xếp câu, 208 bài dịch, 1.545 câu trắc nghiệm/nghe/kiểm tra).

---

## 1. Chạy trên PostgreSQL Local

### Cách A: Dùng `psql` (khuyến nghị)
1. Tạo database mới (ví dụ tên `chinese_study`):
   ```sql
   CREATE DATABASE chinese_study;
   ```
2. Chạy schema và nạp dữ liệu mẫu:
   ```powershell
   psql -U postgres -d chinese_study -f database/schema.sql
   psql -U postgres -d chinese_study -f database/seed.sql
   ```

### Cách B: Dùng Docker (nếu không muốn cài PostgreSQL trực tiếp)
```powershell
docker run --name chinese-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=chinese_study -p 5432:5432 -d postgres:16
docker exec -i chinese-pg psql -U postgres -d chinese_study < database/schema.sql
docker exec -i chinese-pg psql -U postgres -d chinese_study < database/seed.sql
```

Chuỗi kết nối (`.env`) ở local:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/chinese_study"
```

---

## 2. Deploy lên Supabase

1. Tạo project mới trên [Supabase](https://supabase.com).
2. Vào **Project Settings -> Database -> Connection string** (chọn mục **Session pooler** hoặc **Direct connection** nếu mạng hỗ trợ IPv6) để lấy `DATABASE_URL` có dạng:
   ```env
   DATABASE_URL="postgresql://postgres.[PROJECT_REF]:[YOUR_PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
   ```
3. Khởi tạo bảng và dữ liệu:
   - Mở **SQL Editor** trên Supabase để chạy file `database/schema.sql`.
   - Với `database/seed.sql` (~3.3 MB), nên chạy qua terminal bằng `psql` để nhanh và không bị lag trình duyệt:
     ```powershell
     psql "postgresql://postgres.[PROJECT_REF]:[YOUR_PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres" -f database/seed.sql
     ```

## 3. Cập nhật lại `seed.sql` khi sửa `data.js`
```powershell
node database/generate-seed.mjs
```
