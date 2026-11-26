import { Pool } from 'pg';
import { env } from '../config/env.js';

let pool: Pool | null = null;
let dbMode: 'postgres' | 'memory' = 'memory';
let authDbMode: 'postgres' | 'memory' = 'memory';

export function getPool(): Pool | null {
  return pool;
}

export function getDbMode(): 'postgres' | 'memory' {
  return dbMode;
}

export function getAuthDbMode(): 'postgres' | 'memory' {
  return authDbMode;
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
    console.log('[DB] Không có DATABASE_URL -> chạy chế độ In-Memory từ ../database/en/lessons-a1.json');
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
    // Kiểm tra bảng users & lessons đã được tạo chưa
    const tableCheck = await candidate.query<{ has_users: boolean; has_lessons: boolean }>(
      `SELECT
         EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'users'
         ) AS has_users,
         EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'lessons'
         ) AS has_lessons`
    );

    const hasUsers = Boolean(tableCheck.rows[0]?.has_users);
    const hasLessons = Boolean(tableCheck.rows[0]?.has_lessons);

    if (hasUsers) {
      // Giữ kết nối PostgreSQL cho xác thực & RBAC dùng chung với backend Tiếng Trung (SSO)
      pool = candidate;
      authDbMode = 'postgres';
    }

    if (!hasLessons) {
      if (env.allowMemoryFallback) {
        if (!hasUsers) await candidate.end();
        dbMode = 'memory';
        console.warn('[DB] Kết nối PostgreSQL thành công nhưng chưa có bảng lessons -> bài học tạm dùng In-Memory từ ../database/en/lessons-a1.json');
        return dbMode;
      }
      throw new Error('PostgreSQL chưa có bảng lessons. Hãy chạy db-migration trước.');
    }

    let enCount = 0;
    try {
      const countRes = await candidate.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM lessons WHERE is_deleted = 0 AND language_code = 'en'`
      );
      enCount = Number(countRes.rows[0]?.cnt || 0);
    } catch (langErr) {
      if ((langErr as { code?: string } | null)?.code === '42703') {
        if (env.allowMemoryFallback) {
          if (!hasUsers) await candidate.end();
          dbMode = 'memory';
          console.warn(
            '[DB] PostgreSQL đã nối cho Tài khoản (SSO), nhưng chưa chạy Liquibase 20261125_172855 (thiếu cột language_code) -> bài học tạm đọc từ ../database/en/lessons-a1.json'
          );
          return dbMode;
        }
        throw new Error('PostgreSQL chưa chạy Liquibase migration đa ngôn ngữ (thiếu cột language_code).');
      }
      throw langErr;
    }

    if (enCount === 0 && env.allowMemoryFallback) {
      if (!hasUsers) await candidate.end();
      dbMode = 'memory';
      console.warn(
        '[DB] PostgreSQL đã nối cho Tài khoản (SSO), nhưng chưa có bài học Tiếng Anh (chưa chạy Liquibase seed_en_a1_lessons) -> bài học tạm đọc từ ../database/en/lessons-a1.json'
      );
      return dbMode;
    }

    pool = candidate;
    authDbMode = 'postgres';
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
    console.log(`[DB] Đã kết nối PostgreSQL (${enCount} bài học Tiếng Anh + Auth chung)`);
    return dbMode;
  } catch (err) {
    await candidate.end().catch(() => {});
    pool = null;
    authDbMode = 'memory';
    if (env.allowMemoryFallback) {
      dbMode = 'memory';
      console.warn(`[DB] Chưa kết nối được PostgreSQL (${(err as Error).message}) -> chạy tạm In-Memory từ ../database/en/lessons-a1.json`);
      return dbMode;
    }
    throw err;
  }
}
