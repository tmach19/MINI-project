import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { env } from '../config/env.js';
import { sanitizeSslConnectionString } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbDir = path.resolve(__dirname, '../../../database');

async function main() {
  if (!env.databaseUrl) {
    throw new Error('Thiếu DATABASE_URL trong backend/.env hoặc application.yml');
  }

  const targetUrl = new URL(env.databaseUrl);
  const targetDbName = targetUrl.pathname.replace(/^\//, '') || 'chinese_study';
  const needsSsl =
    env.databaseSsl === true ||
    (env.databaseSsl === 'auto' &&
      (env.databaseUrl.includes('supabase') || env.databaseUrl.includes('sslmode=require')));
  const sslOpt = needsSsl ? { rejectUnauthorized: false } : undefined;

  // 1. Kết nối tới database mặc định 'postgres' để tạo database đích nếu chưa có (chỉ áp dụng khi không phải Supabase 'postgres')
  if (targetDbName !== 'postgres') {
    const adminUrl = new URL(env.databaseUrl);
    adminUrl.pathname = '/postgres';
    const adminClient = new Client({ connectionString: adminUrl.toString(), ssl: sslOpt });
    await adminClient.connect();
    try {
      const existsRes = await adminClient.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [targetDbName]
      );
      if (existsRes.rowCount === 0) {
        const safeIdent = `"${targetDbName.replace(/"/g, '""')}"`;
        await adminClient.query(`CREATE DATABASE ${safeIdent}`);
        console.log(`[Setup] Đã tạo mới database "${targetDbName}".`);
      } else {
        console.log(`[Setup] Database "${targetDbName}" đã tồn tại.`);
      }
    } finally {
      await adminClient.end();
    }
  }

  // 2. Kết nối vào database đích và chạy schema.sql + seed.sql
  const client = new Client({
    connectionString: sanitizeSslConnectionString(env.databaseUrl, needsSsl),
    ssl: sslOpt,
  });
  await client.connect();
  try {
    const schemaPath = path.join(dbDir, 'schema.sql');
    const seedPath = path.join(dbDir, 'seed.sql');

    console.log('[Setup] Đang chạy database/schema.sql...');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await client.query(schemaSql);
    console.log('[Setup] Tạo 11 bảng thành công.');

    console.log('[Setup] Đang nạp dữ liệu 26 bài học từ database/seed.sql (có thể mất vài giây)...');
    const seedSql = fs.readFileSync(seedPath, 'utf8');
    await client.query(seedSql);

    const countRes = await client.query<{ lessons: string; vocab: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM lessons) AS lessons,
         (SELECT COUNT(*)::text FROM vocabularies) AS vocab`
    );
    console.log(
      `[Setup] Hoàn tất! Đã nạp ${countRes.rows[0].lessons} bài học và ${countRes.rows[0].vocab} từ vựng.`
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[Setup Error]', err.message);
  process.exit(1);
});
