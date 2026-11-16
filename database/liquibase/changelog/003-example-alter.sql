--liquibase formatted sql

-- Mẫu changeset cho những lần nâng cấp DB sau này.
-- Khi cần thêm bảng/cột mới:
-- 1. Tạo file mới (vd: 003-add-audio-url.sql) với comment "--liquibase formatted sql"
-- 2. Khai báo "--changeset yourname:003-add-audio-url"
-- 3. Include file này vào db.changelog-master.yaml rồi chạy `liquibase update`

--changeset chinese-study:003-example-noop
SELECT 1;
