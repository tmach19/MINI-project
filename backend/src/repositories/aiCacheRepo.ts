import { memoryStore } from '../db/fallbackStore.js';
import { getDbMode, getPool } from '../db/pool.js';
import type {
  AiDictionaryEntry,
  TranslationCacheRecord,
  TranslationDirection,
} from '../types/domain.js';

const MAX_MEMORY_CACHE_ENTRIES = 300;
let warnedMissingCacheTable = false;

function isMissingTableError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '42P01';
}

export function buildTranslationCacheKey(
  direction: TranslationDirection,
  query: string
): string {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${direction}::${normalized}`;
}

export async function getCachedTranslation(
  direction: TranslationDirection,
  query: string
): Promise<TranslationCacheRecord | null> {
  const cacheKey = buildTranslationCacheKey(direction, query);

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const hit = memoryStore.translationCache.get(cacheKey);
    if (!hit) return null;
    hit.hitCount += 1;
    hit.updatedAt = new Date().toISOString();
    return hit;
  }

  const pool = getPool()!;
  try {
    const res = await pool.query<{
      cache_key: string;
      direction: TranslationDirection;
      query_text: string;
      source: string;
      model: string | null;
      payload: AiDictionaryEntry;
      hit_count: number;
      updated_at: Date;
    }>(
      `UPDATE translation_cache
       SET hit_count = hit_count + 1, updated_at = NOW()
       WHERE cache_key = $1
       RETURNING cache_key, direction, query_text, source, model, payload, hit_count, updated_at`,
      [cacheKey]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      cacheKey: row.cache_key,
      direction: row.direction,
      queryText: row.query_text,
      source: row.source,
      model: row.model,
      payload: row.payload,
      hitCount: row.hit_count,
      updatedAt: row.updated_at.toISOString(),
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      if (!warnedMissingCacheTable) {
        warnedMissingCacheTable = true;
        console.warn(
          '[AI Cache] Chưa thấy bảng translation_cache trên PostgreSQL — dùng cache RAM tạm thời cho tới khi chạy Liquibase.'
        );
      }
      return memoryStore.translationCache.get(cacheKey) || null;
    }
    throw err;
  }
}

export async function saveCachedTranslation(
  direction: TranslationDirection,
  query: string,
  model: string,
  payload: AiDictionaryEntry
): Promise<void> {
  const cacheKey = buildTranslationCacheKey(direction, query);
  const record: TranslationCacheRecord = {
    cacheKey,
    direction,
    queryText: query.trim(),
    source: 'ai',
    model,
    payload,
    hitCount: 1,
    updatedAt: new Date().toISOString(),
  };

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    if (memoryStore.translationCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
      const oldestKey = memoryStore.translationCache.keys().next().value;
      if (oldestKey) memoryStore.translationCache.delete(oldestKey);
    }
    memoryStore.translationCache.set(cacheKey, record);
    return;
  }

  const pool = getPool()!;
  try {
    await pool.query(
      `INSERT INTO translation_cache (cache_key, direction, query_text, source, model, payload, hit_count, created_at, updated_at)
       VALUES ($1, $2, $3, 'ai', $4, $5::jsonb, 1, NOW(), NOW())
       ON CONFLICT (cache_key) DO UPDATE
       SET query_text = EXCLUDED.query_text,
           model = EXCLUDED.model,
           payload = EXCLUDED.payload,
           hit_count = translation_cache.hit_count + 1,
           updated_at = NOW()`,
      [cacheKey, direction, query.trim(), model, JSON.stringify(payload)]
    );
  } catch (err) {
    if (isMissingTableError(err)) {
      memoryStore.translationCache.set(cacheKey, record);
      return;
    }
    throw err;
  }
}
