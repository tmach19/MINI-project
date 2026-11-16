/**
 * Sinh changeset YAML theo timestamp YYYYMMDD_HHmmss (theo chuẩn icds-db-migration, dùng cho PostgreSQL).
 * Cách dùng: node scripts/gen-changeset.mjs <loại> <mô_tả> [author]
 *   loại: table | view | function | seed | procedure
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const baseDir = path.join(rootDir, 'src/main/resources/db/migration');

const KIND_MAP = {
  table: { dir: '01_tables', mode: 'versioned' },
  view: { dir: '02_views', mode: 'repeatable' },
  function: { dir: '03_functions', mode: 'repeatable' },
  seed: { dir: '05_seed_data', mode: 'versioned' },
  procedure: { dir: '06_procedures', mode: 'repeatable' },
};

const [, , kind, desc, authorArg] = process.argv;

if (!kind || !desc || !KIND_MAP[kind] || !/^[A-Za-z0-9_]+$/.test(desc)) {
  console.error('Cách dùng: node scripts/gen-changeset.mjs <table|view|function|seed|procedure> <mo_ta_khong_dau> [author]');
  process.exit(1);
}

const author = authorArg || process.env.USERNAME || 'developer';
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const ts =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
  `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

const id = `${ts}_${desc}`;
const { dir } = KIND_MAP[kind];
const outPath = path.join(baseDir, dir, `${id}.yml`);
const obj = desc.toLowerCase();

let content = '';
if (kind === 'table') {
  content = `databaseChangeLog:
  - changeSet:
      id: ${id}
      author: ${author}
      changes:
        - createTable:
            tableName: ${obj}
            columns:
              - column:
                  name: id
                  type: UUID
                  defaultValueComputed: gen_random_uuid()
                  constraints:
                    primaryKey: true
                    nullable: false
              # TODO: thêm cột tại đây
      rollback:
        - dropTable:
            tableName: ${obj}
`;
} else if (kind === 'seed') {
  content = `databaseChangeLog:
  - changeSet:
      id: ${id}
      author: ${author}
      changes:
        - sql:
            dbms: postgresql
            sql: |-
              -- TODO: INSERT dữ liệu khởi tạo
              SELECT 1;
      rollback:
        - sql:
            dbms: postgresql
            sql: |-
              -- TODO: DELETE dữ liệu vừa insert
              SELECT 1;
`;
} else if (kind === 'view') {
  content = `databaseChangeLog:
  - changeSet:
      id: ${id}
      author: ${author}
      runOnChange: true
      changes:
        - createView:
            viewName: ${obj}
            replaceIfExists: true
            selectQuery: |-
              SELECT 1 AS dummy
      rollback:
        - dropView:
            viewName: ${obj}
`;
} else if (kind === 'function') {
  content = `databaseChangeLog:
  - changeSet:
      id: ${id}
      author: ${author}
      runOnChange: true
      changes:
        - sql:
            dbms: postgresql
            splitStatements: false
            sql: |-
              CREATE OR REPLACE FUNCTION ${obj}()
              RETURNS INTEGER
              LANGUAGE plpgsql
              AS $$
              BEGIN
                RETURN 1;
              END;
              $$;
      rollback:
        - sql:
            dbms: postgresql
            sql: DROP FUNCTION IF EXISTS ${obj}();
`;
} else {
  content = `databaseChangeLog:
  - changeSet:
      id: ${id}
      author: ${author}
      runOnChange: true
      changes:
        - sql:
            dbms: postgresql
            splitStatements: false
            sql: |-
              CREATE OR REPLACE PROCEDURE ${obj}()
              LANGUAGE plpgsql
              AS $$
              BEGIN
                -- TODO: implement
              END;
              $$;
      rollback:
        - sql:
            dbms: postgresql
            sql: DROP PROCEDURE IF EXISTS ${obj}();
`;
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, content, 'utf8');
console.log('Created changeset:', outPath);
