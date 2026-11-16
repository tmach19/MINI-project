# Quản lý Database Migration bằng Liquibase

Cấu trúc thư mục `database/liquibase/` theo chuẩn Liquibase (tương tự Spring Boot / ICDS), dùng chung cho cả **PostgreSQL Local** và **Supabase**:

```text
database/liquibase/
├── db.changelog-master.yaml             # File gốc điều phối các changeset
├── changelog/
│   ├── 001-init-schema.yaml             # Chạy ../../schema.sql (11 bảng)
│   ├── 002-seed-lessons.yaml            # Chạy ../../seed.sql (26 bài học, runOnChange=true)
│   └── 003-example-alter.sql            # Mẫu file SQL cho các lần nâng cấp sau
├── liquibase.properties.example         # Mẫu kết nối PostgreSQL Local
└── liquibase-supabase.properties.example # Mẫu kết nối Supabase
```

---

## Cách chạy bằng Liquibase CLI (trên máy đã cài Liquibase + Java)

1. Tạo bản sao cấu hình:
   ```powershell
   cd database\liquibase
   Copy-Item liquibase.properties.example liquibase.properties
   ```
2. Mở `liquibase.properties` điền đúng `password` PostgreSQL của bạn.
3. Chạy kiểm tra và cập nhật DB:
   ```powershell
   liquibase status --verbose
   liquibase update
   ```

> **Lưu ý nếu bạn đã chạy tay `schema.sql` & `seed.sql` trong pgAdmin trước đó:**
> Cả `001-init-schema` và `002-seed-lessons` đều viết theo kiểu idempotent (`CREATE TABLE IF NOT EXISTS` và `INSERT ... ON CONFLICT DO UPDATE`), nên bạn có thể chạy thẳng `liquibase update` hoặc chạy `liquibase changelog-sync` để đánh dấu 2 changeset này là đã áp dụng vào bảng `databasechangelog`.

## Cách chạy bằng Docker (không cần cài Java/Liquibase trên máy)

```powershell
docker run --rm -v "${PWD}/database:/liquibase/workspace" liquibase/liquibase `
  --defaults-file=/liquibase/workspace/liquibase/liquibase.properties `
  --changelog-file=/liquibase/workspace/liquibase/db.changelog-master.yaml `
  update
```

## Khi deploy lên Supabase

Dùng `liquibase-supabase.properties.example` (chọn Session Pooler URL của Supabase có `?sslmode=require`), rồi chạy:

```powershell
liquibase --defaults-file=liquibase-supabase.properties update
```

Liquibase sẽ tự tạo 2 bảng `databasechangelog` & `databasechangeloglock` và đồng bộ toàn bộ cấu trúc + dữ liệu lên Supabase y hệt máy local.
