import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { env } from '../config/env.js';
import { sanitizeSslConnectionString } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

async function main() {
  if (!env.databaseUrl) {
    throw new Error('Thiếu DATABASE_URL trong en-backend/.env hoặc application.yml');
  }

  const targetUrl = new URL(env.databaseUrl);
  const targetDbName = targetUrl.pathname.replace(/^\//, '') || 'en-study';
  const needsSsl =
    env.databaseSsl === true ||
    (env.databaseSsl === 'auto' &&
      (env.databaseUrl.includes('supabase') || env.databaseUrl.includes('sslmode=require')));
  const sslOpt = needsSsl ? { rejectUnauthorized: false } : undefined;

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

  const client = new Client({
    connectionString: sanitizeSslConnectionString(env.databaseUrl, needsSsl),
    ssl: sslOpt,
  });
  await client.connect();
  try {
    const schemaPath = path.join(repoRoot, 'database', 'schema.sql');
    const seedPath = path.join(
      repoRoot,
      'db-migration',
      'src',
      'main',
      'resources',
      'db',
      'migration',
      'sql',
      'seed_en_a1_data.sql'
    );

    console.log('[Setup] Đang chạy database/schema.sql...');
    await client.query(fs.readFileSync(schemaPath, 'utf8'));

    console.log('[Setup] Đang nạp 31 bài học Tiếng Anh CEFR A1...');
    await client.query(fs.readFileSync(seedPath, 'utf8'));

    const countRes = await client.query<{ lessons: string; vocab: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM lessons WHERE language_code = 'en') AS lessons,
         (SELECT COUNT(*)::text FROM vocabularies v JOIN lessons l ON l.id = v.lesson_id WHERE l.language_code = 'en') AS vocab`
    );
    console.log(
      `[Setup] Hoàn tất! Đã nạp ${countRes.rows[0].lessons} bài học và ${countRes.rows[0].vocab} từ vựng Tiếng Anh.`
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[Setup Error]', err.message);
  process.exit(1);
});
