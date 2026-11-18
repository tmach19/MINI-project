import { Pool } from 'pg';
import { env } from '../config/env.js';

let pool: Pool | null = null;
let dbMode: 'postgres' | 'memory' = 'memory';

export function getPool(): Pool | null {
  return pool;
}

export function getDbMode(): 'postgres' | 'memory' {
  return dbMode;
}

export function sanitizeSslConnectionString(rawUrl: string, needsSsl: boolean): string {
  if (!needsSsl) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    // pg-connection-string v2.x treats sslmode=require as verify-full and overrides ssl.rejectUnauthorized=false
    parsed.searchParams.delete('sslmode');
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export async function initDatabase(): Promise<'postgres' | 'memory'> {
  if (!env.databaseUrl) {
    if (!env.allowMemoryFallback) {
      throw new Error('DATABASE_URL chưa được cấu hình và ALLOW_MEMORY_FALLBACK=false');
    }
    dbMode = 'memory';
    console.log('[DB] Không có DATABASE_URL -> chạy chế độ In-Memory từ ../data.js');
    return dbMode;
  }

  const needsSsl =
    env.databaseSsl === true ||
    (env.databaseSsl === 'auto' &&
      (env.databaseUrl.includes('supabase') || env.databaseUrl.includes('sslmode=require')));

  const candidate = new Pool({
    connectionString: sanitizeSslConnectionString(env.databaseUrl, needsSsl),
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: env.connectionTimeoutMs,
    max: env.maxPoolSize,
  });

  try {
    await candidate.query('SELECT 1');
    // Kiểm tra bảng lessons đã được tạo và có dữ liệu chưa
    const tableCheck = await candidate.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'lessons'
       ) AS exists`
    );

    if (!tableCheck.rows[0]?.exists) {
      if (env.allowMemoryFallback) {
        await candidate.end();
        dbMode = 'memory';
        console.warn('[DB] Kết nối PostgreSQL thành công nhưng chưa chạy schema.sql -> tạm dùng In-Memory từ ../data.js');
        return dbMode;
      }
      throw new Error('PostgreSQL chưa có bảng lessons. Hãy chạy database/schema.sql trước.');
    }

    const countRes = await candidate.query<{ cnt: string }>('SELECT COUNT(*)::text AS cnt FROM lessons');
    const count = Number(countRes.rows[0]?.cnt || 0);
    if (count === 0 && env.allowMemoryFallback) {
      await candidate.end();
      dbMode = 'memory';
      console.warn('[DB] Bảng lessons đang trống (chưa seed.sql) -> tạm dùng In-Memory từ ../data.js');
      return dbMode;
    }

    pool = candidate;
    dbMode = 'postgres';
    // Đảm bảo bảng user_marked_vocab sẵn sàng ngay cả khi chưa chạy changeset Liquibase mới
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_marked_vocab (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        vocab_id TEXT NOT NULL REFERENCES vocabularies(id) ON DELETE CASCADE,
        note TEXT,
        marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_deleted SMALLINT NOT NULL DEFAULT 0,
        deleted_at TIMESTAMPTZ,
        CONSTRAINT uq_user_marked_vocab UNIQUE (user_id, vocab_id)
      );
      CREATE INDEX IF NOT EXISTS idx_marked_vocab_user ON user_marked_vocab (user_id, marked_at DESC);
    `);
    console.log(`[DB] Đã kết nối PostgreSQL (${count} bài học)`);
    return dbMode;
  } catch (err) {
    await candidate.end().catch(() => {});
    if (env.allowMemoryFallback) {
      dbMode = 'memory';
      console.warn(`[DB] Chưa kết nối được PostgreSQL (${(err as Error).message}) -> chạy tạm In-Memory từ ../data.js`);
      return dbMode;
    }
    throw err;
  }
}
