import { memoryStore } from '../db/fallbackStore.js';
import { getDbMode, getPool } from '../db/pool.js';
import type {
  AiDictionaryEntry,
  GameGradeDirection,
  GameGradeMode,
  GameGradingCacheRecord,
  TranslationCacheRecord,
  TranslationDirection,
  VocabGlossaryItem,
} from '../types/domain.js';

const MAX_MEMORY_CACHE_ENTRIES = 300;
let warnedMissingCacheTable = false;
let warnedMissingGameGradingTable = false;

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

export function buildGameGradingCacheKey(
  gameMode: GameGradeMode,
  exerciseId: string,
  direction: GameGradeDirection | null,
  normalizedAnswer: string
): string {
  const safeId = exerciseId.trim().toLowerCase();
  const safeDir = direction || 'none';
  return `v2::${gameMode}::${safeDir}::${safeId}::${normalizedAnswer}`;
}

export async function getCachedGameGrade(
  cacheKey: string
): Promise<GameGradingCacheRecord | null> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const hit = memoryStore.gameGradingCache.get(cacheKey);
    if (!hit) return null;
    hit.hitCount += 1;
    hit.updatedAt = new Date().toISOString();
    return hit;
  }

  const pool = getPool()!;
  try {
    const res = await pool.query<{
      cache_key: string;
      game_mode: GameGradeMode;
      direction: GameGradeDirection | null;
      exercise_id: string;
      user_answer: string;
      is_correct: boolean;
      feedback: string;
      suggestion: string | null;
      model: string | null;
      hit_count: number;
      updated_at: Date;
    }>(
      `UPDATE game_grading_cache
       SET hit_count = hit_count + 1, updated_at = NOW()
       WHERE cache_key = $1
       RETURNING cache_key, game_mode, direction, exercise_id, user_answer,
                 is_correct, feedback, suggestion, model, hit_count, updated_at`,
      [cacheKey]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      cacheKey: row.cache_key,
      gameMode: row.game_mode,
      direction: row.direction,
      exerciseId: row.exercise_id,
      userAnswer: row.user_answer,
      isCorrect: row.is_correct,
      feedback: row.feedback,
      suggestion: row.suggestion,
      model: row.model,
      hitCount: row.hit_count,
      updatedAt: row.updated_at.toISOString(),
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      if (!warnedMissingGameGradingTable) {
        warnedMissingGameGradingTable = true;
        console.warn(
          '[AI Game Cache] Chưa thấy bảng game_grading_cache trên PostgreSQL — dùng cache RAM tạm thời cho tới khi chạy Liquibase.'
        );
      }
      return memoryStore.gameGradingCache.get(cacheKey) || null;
    }
    throw err;
  }
}

export async function saveCachedGameGrade(params: {
  cacheKey: string;
  gameMode: GameGradeMode;
  direction: GameGradeDirection | null;
  exerciseId: string;
  userAnswer: string;
  isCorrect: boolean;
  feedback: string;
  suggestion: string | null;
  model: string | null;
}): Promise<void> {
  const record: GameGradingCacheRecord = {
    cacheKey: params.cacheKey,
    gameMode: params.gameMode,
    direction: params.direction,
    exerciseId: params.exerciseId,
    userAnswer: params.userAnswer.trim().slice(0, 600),
    isCorrect: params.isCorrect,
    feedback: params.feedback.trim().slice(0, 400),
    suggestion: params.suggestion ? params.suggestion.trim().slice(0, 400) : null,
    model: params.model,
    hitCount: 1,
    updatedAt: new Date().toISOString(),
  };

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    if (memoryStore.gameGradingCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
      const oldestKey = memoryStore.gameGradingCache.keys().next().value;
      if (oldestKey) memoryStore.gameGradingCache.delete(oldestKey);
    }
    memoryStore.gameGradingCache.set(params.cacheKey, record);
    return;
  }

  const pool = getPool()!;
  try {
    await pool.query(
      `INSERT INTO game_grading_cache (
         cache_key, game_mode, direction, exercise_id, user_answer,
         is_correct, feedback, suggestion, model, hit_count, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, NOW(), NOW())
       ON CONFLICT (cache_key) DO UPDATE
       SET user_answer = EXCLUDED.user_answer,
           is_correct = EXCLUDED.is_correct,
           feedback = EXCLUDED.feedback,
           suggestion = EXCLUDED.suggestion,
           model = EXCLUDED.model,
           hit_count = game_grading_cache.hit_count + 1,
           updated_at = NOW()`,
      [
        record.cacheKey,
        record.gameMode,
        record.direction,
        record.exerciseId,
        record.userAnswer,
        record.isCorrect,
        record.feedback,
        record.suggestion,
        record.model,
      ]
    );
  } catch (err) {
    if (isMissingTableError(err)) {
      memoryStore.gameGradingCache.set(params.cacheKey, record);
      return;
    }
    throw err;
  }
}

