# chinese-study-db-migration

Module quản lý migration PostgreSQL (Local & Supabase) bằng **Spring Boot 3 + Liquibase YAML**, tổ chức theo chuẩn `icds-db-migration`.

## Cấu trúc thư mục

`src/main/resources/db/migration/db.changelog-master.yml` tự động quét (`includeAll`) các thư mục theo thứ tự:
1. `01_tables/` — versioned (`YYYYMMDD_HHmmss_mo_ta.yml`, luôn có `rollback`)
2. `02_views/` — repeatable (`runOnChange: true`)
3. `03_functions/` — repeatable (`runOnChange: true`)
4. `05_seed_data/` — seed data (26 bài học HSK)
5. `06_procedures/` — repeatable (`runOnChange: true`)

*(Bỏ qua `04_packages/` vì PostgreSQL không dùng khái niệm PL/SQL Package như Oracle.)*

## Cách chạy (yêu cầu JDK 21 + Maven hoặc Liquibase CLI)

1. `application.yml` để `spring.liquibase.enabled: false` (an toàn khi chạy thử local).
2. Khi muốn chạy apply thật vào DB:
   ```powershell
   cd db-migration
   $env:SPRING_LIQUIBASE_ENABLED="true"
   mvn spring-boot:run
   ```
3. Kiểm tra trạng thái / Rollback N changeset gần nhất qua Maven Liquibase Plugin:
   ```powershell
   mvn liquibase:status `
     "-Dliquibase.url=jdbc:postgresql://localhost:5432/chinese-study" `
     "-Dliquibase.username=postgres" `
     "-Dliquibase.password=YOUR_PASSWORD" `
     "-Dliquibase.defaultSchemaName=public" `
     "-Dliquibase.liquibaseSchemaName=public" `
     "-Dliquibase.contexts=dev"

   mvn liquibase:rollback -Dliquibase.rollbackCount=1 ...
   ```

## Sinh changeset mới (theo chuẩn timestamp)

```powershell
node db-migration/scripts/gen-changeset.mjs table add_flashcard_tags
node db-migration/scripts/gen-changeset.mjs view vw_user_progress_summary
node db-migration/scripts/gen-changeset.mjs seed insert_extra_vocab
```