function collectMemoryAcceptedVariants(
  exerciseIds: string[],
  maxPerExercise: number
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const idSet = new Set(exerciseIds);
  if (idSet.size === 0) return result;

  const grouped = new Map<string, GameGradingCacheRecord[]>();
  for (const record of memoryStore.gameGradingCache.values()) {
    if (!record.isCorrect || !idSet.has(record.exerciseId)) continue;
    const mapKey = `${record.gameMode}::${record.exerciseId}`;
    const list = grouped.get(mapKey) || [];
    list.push(record);
    grouped.set(mapKey, list);
  }

  for (const [mapKey, records] of grouped.entries()) {
    records.sort(
      (a, b) => b.hitCount - a.hitCount || b.updatedAt.localeCompare(a.updatedAt)
    );
    const seen = new Set<string>();
    const variants: string[] = [];
    for (const r of records) {
      const answer = r.userAnswer.trim();
      const dedupKey = answer.toLowerCase();
      if (!answer || seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      variants.push(answer);
      if (variants.length >= maxPerExercise) break;
    }
    if (variants.length > 0) result.set(mapKey, variants);
  }

  return result;
}

/**
 * Read-through batch loader: lấy top biến thể đúng đã được AI xác nhận cho danh sách exerciseId
 * để trả kèm trong GET /api/lessons/:id, giúp FE chấm tức thì 0ms mà không cần gọi HTTP lẻ.
 * Key trả về: `${gameMode}::${exerciseId}`.
 */
export async function getAcceptedGameVariantsByExerciseIds(
  exerciseIds: string[],
  maxPerExercise = 8
): Promise<Map<string, string[]>> {
  const uniqueIds = Array.from(new Set(exerciseIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    return collectMemoryAcceptedVariants(uniqueIds, maxPerExercise);
  }

  const pool = getPool()!;
  try {
    const res = await pool.query<{
      game_mode: GameGradeMode;
      exercise_id: string;
      user_answer: string;
    }>(
      `WITH ranked AS (
         SELECT
           game_mode,
           exercise_id,
           user_answer,
           ROW_NUMBER() OVER (
             PARTITION BY game_mode, exercise_id
             ORDER BY hit_count DESC, updated_at DESC
           ) AS rn
         FROM game_grading_cache
         WHERE exercise_id = ANY($1::text[])
           AND is_correct = TRUE
       )
       SELECT game_mode, exercise_id, user_answer
       FROM ranked
       WHERE rn <= $2
       ORDER BY game_mode, exercise_id, rn ASC`,
      [uniqueIds, maxPerExercise]
    );

    const result = new Map<string, string[]>();
    for (const row of res.rows) {
      const answer = (row.user_answer || '').trim();
      if (!answer) continue;
      const mapKey = `${row.game_mode}::${row.exercise_id}`;
      const list = result.get(mapKey) || [];
      if (!list.some((item) => item.toLowerCase() === answer.toLowerCase())) {
        list.push(answer);
        result.set(mapKey, list);
      }
    }
    return result;
  } catch (err) {
    if (isMissingTableError(err)) {
      if (!warnedMissingGameGradingTable) {
        warnedMissingGameGradingTable = true;
        console.warn(
          '[AI Game Cache] Chưa thấy bảng game_grading_cache trên PostgreSQL — dùng cache RAM tạm thời cho tới khi chạy Liquibase.'
        );
      }
      return collectMemoryAcceptedVariants(uniqueIds, maxPerExercise);
    }
    console.warn('[AI Game Cache] Không đọc được acceptedVariants, bỏ qua read-through:', err);
    return new Map();
  }
}

function extractGlossaryFromCachePayload(payload: AiDictionaryEntry | null | undefined): VocabGlossaryItem | null {
  if (!payload) return null;
  const hanzi = String(payload.hanzi || '').trim();
  const meaning = String(payload.meaning || '').trim();
  if (!hanzi || !meaning) return null;
  // Chỉ nạp vào glossary hover các từ/cụm ngắn thuần Hán tự (<= 6 chữ)
  const cleanHanzi = hanzi.replace(/[^\u4e00-\u9fff]/g, '');
  if (!cleanHanzi || cleanHanzi.length > 6 || payload.isSentence) return null;
  return {
    hanzi: cleanHanzi,
    pinyin: String(payload.pinyin || '').trim(),
    sinoVietnamese: payload.sinoVietnamese ? String(payload.sinoVietnamese).trim() : null,
    meaning,
    wordType: payload.wordType ? String(payload.wordType).trim() : null,
    source: 'cache',
  };
}

export async function listCachedGlossaryEntries(limit = 400): Promise<VocabGlossaryItem[]> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const records = Array.from(memoryStore.translationCache.values())
      .filter((r) => r.direction === 'zh_vi' || r.direction === 'auto')
      .sort((a, b) => b.hitCount - a.hitCount || b.updatedAt.localeCompare(a.updatedAt));
    const items: VocabGlossaryItem[] = [];
    for (const r of records) {
      const item = extractGlossaryFromCachePayload(r.payload);
      if (item) items.push(item);
      if (items.length >= limit) break;
    }
    return items;
  }

  const pool = getPool()!;
  try {
    const res = await pool.query<{ payload: AiDictionaryEntry }>(
      `SELECT payload
       FROM translation_cache
       WHERE direction IN ('zh_vi', 'auto')
         AND COALESCE((payload->>'isSentence')::boolean, FALSE) = FALSE
       ORDER BY hit_count DESC, updated_at DESC
       LIMIT $1`,
      [limit]
    );
    const items: VocabGlossaryItem[] = [];
    for (const row of res.rows) {
      const item = extractGlossaryFromCachePayload(row.payload);
      if (item) items.push(item);
    }
    return items;
  } catch (err) {
    if (isMissingTableError(err)) {
      return Array.from(memoryStore.translationCache.values())
        .map((r) => extractGlossaryFromCachePayload(r.payload))
        .filter((x): x is VocabGlossaryItem => Boolean(x))
        .slice(0, limit);
    }
    console.warn('[AI Cache] Không đọc được glossary từ translation_cache:', err);
    return [];
  }
}
