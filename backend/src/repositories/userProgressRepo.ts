import crypto from 'node:crypto';
import { getDbMode, getPool } from '../db/pool.js';
import { memoryStore, type MemoryUser } from '../db/fallbackStore.js';
import { getEffectivePermissions } from './rbacRepo.js';
import type {
  DashboardActivityDay,
  DashboardSkillItem,
  DashboardSummary,
  GameLeaderboardEntry,
  GameMode,
  LessonAttemptDetailRecord,
  LessonTestSummaryRecord,
  MarkedVocabCard,
  MarkedVocabRecord,
  TestAttemptRecord,
  TestLeaderboardEntry,
  UserProfile,
} from '../types/domain.js';

export interface AuthenticatedUserRecord extends UserProfile {
  passwordHash: string;
}

function isUndefinedColumnError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '42703';
}

function isUndefinedTableError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '42P01';
}

export async function findUserByEmail(email: string): Promise<AuthenticatedUserRecord | null> {
  const normalized = email.trim().toLowerCase();
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const u = memoryStore.users.find((x) => x.email === normalized);
    if (!u) return null;
    const permissions = await getEffectivePermissions(u.id, u.role);
    return {
      ...u,
      avatarUrl: u.avatarUrl ?? null,
      coverUrl: u.coverUrl ?? null,
      isSuperAdmin: u.role === 'admin',
      permissions,
    };
  }

  const pool = getPool()!;
  let r:
    | {
        id: string;
        email: string;
        password_hash: string;
        display_name: string;
        role: 'user' | 'admin';
        avatar_url?: string | null;
        cover_url?: string | null;
        created_at: Date;
      }
    | undefined;
  try {
    const res = await pool.query(
      `SELECT id, email, password_hash, display_name, role, avatar_url, cover_url, created_at
       FROM users WHERE email = $1 AND is_deleted = 0`,
      [normalized]
    );
    r = res.rows[0];
  } catch (err) {
    if (!isUndefinedColumnError(err)) throw err;
    const res = await pool.query(
      `SELECT id, email, password_hash, display_name, role, created_at
       FROM users WHERE email = $1 AND is_deleted = 0`,
      [normalized]
    );
    r = res.rows[0];
  }
  if (!r) return null;
  const permissions = await getEffectivePermissions(r.id, r.role);
  return {
    id: r.id,
    email: r.email,
    passwordHash: r.password_hash,
    displayName: r.display_name,
    role: r.role,
    avatarUrl: r.avatar_url ?? null,
    coverUrl: r.cover_url ?? null,
    isSuperAdmin: r.role === 'admin',
    permissions,
    createdAt: r.created_at.toISOString(),
  };
}

export async function findUserById(userId: string): Promise<UserProfile | null> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const u = memoryStore.users.find((x) => x.id === userId);
    if (!u) return null;
    const { passwordHash: _pw, ...base } = u;
    const permissions = await getEffectivePermissions(base.id, base.role);
    return {
      ...base,
      avatarUrl: base.avatarUrl ?? null,
      coverUrl: base.coverUrl ?? null,
      isSuperAdmin: base.role === 'admin',
      permissions,
    };
  }

  const pool = getPool()!;
  let r:
    | {
        id: string;
        email: string;
        display_name: string;
        role: 'user' | 'admin';
        avatar_url?: string | null;
        cover_url?: string | null;
        created_at: Date;
      }
    | undefined;
  try {
    const res = await pool.query(
      `SELECT id, email, display_name, role, avatar_url, cover_url, created_at
       FROM users WHERE id = $1::uuid AND is_deleted = 0`,
      [userId]
    );
    r = res.rows[0];
  } catch (err) {
    if (!isUndefinedColumnError(err)) throw err;
    const res = await pool.query(
      `SELECT id, email, display_name, role, created_at
       FROM users WHERE id = $1::uuid AND is_deleted = 0`,
      [userId]
    );
    r = res.rows[0];
  }
  if (!r) return null;
  const permissions = await getEffectivePermissions(r.id, r.role);
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    avatarUrl: r.avatar_url ?? null,
    coverUrl: r.cover_url ?? null,
    isSuperAdmin: r.role === 'admin',
    permissions,
    createdAt: r.created_at.toISOString(),
  };
}

export async function createUser(
  email: string,
  passwordHash: string,
  displayName: string
): Promise<UserProfile> {
  const normalized = email.trim().toLowerCase();
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const user: MemoryUser = {
      id: crypto.randomUUID(),
      email: normalized,
      passwordHash,
      displayName: displayName.trim(),
      role: 'user',
      createdAt: new Date().toISOString(),
    };
    memoryStore.users.push(user);
    const { passwordHash: _pw, ...base } = user;
    const permissions = await getEffectivePermissions(base.id, base.role);
    return { ...base, isSuperAdmin: false, permissions };
  }

  const pool = getPool()!;
  const res = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    role: 'user' | 'admin';
    created_at: Date;
  }>(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING id, email, display_name, role, created_at`,
    [normalized, passwordHash, displayName.trim()]
  );
  const r = res.rows[0];
  const permissions = await getEffectivePermissions(r.id, r.role);
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    isSuperAdmin: r.role === 'admin',
    permissions,
    createdAt: r.created_at.toISOString(),
  };
}

export interface UpdateUserProfilePatch {
  displayName?: string;
  avatarUrl?: string | null;
  coverUrl?: string | null;
}

export async function updateUserProfile(
  userId: string,
  patch: UpdateUserProfilePatch
): Promise<UserProfile | null> {
  const hasDisplayName = patch.displayName !== undefined;
  const cleanName = hasDisplayName
    ? String(patch.displayName || '').trim().replace(/\s+/g, ' ')
    : undefined;
  if (hasDisplayName && !cleanName) return null;

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const u = memoryStore.users.find((x) => x.id === userId);
    if (!u) return null;
    if (hasDisplayName && cleanName) u.displayName = cleanName;
    if (patch.avatarUrl !== undefined) u.avatarUrl = patch.avatarUrl;
    if (patch.coverUrl !== undefined) u.coverUrl = patch.coverUrl;
    const { passwordHash: _pw, ...base } = u;
    const permissions = await getEffectivePermissions(base.id, base.role);
    return {
      ...base,
      avatarUrl: base.avatarUrl ?? null,
      coverUrl: base.coverUrl ?? null,
      isSuperAdmin: base.role === 'admin',
      permissions,
    };
  }

  const pool = getPool()!;
  const sets: string[] = [];
  const params: unknown[] = [];

  if (hasDisplayName && cleanName) {
    params.push(cleanName);
    sets.push(`display_name = $${params.length}`);
  }
  if (patch.avatarUrl !== undefined) {
    params.push(patch.avatarUrl);
    sets.push(`avatar_url = $${params.length}`);
  }
  if (patch.coverUrl !== undefined) {
    params.push(patch.coverUrl);
    sets.push(`cover_url = $${params.length}`);
  }

  if (sets.length === 0) {
    return findUserById(userId);
  }

  sets.push('updated_at = NOW()');
  params.push(userId);
  const idParamIdx = params.length;

  try {
    const res = await pool.query<{
      id: string;
      email: string;
      display_name: string;
      role: 'user' | 'admin';
      avatar_url: string | null;
      cover_url: string | null;
      created_at: Date;
    }>(
      `UPDATE users
       SET ${sets.join(', ')}
       WHERE id = $${idParamIdx}::uuid AND is_deleted = 0
       RETURNING id, email, display_name, role, avatar_url, cover_url, created_at`,
      params
    );
    const r = res.rows[0];
    if (!r) return null;
    const permissions = await getEffectivePermissions(r.id, r.role);
    return {
      id: r.id,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      avatarUrl: r.avatar_url ?? null,
      coverUrl: r.cover_url ?? null,
      isSuperAdmin: r.role === 'admin',
      permissions,
      createdAt: r.created_at.toISOString(),
    };
  } catch (err) {
    if (isUndefinedColumnError(err)) {
      throw new Error('Cơ sở dữ liệu chưa cập nhật cột ảnh đại diện/ảnh nền. Hãy chạy DbMigration trước.');
    }
    throw err;
  }
}

export async function updateUserDisplayName(
  userId: string,
  displayName: string
): Promise<UserProfile | null> {
  return updateUserProfile(userId, { displayName });
}

export async function getMarkedVocabMap(
  userId: string
): Promise<Record<string, MarkedVocabRecord>> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const map = memoryStore.markedByUser.get(userId);
    const result: Record<string, MarkedVocabRecord> = {};
    if (map) {
      map.forEach((v, k) => {
        if (v.isDeleted !== 1) result[k] = v;
      });
    }
    return result;
  }

  const pool = getPool()!;
  type MarkMapRow = { vocab_id: string; note: string | null; marked_at: Date };
  let rows: MarkMapRow[];
  try {
    const res = await pool.query<MarkMapRow>(
      `WITH canonical_vocab AS (
         SELECT
           id,
           FIRST_VALUE(id) OVER (
             PARTITION BY lesson_id, btrim(hanzi)
             ORDER BY
               CASE WHEN id ~ '^v[0-9]+_[0-9]+$' THEN 0 ELSE 1 END ASC,
               CASE WHEN sino_vietnamese IS NOT NULL AND btrim(sino_vietnamese) <> '' THEN 0 ELSE 1 END ASC,
               CASE WHEN radical IS NOT NULL AND radical NOT ILIKE 'Bộ cấu tạo [%' THEN 0 ELSE 1 END ASC,
               sort_order ASC,
               id ASC
           ) AS keeper_id
         FROM vocabularies
         WHERE is_deleted = 0
       )
       SELECT DISTINCT ON (cv.keeper_id)
         cv.keeper_id AS vocab_id, m.note, m.marked_at
       FROM user_marked_vocab m
       JOIN canonical_vocab cv ON cv.id = m.vocab_id
       JOIN vocabularies v ON v.id = cv.keeper_id AND v.is_deleted = 0
       JOIN lessons l ON l.id = v.lesson_id AND l.is_deleted = 0
       WHERE m.user_id = $1::uuid
         AND m.is_deleted = 0
         AND l.language_code = 'zh'
       ORDER BY cv.keeper_id, m.marked_at DESC`,
      [userId]
    );
    rows = res.rows;
  } catch (err) {
    if (!isUndefinedColumnError(err)) throw err;
    const res = await pool.query<MarkMapRow>(
      `WITH canonical_vocab AS (
         SELECT
           id,
           FIRST_VALUE(id) OVER (
             PARTITION BY lesson_id, btrim(hanzi)
             ORDER BY
               CASE WHEN id ~ '^v[0-9]+_[0-9]+$' THEN 0 ELSE 1 END ASC,
               CASE WHEN sino_vietnamese IS NOT NULL AND btrim(sino_vietnamese) <> '' THEN 0 ELSE 1 END ASC,
               CASE WHEN radical IS NOT NULL AND radical NOT ILIKE 'Bộ cấu tạo [%' THEN 0 ELSE 1 END ASC,
               sort_order ASC,
               id ASC
           ) AS keeper_id
         FROM vocabularies
         WHERE is_deleted = 0
       )
       SELECT DISTINCT ON (cv.keeper_id)
         cv.keeper_id AS vocab_id, m.note, m.marked_at
       FROM user_marked_vocab m
       JOIN canonical_vocab cv ON cv.id = m.vocab_id
       JOIN vocabularies v ON v.id = cv.keeper_id AND v.is_deleted = 0
       JOIN lessons l ON l.id = v.lesson_id AND l.is_deleted = 0
       WHERE m.user_id = $1::uuid
         AND m.is_deleted = 0
       ORDER BY cv.keeper_id, m.marked_at DESC`,
      [userId]
    );
    rows = res.rows;
  }

  const result: Record<string, MarkedVocabRecord> = {};
  for (const r of rows) {
    result[r.vocab_id] = {
      vocabId: r.vocab_id,
      note: r.note,
      markedAt: r.marked_at.toISOString(),
    };
  }
  return result;
}

export async function toggleMarkedVocab(
  userId: string,
  vocabId: string,
  marked?: boolean,
  note?: string | null
): Promise<{ marked: boolean; record: MarkedVocabRecord | null }> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    let userMap = memoryStore.markedByUser.get(userId);
    if (!userMap) {
      userMap = new Map();
      memoryStore.markedByUser.set(userId, userMap);
    }

    const existing = userMap.get(vocabId);
    const currentlyMarked = Boolean(existing && existing.isDeleted !== 1);
    const shouldMark = marked !== undefined ? marked : !currentlyMarked;

    if (!shouldMark) {
      if (existing) {
        userMap.set(vocabId, {
          ...existing,
          isDeleted: 1,
          deletedAt: new Date().toISOString(),
        });
      }
      return { marked: false, record: null };
    }

    const record: MarkedVocabRecord = {
      vocabId,
      note: note ?? existing?.note ?? null,
      markedAt: new Date().toISOString(),
      isDeleted: 0,
      deletedAt: null,
    };
    userMap.set(vocabId, record);
    return { marked: true, record };
  }

  const pool = getPool()!;
  let shouldMark = marked;
  if (shouldMark === undefined) {
    const existing = await pool.query(
      `SELECT 1
       FROM user_marked_vocab m
       WHERE m.user_id = $1::uuid
         AND m.is_deleted = 0
         AND (
           m.vocab_id = $2
           OR m.vocab_id IN (
             SELECT v2.id
             FROM vocabularies v1
             JOIN vocabularies v2
               ON v2.lesson_id = v1.lesson_id
              AND btrim(v2.hanzi) = btrim(v1.hanzi)
              AND v2.is_deleted = 0
             WHERE v1.id = $2
           )
         )
       LIMIT 1`,
      [userId, vocabId]
    );
    shouldMark = existing.rowCount === 0;
  }

  if (!shouldMark) {
    await pool.query(
      `UPDATE user_marked_vocab
       SET is_deleted = 1, deleted_at = NOW()
       WHERE user_id = $1::uuid
         AND is_deleted = 0
         AND (
           vocab_id = $2
           OR vocab_id IN (
             SELECT v2.id
             FROM vocabularies v1
             JOIN vocabularies v2
               ON v2.lesson_id = v1.lesson_id
              AND btrim(v2.hanzi) = btrim(v1.hanzi)
              AND v2.is_deleted = 0
             WHERE v1.id = $2
           )
         )`,
      [userId, vocabId]
    );
    return { marked: false, record: null };
  }

  const res = await pool.query<{ vocab_id: string; note: string | null; marked_at: Date }>(
    `INSERT INTO user_marked_vocab (user_id, vocab_id, note, marked_at, is_deleted, deleted_at)
     VALUES ($1::uuid, $2, $3, NOW(), 0, NULL)
     ON CONFLICT (user_id, vocab_id) DO UPDATE SET
       note = COALESCE(EXCLUDED.note, user_marked_vocab.note),
       marked_at = NOW(),
       is_deleted = 0,
       deleted_at = NULL
     RETURNING vocab_id, note, marked_at`,
    [userId, vocabId, note ?? null]
  );

  const row = res.rows[0];
  return {
    marked: true,
    record: {
      vocabId: row.vocab_id,
      note: row.note,
      markedAt: row.marked_at.toISOString(),
    },
  };
}

export async function syncGuestMarkedVocab(
  userId: string,
  vocabIds: string[]
): Promise<Record<string, MarkedVocabRecord>> {
  for (const vocabId of vocabIds) {
    if (!vocabId) continue;
    await toggleMarkedVocab(userId, vocabId, true);
  }
  return getMarkedVocabMap(userId);
}

export async function getMarkedVocabCards(userId: string): Promise<MarkedVocabCard[]> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const userMap = memoryStore.markedByUser.get(userId);
    if (!userMap) return [];
    const cards: MarkedVocabCard[] = [];
    const orderedLessons = [...memoryStore.lessons].sort(
      (a, b) => Number(b.isSystem) - Number(a.isSystem)
    );

    for (const l of orderedLessons) {
      if (l.isDeleted === 1) continue;
      for (const v of l.vocabulary) {
        const mark = userMap.get(v.id);
        if (mark && mark.isDeleted !== 1) {
          cards.push({
            ...v,
            lessonId: l.id,
            lessonTitle: l.title,
            markedAt: mark.markedAt,
            note: mark.note,
          });
        }
      }
    }
    return cards;
  }

  const pool = getPool()!;
  let rows: any[];
  try {
    const res = await pool.query(
      `WITH canonical_vocab AS (
         SELECT
           id,
           FIRST_VALUE(id) OVER (
             PARTITION BY lesson_id, btrim(hanzi)
             ORDER BY
               CASE WHEN id ~ '^v[0-9]+_[0-9]+$' THEN 0 ELSE 1 END ASC,
               CASE WHEN sino_vietnamese IS NOT NULL AND btrim(sino_vietnamese) <> '' THEN 0 ELSE 1 END ASC,
               CASE WHEN radical IS NOT NULL AND radical NOT ILIKE 'Bộ cấu tạo [%' THEN 0 ELSE 1 END ASC,
               sort_order ASC,
               id ASC
           ) AS keeper_id
         FROM vocabularies
         WHERE is_deleted = 0
       ),
       dedup_marks AS (
         SELECT DISTINCT ON (cv.keeper_id)
           cv.keeper_id AS vocab_id,
           m.note,
           m.marked_at
         FROM user_marked_vocab m
         JOIN canonical_vocab cv ON cv.id = m.vocab_id
         WHERE m.user_id = $1::uuid
           AND m.is_deleted = 0
         ORDER BY cv.keeper_id, m.marked_at DESC
       )
       SELECT
         v.id, v.hanzi, v.pinyin, v.sino_vietnamese, v.meaning, v.word_type,
         v.radical, v.breakdown, v.mnemonic, v.example_hanzi, v.example_pinyin, v.example_meaning,
         l.id AS lesson_id, l.title AS lesson_title,
         dm.note, dm.marked_at
       FROM dedup_marks dm
       JOIN vocabularies v ON v.id = dm.vocab_id AND v.is_deleted = 0
       JOIN lessons l ON l.id = v.lesson_id AND l.is_deleted = 0
       WHERE l.language_code = 'zh'
       ORDER BY l.is_system DESC, l.sort_order ASC, l.created_at ASC, v.sort_order ASC, dm.marked_at DESC`,
      [userId]
    );
    rows = res.rows;
  } catch (err) {
    if (!isUndefinedColumnError(err)) throw err;
    const res = await pool.query(
      `WITH canonical_vocab AS (
         SELECT
           id,
           FIRST_VALUE(id) OVER (
             PARTITION BY lesson_id, btrim(hanzi)
             ORDER BY
               CASE WHEN id ~ '^v[0-9]+_[0-9]+$' THEN 0 ELSE 1 END ASC,
               CASE WHEN sino_vietnamese IS NOT NULL AND btrim(sino_vietnamese) <> '' THEN 0 ELSE 1 END ASC,
               CASE WHEN radical IS NOT NULL AND radical NOT ILIKE 'Bộ cấu tạo [%' THEN 0 ELSE 1 END ASC,
               sort_order ASC,
               id ASC
           ) AS keeper_id
         FROM vocabularies
         WHERE is_deleted = 0
       ),
       dedup_marks AS (
         SELECT DISTINCT ON (cv.keeper_id)
           cv.keeper_id AS vocab_id,
           m.note,
           m.marked_at
         FROM user_marked_vocab m
         JOIN canonical_vocab cv ON cv.id = m.vocab_id
         WHERE m.user_id = $1::uuid
           AND m.is_deleted = 0
         ORDER BY cv.keeper_id, m.marked_at DESC
       )
       SELECT
         v.id, v.hanzi, v.pinyin, v.sino_vietnamese, v.meaning, v.word_type,
         v.radical, v.breakdown, v.mnemonic, v.example_hanzi, v.example_pinyin, v.example_meaning,
         l.id AS lesson_id, l.title AS lesson_title,
         dm.note, dm.marked_at
       FROM dedup_marks dm
       JOIN vocabularies v ON v.id = dm.vocab_id AND v.is_deleted = 0
       JOIN lessons l ON l.id = v.lesson_id AND l.is_deleted = 0
       ORDER BY l.is_system DESC, l.sort_order ASC, l.created_at ASC, v.sort_order ASC, dm.marked_at DESC`,
      [userId]
    );
    rows = res.rows;
  }

  return rows.map((r) => ({
    id: r.id,
    hanzi: r.hanzi,
    pinyin: r.pinyin,
    sinoVietnamese: r.sino_vietnamese,
    meaning: r.meaning,
    type: r.word_type,
    radical: r.radical,
    breakdown: r.breakdown,
    mnemonic: r.mnemonic,
    example: r.example_hanzi,
    examplePinyin: r.example_pinyin,
    exampleMeaning: r.example_meaning,
    lessonId: r.lesson_id,
    lessonTitle: r.lesson_title,
    markedAt: r.marked_at.toISOString(),
    note: r.note,
  }));
}

export async function saveTestAttempt(
  userId: string,
  payload: Omit<TestAttemptRecord, 'id' | 'submittedAt'>
): Promise<TestAttemptRecord> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const list = memoryStore.attemptsByUser.get(userId) || [];
    const lesson = payload.lessonId
      ? memoryStore.lessons.find((l) => l.id === payload.lessonId)
      : undefined;
    const resolvedTitle =
      payload.examTitle || lesson?.title || payload.lessonId || 'Kiểm tra tổng hợp (26 bài)';
    const rec: TestAttemptRecord = {
      id: crypto.randomUUID(),
      lessonId: payload.lessonId || null,
      lessonTitle: resolvedTitle,
      examTitle: payload.examTitle || null,
      score: payload.score,
      totalQuestions: payload.totalQuestions,
      correctCount: payload.correctCount,
      durationSeconds: payload.durationSeconds,
      answers: payload.answers,
      submittedAt: new Date().toISOString(),
    };
    list.unshift(rec);
    memoryStore.attemptsByUser.set(userId, list);
    return rec;
  }

  const pool = getPool()!;
  let row: { id: string; submitted_at: Date };
  try {
    const res = await pool.query<{ id: string; submitted_at: Date }>(
      `INSERT INTO test_attempts (user_id, lesson_id, language_code, exam_title, score, total_questions, correct_count, duration_seconds, answers)
       VALUES ($1::uuid, $2, 'zh', $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id, submitted_at`,
      [
        userId,
        payload.lessonId || null,
        payload.examTitle || null,
        payload.score,
        payload.totalQuestions,
        payload.correctCount,
        payload.durationSeconds,
        JSON.stringify(payload.answers || {}),
      ]
    );
    row = res.rows[0];
  } catch (err) {
    if (!isUndefinedColumnError(err)) throw err;
    const res = await pool.query<{ id: string; submitted_at: Date }>(
      `INSERT INTO test_attempts (user_id, lesson_id, exam_title, score, total_questions, correct_count, duration_seconds, answers)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id, submitted_at`,
      [
        userId,
        payload.lessonId || null,
        payload.examTitle || null,
        payload.score,
        payload.totalQuestions,
        payload.correctCount,
        payload.durationSeconds,
        JSON.stringify(payload.answers || {}),
      ]
    );
    row = res.rows[0];
  }
  return {
    id: row.id,
    lessonId: payload.lessonId || null,
    examTitle: payload.examTitle || null,
    lessonTitle: payload.examTitle || undefined,
    score: payload.score,
    totalQuestions: payload.totalQuestions,
    correctCount: payload.correctCount,
    durationSeconds: payload.durationSeconds,
    answers: payload.answers,
    submittedAt: row.submitted_at.toISOString(),
  };
}

export async function listTestAttempts(userId: string): Promise<TestAttemptRecord[]> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    return memoryStore.attemptsByUser.get(userId) || [];
  }

  const pool = getPool()!;
  let rows: any[];
  try {
    const res = await pool.query(
      `SELECT a.id, a.lesson_id, a.exam_title, l.title AS lesson_title, a.score, a.total_questions, a.correct_count, a.duration_seconds, a.answers, a.submitted_at
       FROM test_attempts a
       LEFT JOIN lessons l ON l.id = a.lesson_id AND l.is_deleted = 0
       WHERE a.user_id = $1::uuid
         AND a.is_deleted = 0
         AND COALESCE(l.language_code, a.language_code, 'zh') = 'zh'
       ORDER BY a.submitted_at DESC`,
      [userId]
    );
    rows = res.rows;
  } catch (err) {
    if (!isUndefinedColumnError(err)) throw err;
    const res = await pool.query(
      `SELECT a.id, a.lesson_id, a.exam_title, l.title AS lesson_title, a.score, a.total_questions, a.correct_count, a.duration_seconds, a.answers, a.submitted_at
       FROM test_attempts a
       LEFT JOIN lessons l ON l.id = a.lesson_id AND l.is_deleted = 0
       WHERE a.user_id = $1::uuid
         AND a.is_deleted = 0
       ORDER BY a.submitted_at DESC`,
      [userId]
    );
    rows = res.rows;
  }

  return rows.map((r) => ({
    id: r.id,
    lessonId: r.lesson_id,
    examTitle: r.exam_title,
    lessonTitle: r.exam_title || r.lesson_title || 'Kiểm tra tổng hợp (26 bài)',
    score: r.score,
    totalQuestions: r.total_questions,
    correctCount: r.correct_count,
    durationSeconds: r.duration_seconds,
    answers: r.answers || {},
    submittedAt: r.submitted_at.toISOString(),
  }));
}

export async function getUserLessonTestSummary(
  userId: string
): Promise<LessonTestSummaryRecord[]> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const userAttempts = (memoryStore.attemptsByUser.get(userId) || []).filter((a) =>
      Boolean(a.lessonId)
    );
    const byLesson = new Map<string, TestAttemptRecord[]>();
    userAttempts.forEach((a) => {
      if (!a.lessonId) return;
      const arr = byLesson.get(a.lessonId) || [];
      arr.push(a);
      byLesson.set(a.lessonId, arr);
    });

    const visibleLessons = memoryStore.lessons
      .filter((l) => l.isDeleted !== 1 && (l.isSystem || l.ownerId === userId))
      .sort((a, b) => Number(b.isSystem) - Number(a.isSystem));

    const summaries: LessonTestSummaryRecord[] = visibleLessons.map((l) => {
      const list = byLesson.get(l.id) || [];
      if (list.length === 0) {
        return {
          lessonId: l.id,
          lessonTitle: l.title,
          attemptCount: 0,
          avgScore: null,
          scoreSum: 0,
          bestScore: null,
          avgCorrect: null,
          totalQuestions: null,
          avgDurationSeconds: null,
          lastSubmittedAt: null,
          status: 'unattempted',
        };
      }
      const attemptCount = list.length;
      const scoreSum = list.reduce((s, x) => s + x.score, 0);
      const avgScore = Math.round(scoreSum / attemptCount);
      const bestScore = Math.max(...list.map((x) => x.score));
      const avgCorrect = Math.round(list.reduce((s, x) => s + x.correctCount, 0) / attemptCount);
      const totalQuestions = Math.max(...list.map((x) => x.totalQuestions));
      const avgDurationSeconds = Math.round(
        list.reduce((s, x) => s + x.durationSeconds, 0) / attemptCount
      );
      const lastSubmittedAt = list.reduce(
        (max, x) => (x.submittedAt > max ? x.submittedAt : max),
        list[0].submittedAt
      );
      return {
        lessonId: l.id,
        lessonTitle: l.title,
        attemptCount,
        avgScore,
        scoreSum,
        bestScore,
        avgCorrect,
        totalQuestions,
        avgDurationSeconds,
        lastSubmittedAt,
        status: avgScore >= 60 ? 'passed' : 'failed',
      };
    });

    summaries.sort((a, b) => {
      const aHas = a.attemptCount > 0 ? 1 : 0;
      const bHas = b.attemptCount > 0 ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      if (a.lastSubmittedAt && b.lastSubmittedAt && a.lastSubmittedAt !== b.lastSubmittedAt) {
        return b.lastSubmittedAt.localeCompare(a.lastSubmittedAt);
      }
      return 0;
    });

    return summaries;
  }

  const pool = getPool()!;
  type SummaryRow = {
    lesson_id: string;
    lesson_title: string;
    attempt_count: number;
    avg_score: number | null;
    score_sum: string | number;
    best_score: number | null;
    avg_correct: number | null;
    total_questions: number | null;
    avg_duration_seconds: number | null;
    last_submitted_at: Date | null;
    status: 'passed' | 'failed' | 'unattempted';
  };
  let rows: SummaryRow[];
  try {
    const res = await pool.query<SummaryRow>(
      'SELECT * FROM fn_get_user_lesson_test_summary($1::uuid, $2)',
      [userId, 'zh']
    );
    rows = res.rows;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== '42883') throw err;
    const res = await pool.query<SummaryRow>(
      'SELECT * FROM fn_get_user_lesson_test_summary($1::uuid)',
      [userId]
    );
    rows = res.rows;
  }

  return rows.map((r) => ({
    lessonId: r.lesson_id,
    lessonTitle: r.lesson_title,
    attemptCount: Number(r.attempt_count || 0),
    avgScore: r.avg_score !== null ? Number(r.avg_score) : null,
    scoreSum: Number(r.score_sum || 0),
    bestScore: r.best_score !== null ? Number(r.best_score) : null,
    avgCorrect: r.avg_correct !== null ? Number(r.avg_correct) : null,
    totalQuestions: r.total_questions !== null ? Number(r.total_questions) : null,
    avgDurationSeconds: r.avg_duration_seconds !== null ? Number(r.avg_duration_seconds) : null,
    lastSubmittedAt: r.last_submitted_at ? r.last_submitted_at.toISOString() : null,
    status: r.status,
  }));
}

export async function getUserLessonAttemptDetails(
  userId: string,
  lessonId: string | null,
  limit = 50
): Promise<LessonAttemptDetailRecord[]> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const list = (memoryStore.attemptsByUser.get(userId) || [])
      .filter((a) => (lessonId === null ? a.lessonId === null : a.lessonId === lessonId))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .slice(0, Math.max(1, limit));

    return list.map((a) => ({
      id: a.id,
      lessonId: a.lessonId,
      examTitle: a.examTitle ?? null,
      score: a.score,
      totalQuestions: a.totalQuestions,
      correctCount: a.correctCount,
      durationSeconds: a.durationSeconds,
      submittedAt: a.submittedAt,
    }));
  }

  const pool = getPool()!;
  const safeLimit = Math.max(1, Math.min(200, Math.round(Number(limit) || 50)));
  type AttemptDetailRow = {
    id: string;
    lesson_id: string | null;
    exam_title: string | null;
    score: number;
    total_questions: number;
    correct_count: number;
    duration_seconds: number;
    submitted_at: Date;
  };

  let rows: AttemptDetailRow[];
  try {
    const res = await pool.query<AttemptDetailRow>(
      `SELECT a.id, a.lesson_id, a.exam_title, a.score, a.total_questions, a.correct_count, a.duration_seconds, a.submitted_at
       FROM test_attempts a
       LEFT JOIN lessons l ON l.id = a.lesson_id AND l.is_deleted = 0
       WHERE a.user_id = $1::uuid
         AND a.is_deleted = 0
         AND (
           ($2::text IS NULL AND a.lesson_id IS NULL)
           OR ($2::text IS NOT NULL AND a.lesson_id = $2::text)
         )
         AND COALESCE(l.language_code, a.language_code, 'zh') = 'zh'
       ORDER BY a.submitted_at DESC
       LIMIT $3`,
      [userId, lessonId, safeLimit]
    );
    rows = res.rows;
  } catch (err) {
    if (!isUndefinedColumnError(err)) throw err;
    const res = await pool.query<AttemptDetailRow>(
      `SELECT d.id, d.lesson_id, t.exam_title, d.score, d.total_questions, d.correct_count, d.duration_seconds, d.submitted_at
       FROM fn_get_user_lesson_attempt_details($1::uuid, $2, $3) d
       LEFT JOIN test_attempts t ON t.id = d.id AND t.is_deleted = 0
       ORDER BY d.submitted_at DESC`,
      [userId, lessonId, safeLimit]
    );
    rows = res.rows;
  }

  return rows.map((r) => ({
    id: r.id,
    lessonId: r.lesson_id,
    examTitle: r.exam_title,
    score: r.score,
    totalQuestions: r.total_questions,
    correctCount: r.correct_count,
    durationSeconds: r.duration_seconds,
    submittedAt: r.submitted_at.toISOString(),
  }));
}

export const VALID_GAME_MODES: readonly GameMode[] = [
  'tri_match',
  'scramble',
  'translation',
  'expanded_quiz',
];

export async function saveGameScore(
  userId: string,
  payload: {
    lessonId: string;
    gameMode: GameMode;
    score: number;
    maxScore?: number | null;
    durationSeconds: number;
  }
): Promise<GameLeaderboardEntry> {
  const safeScore = Math.max(0, Math.round(Number(payload.score) || 0));
  const safeMaxScore =
    payload.maxScore !== undefined && payload.maxScore !== null
      ? Math.max(0, Math.round(Number(payload.maxScore) || 0))
      : null;
  const safeDuration = Math.max(0, Math.round(Number(payload.durationSeconds) || 0));

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const id = crypto.randomUUID();
    const playedAt = new Date().toISOString();
    const lesson = memoryStore.lessons.find((l) => l.id === payload.lessonId && l.isDeleted !== 1);
    memoryStore.gameScores.push({
      id,
      userId,
      lessonId: payload.lessonId,
      gameMode: payload.gameMode,
      score: safeScore,
      maxScore: safeMaxScore,
      durationSeconds: safeDuration,
      playedAt,
      isDeleted: 0,
      deletedAt: null,
    });
    const user = memoryStore.users.find((u) => u.id === userId);
    return {
      id,
      userId,
      displayName: user?.displayName || 'Người học',
      avatarUrl: user?.avatarUrl ?? null,
      role: user?.role || 'user',
      lessonId: payload.lessonId,
      lessonTitle: lesson?.title ?? null,
      gameMode: payload.gameMode,
      score: safeScore,
      maxScore: safeMaxScore,
      durationSeconds: safeDuration,
      playedAt,
    };
  }

  const pool = getPool()!;
  try {
    const insertRes = await pool.query<{ id: string; played_at: Date }>(
      `INSERT INTO game_scores (user_id, lesson_id, game_mode, score, max_score, duration_seconds)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)
       RETURNING id, played_at`,
      [userId, payload.lessonId, payload.gameMode, safeScore, safeMaxScore, safeDuration]
    );
    const inserted = insertRes.rows[0];

    const mapRow = (row: {
      display_name: string;
      avatar_url: string | null;
      role: 'user' | 'admin';
      lesson_title: string | null;
    }): GameLeaderboardEntry => ({
      id: inserted.id,
      userId,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? null,
      role: row.role,
      lessonId: payload.lessonId,
      lessonTitle: row.lesson_title ?? null,
      gameMode: payload.gameMode,
      score: safeScore,
      maxScore: safeMaxScore,
      durationSeconds: safeDuration,
      playedAt: inserted.played_at.toISOString(),
    });

    try {
      const infoRes = await pool.query<{
        display_name: string;
        avatar_url: string | null;
        role: 'user' | 'admin';
        lesson_title: string | null;
      }>(
        `SELECT u.display_name, u.avatar_url, u.role, l.title AS lesson_title
         FROM users u
         LEFT JOIN lessons l ON l.id = $2 AND l.is_deleted = 0
         WHERE u.id = $1::uuid AND u.is_deleted = 0`,
        [userId, payload.lessonId]
      );
      if (infoRes.rows[0]) return mapRow(infoRes.rows[0]);
    } catch (err) {
      if (!isUndefinedColumnError(err)) throw err;
      const legacyInfoRes = await pool.query<{
        display_name: string;
        role: 'user' | 'admin';
        lesson_title: string | null;
      }>(
        `SELECT u.display_name, u.role, l.title AS lesson_title
         FROM users u
         LEFT JOIN lessons l ON l.id = $2 AND l.is_deleted = 0
         WHERE u.id = $1::uuid AND u.is_deleted = 0`,
        [userId, payload.lessonId]
      );
      if (legacyInfoRes.rows[0]) {
        return mapRow({ ...legacyInfoRes.rows[0], avatar_url: null });
      }
    }

    return {
      id: inserted.id,
      userId,
      displayName: 'Người học',
      avatarUrl: null,
      role: 'user',
      lessonId: payload.lessonId,
      lessonTitle: null,
      gameMode: payload.gameMode,
      score: safeScore,
      maxScore: safeMaxScore,
      durationSeconds: safeDuration,
      playedAt: inserted.played_at.toISOString(),
    };
  } catch (err) {
    if (isUndefinedTableError(err)) {
      throw new Error('Bảng xếp hạng chưa được khởi tạo trên cơ sở dữ liệu. Hãy chạy DbMigration trước.');
    }
    throw err;
  }
}

export async function listGameLeaderboard(options: {
  lessonId?: string;
  gameMode?: GameMode;
  limit?: number;
}): Promise<GameLeaderboardEntry[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.round(Number(options.limit) || 30)));
  const lessonFilter = options.lessonId && options.lessonId !== 'all' ? options.lessonId : null;
  const modeFilter = options.gameMode || null;

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const userMap = new Map(memoryStore.users.map((u) => [u.id, u]));
    const lessonMap = new Map(
      memoryStore.lessons.filter((l) => l.isDeleted !== 1).map((l) => [l.id, l.title])
    );

    return memoryStore.gameScores
      .filter((g) => {
        if (g.isDeleted === 1) return false;
        if (lessonFilter && g.lessonId !== lessonFilter) return false;
        if (modeFilter && g.gameMode !== modeFilter) return false;
        if (!lessonMap.has(g.lessonId)) return false;
        const user = userMap.get(g.userId);
        return Boolean(user);
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.durationSeconds !== b.durationSeconds) return a.durationSeconds - b.durationSeconds;
        return b.playedAt.localeCompare(a.playedAt);
      })
      .slice(0, safeLimit)
      .map((g) => {
        const user = userMap.get(g.userId)!;
        return {
          id: g.id,
          userId: g.userId,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl ?? null,
          role: user.role,
          lessonId: g.lessonId,
          lessonTitle: lessonMap.get(g.lessonId) ?? null,
          gameMode: g.gameMode,
          score: g.score,
          maxScore: g.maxScore,
          durationSeconds: g.durationSeconds,
          playedAt: g.playedAt,
        };
      });
  }

  const pool = getPool()!;
  const params: Array<string | number> = [];
  const clauses: string[] = ['g.is_deleted = 0', 'u.is_deleted = 0', 'l.is_deleted = 0'];
  if (lessonFilter) {
    params.push(lessonFilter);
    clauses.push(`g.lesson_id = $${params.length}`);
  }
  if (modeFilter) {
    params.push(modeFilter);
    clauses.push(`g.game_mode = $${params.length}`);
  }
  params.push(safeLimit);
  const limitParam = `$${params.length}`;

  const runQuery = async (includeAvatar: boolean, filterLang: boolean) =>
    pool.query<{
      id: string;
      user_id: string;
      display_name: string;
      avatar_url: string | null;
      role: 'user' | 'admin';
      lesson_id: string;
      lesson_title: string | null;
      game_mode: GameMode;
      score: number;
      max_score: number | null;
      duration_seconds: number;
      played_at: Date;
    }>(
      `SELECT
         g.id,
         g.user_id,
         u.display_name,
         ${includeAvatar ? 'u.avatar_url' : 'NULL::text AS avatar_url'},
         u.role,
         g.lesson_id,
         l.title AS lesson_title,
         g.game_mode,
         g.score,
         g.max_score,
         g.duration_seconds,
         g.played_at
       FROM game_scores g
       JOIN users u ON u.id = g.user_id
       JOIN lessons l ON l.id = g.lesson_id
       WHERE ${[...clauses, ...(filterLang ? ["l.language_code = 'zh'"] : [])].join(' AND ')}
       ORDER BY g.score DESC, g.duration_seconds ASC, g.played_at DESC
       LIMIT ${limitParam}`,
      params
    );

  try {
    let res;
    try {
      res = await runQuery(true, true);
    } catch (err) {
      if (!isUndefinedColumnError(err)) throw err;
      try {
        res = await runQuery(true, false);
      } catch (innerErr) {
        if (!isUndefinedColumnError(innerErr)) throw innerErr;
        res = await runQuery(false, false);
      }
    }
    return res.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      displayName: r.display_name,
      avatarUrl: r.avatar_url ?? null,
      role: r.role,
      lessonId: r.lesson_id,
      lessonTitle: r.lesson_title ?? null,
      gameMode: r.game_mode,
      score: Number(r.score || 0),
      maxScore: r.max_score !== null ? Number(r.max_score) : null,
      durationSeconds: Number(r.duration_seconds || 0),
      playedAt: r.played_at.toISOString(),
    }));
  } catch (err) {
    if (isUndefinedTableError(err)) {
      return [];
    }
    throw err;
  }
}

export async function listTestLeaderboard(options: {
  lessonId: string | null;
  limit?: number;
}): Promise<TestLeaderboardEntry[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.round(Number(options.limit) || 30)));
  const lessonFilter = options.lessonId;

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const userMap = new Map(memoryStore.users.map((u) => [u.id, u]));
    const lessonMap = new Map(
      memoryStore.lessons.filter((l) => l.isDeleted !== 1).map((l) => [l.id, l.title])
    );

    const rows: TestLeaderboardEntry[] = [];
    for (const [uid, list] of memoryStore.attemptsByUser.entries()) {
      const user = userMap.get(uid);
      if (!user) continue;
      for (const a of list) {
        if (lessonFilter === null ? a.lessonId !== null : a.lessonId !== lessonFilter) {
          continue;
        }
        if (lessonFilter !== null && !lessonMap.has(lessonFilter)) {
          continue;
        }
        rows.push({
          id: a.id,
          userId: uid,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl ?? null,
          role: user.role,
          lessonId: a.lessonId,
          examTitle: a.examTitle ?? null,
          lessonTitle: a.lessonId ? lessonMap.get(a.lessonId) ?? null : null,
          score: Number(a.score || 0),
          totalQuestions: Number(a.totalQuestions || 0),
          correctCount: Number(a.correctCount || 0),
          durationSeconds: Number(a.durationSeconds || 0),
          submittedAt: a.submittedAt,
        });
      }
    }

    return rows
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
        if (a.durationSeconds !== b.durationSeconds) return a.durationSeconds - b.durationSeconds;
        return b.submittedAt.localeCompare(a.submittedAt);
      })
      .slice(0, safeLimit);
  }

  const pool = getPool()!;
  const isComp = lessonFilter === null;
  const params: Array<string | number> = isComp ? [safeLimit] : [lessonFilter!, safeLimit];
  const limitParam = isComp ? '$1' : '$2';

  const runQuery = async (includeAvatar: boolean, filterLang: boolean) =>
    pool.query<{
      id: string;
      user_id: string;
      display_name: string;
      avatar_url: string | null;
      role: 'user' | 'admin';
      lesson_id: string | null;
      exam_title: string | null;
      lesson_title: string | null;
      score: number;
      total_questions: number;
      correct_count: number;
      duration_seconds: number;
      submitted_at: Date;
    }>(
      `SELECT
         a.id,
         a.user_id,
         u.display_name,
         ${includeAvatar ? 'u.avatar_url' : 'NULL::text AS avatar_url'},
         u.role,
         a.lesson_id,
         a.exam_title,
         l.title AS lesson_title,
         a.score,
         a.total_questions,
         a.correct_count,
         a.duration_seconds,
         a.submitted_at
       FROM test_attempts a
       JOIN users u ON u.id = a.user_id
       ${isComp ? 'LEFT' : ''} JOIN lessons l ON l.id = a.lesson_id AND l.is_deleted = 0
       WHERE a.is_deleted = 0
         AND u.is_deleted = 0
         ${filterLang ? "AND COALESCE(l.language_code, a.language_code, 'zh') = 'zh'" : ''}
         AND ${isComp ? 'a.lesson_id IS NULL' : 'a.lesson_id = $1'}
       ORDER BY a.score DESC, a.correct_count DESC, a.duration_seconds ASC, a.submitted_at DESC
       LIMIT ${limitParam}`,
      params
    );

  let res;
  try {
    res = await runQuery(true, true);
  } catch (err) {
    if (!isUndefinedColumnError(err)) throw err;
    try {
      res = await runQuery(true, false);
    } catch (innerErr) {
      if (!isUndefinedColumnError(innerErr)) throw innerErr;
      res = await runQuery(false, false);
    }
  }

  return res.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    displayName: r.display_name,
    avatarUrl: r.avatar_url ?? null,
    role: r.role,
    lessonId: r.lesson_id,
    examTitle: r.exam_title ?? null,
    lessonTitle: r.lesson_title ?? null,
    score: Number(r.score || 0),
    totalQuestions: Number(r.total_questions || 0),
    correctCount: Number(r.correct_count || 0),
    durationSeconds: Number(r.duration_seconds || 0),
    submittedAt: r.submitted_at.toISOString(),
  }));
}

function toLocalDateKey(input: Date | string): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function computeStreaks(activeDateKeys: Set<string>): {
  streakDays: number;
  bestStreakDays: number;
  studiedToday: boolean;
} {
  const now = new Date();
  const todayKey = toLocalDateKey(now);
  const studiedToday = activeDateKeys.has(todayKey);

  // Current streak: count backwards starting from today if studied today, else yesterday
  let streakDays = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!studiedToday) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (activeDateKeys.has(toLocalDateKey(cursor))) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Best streak across sorted unique dates
  const sortedDates = Array.from(activeDateKeys).sort();
  let bestStreakDays = 0;
  let running = 0;
  let prevMs: number | null = null;
  for (const key of sortedDates) {
    const [y, m, d] = key.split('-').map(Number);
    const curMs = Date.UTC(y, m - 1, d);
    if (prevMs !== null && curMs - prevMs === 86400 * 1000) {
      running += 1;
    } else {
      running = 1;
    }
    if (running > bestStreakDays) bestStreakDays = running;
    prevMs = curMs;
  }

  return { streakDays, bestStreakDays, studiedToday };
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

const LESSON_PASS_THRESHOLD = 70; // > 70% là đạt

function mapCategoryToSkill(
  category?: string | null
): 'vocab' | 'grammar' | 'listening' | 'reading' {
  const cat = (category || '').trim().toLowerCase();
  if (cat === 'listening') return 'listening';
  if (cat === 'reading') return 'reading';
  if (cat === 'grammar' || cat === 'fill_blank') return 'grammar';
  return 'vocab';
}

export async function getDashboardSummary(
  userId: string,
  preferredLessonId?: string
): Promise<DashboardSummary> {
  interface LessonMeta {
    id: string;
    title: string;
    hskLevel: string;
    unit: string | null;
    vocabCount: number;
    grammarCount: number;
    textCount: number;
  }
  interface AttemptLite {
    lessonId: string | null;
    score: number;
    durationSeconds: number;
    answers: Record<string, number>;
    submittedAt: string;
  }
  interface QuestionLite {
    id: string;
    category: string | null;
    correctIndex: number;
  }
  interface GameLite {
    lessonId: string;
    gameMode: GameMode;
    score: number;
    maxScore: number | null;
    durationSeconds: number;
    playedAt: string;
  }
  interface MarkLite {
    vocabId: string;
    lessonId: string;
    markedAt: string;
  }

  let lessons: LessonMeta[] = [];
  let attempts: AttemptLite[] = [];
  let games: GameLite[] = [];
  let marks: MarkLite[] = [];

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const visibleLessons = memoryStore.lessons.filter(
      (l) => l.isDeleted !== 1 && (l.isSystem || l.ownerId === userId)
    );
    lessons = visibleLessons.map((l) => ({
      id: l.id,
      title: l.title,
      hskLevel: l.hskLevel || 'HSK 1',
      unit: l.unit ?? null,
      vocabCount: l.vocabulary.length,
      grammarCount: l.grammar.length,
      textCount: l.texts.length,
    }));

    const vocabToLesson = new Map<string, string>();
    for (const l of visibleLessons) {
      for (const v of l.vocabulary) vocabToLesson.set(v.id, l.id);
    }

    attempts = (memoryStore.attemptsByUser.get(userId) || []).map((a) => ({
      lessonId: a.lessonId,
      score: a.score,
      durationSeconds: a.durationSeconds,
      answers: a.answers || {},
      submittedAt: a.submittedAt,
    }));

    games = memoryStore.gameScores
      .filter((g) => g.userId === userId && g.isDeleted !== 1)
      .map((g) => ({
        lessonId: g.lessonId,
        gameMode: g.gameMode,
        score: g.score,
        maxScore: g.maxScore,
        durationSeconds: g.durationSeconds,
        playedAt: g.playedAt,
      }));

    const markMap = memoryStore.markedByUser.get(userId);
    if (markMap) {
      for (const m of markMap.values()) {
        if (m.isDeleted === 1) continue;
        const lid = vocabToLesson.get(m.vocabId);
        if (lid) {
          marks.push({ vocabId: m.vocabId, lessonId: lid, markedAt: m.markedAt });
        }
      }
    }
  } else {
    const pool = getPool()!;
    let hasLangCol = true;
    type DashboardLessonRow = {
      id: string;
      title: string;
      hsk_level: string;
      unit: string | null;
      vocab_count: string;
      grammar_count: string;
      text_count: string;
    };
    let lessonsRes;
    try {
      lessonsRes = await pool.query<DashboardLessonRow>(
        `SELECT
           l.id,
           l.title,
           l.hsk_level,
           l.unit,
           (SELECT COUNT(DISTINCT btrim(v.hanzi)) FROM vocabularies v WHERE v.lesson_id = l.id AND v.is_deleted = 0) AS vocab_count,
           (SELECT COUNT(DISTINCT btrim(g.title)) FROM grammars g WHERE g.lesson_id = l.id AND g.is_deleted = 0) AS grammar_count,
           (SELECT COUNT(*) FROM texts t WHERE t.lesson_id = l.id AND t.is_deleted = 0) AS text_count
         FROM lessons l
         WHERE l.is_deleted = 0
           AND l.language_code = 'zh'
           AND (l.is_system = TRUE OR l.owner_id = $1::uuid)
         ORDER BY l.is_system DESC, l.sort_order ASC, l.created_at ASC`,
        [userId]
      );
    } catch (err) {
      if (!isUndefinedColumnError(err)) throw err;
      hasLangCol = false;
      lessonsRes = await pool.query<DashboardLessonRow>(
        `SELECT
           l.id,
           l.title,
           l.hsk_level,
           l.unit,
           (SELECT COUNT(DISTINCT btrim(v.hanzi)) FROM vocabularies v WHERE v.lesson_id = l.id AND v.is_deleted = 0) AS vocab_count,
           (SELECT COUNT(DISTINCT btrim(g.title)) FROM grammars g WHERE g.lesson_id = l.id AND g.is_deleted = 0) AS grammar_count,
           (SELECT COUNT(*) FROM texts t WHERE t.lesson_id = l.id AND t.is_deleted = 0) AS text_count
         FROM lessons l
         WHERE l.is_deleted = 0 AND (l.is_system = TRUE OR l.owner_id = $1::uuid)
         ORDER BY l.is_system DESC, l.sort_order ASC, l.created_at ASC`,
        [userId]
      );
    }

    const [attemptsRes, marksRes] = await Promise.all([
      hasLangCol
        ? pool.query<{
            lesson_id: string | null;
            score: number;
            duration_seconds: number;
            answers: Record<string, number> | null;
            submitted_at: Date;
          }>(
            `SELECT a.lesson_id, a.score, a.duration_seconds, a.answers, a.submitted_at
             FROM test_attempts a
             LEFT JOIN lessons l ON l.id = a.lesson_id AND l.is_deleted = 0
             WHERE a.user_id = $1::uuid
               AND a.is_deleted = 0
               AND COALESCE(l.language_code, a.language_code, 'zh') = 'zh'
             ORDER BY a.submitted_at DESC`,
            [userId]
          )
        : pool.query<{
            lesson_id: string | null;
            score: number;
            duration_seconds: number;
            answers: Record<string, number> | null;
            submitted_at: Date;
          }>(
            `SELECT lesson_id, score, duration_seconds, answers, submitted_at
             FROM test_attempts
             WHERE user_id = $1::uuid AND is_deleted = 0
             ORDER BY submitted_at DESC`,
            [userId]
          ),
      hasLangCol
        ? pool.query<{
            vocab_id: string;
            lesson_id: string;
            marked_at: Date;
          }>(
            `SELECT m.vocab_id, v.lesson_id, m.marked_at
             FROM user_marked_vocab m
             JOIN vocabularies v ON v.id = m.vocab_id AND v.is_deleted = 0
             JOIN lessons l ON l.id = v.lesson_id AND l.is_deleted = 0
             WHERE m.user_id = $1::uuid
               AND m.is_deleted = 0
               AND l.language_code = 'zh'`,
            [userId]
          )
        : pool.query<{
            vocab_id: string;
            lesson_id: string;
            marked_at: Date;
          }>(
            `SELECT m.vocab_id, v.lesson_id, m.marked_at
             FROM user_marked_vocab m
             JOIN vocabularies v ON v.id = m.vocab_id AND v.is_deleted = 0
             JOIN lessons l ON l.id = v.lesson_id AND l.is_deleted = 0
             WHERE m.user_id = $1::uuid AND m.is_deleted = 0`,
            [userId]
          ),
    ]);

    lessons = lessonsRes.rows.map((r) => ({
      id: r.id,
      title: r.title,
      hskLevel: r.hsk_level || 'HSK 1',
      unit: r.unit,
      vocabCount: Number(r.vocab_count || 0),
      grammarCount: Number(r.grammar_count || 0),
      textCount: Number(r.text_count || 0),
    }));

    attempts = attemptsRes.rows.map((r) => ({
      lessonId: r.lesson_id,
      score: Number(r.score || 0),
      durationSeconds: Number(r.duration_seconds || 0),
      answers: (r.answers && typeof r.answers === 'object' ? r.answers : {}) as Record<
        string,
        number
      >,
      submittedAt: r.submitted_at.toISOString(),
    }));

    marks = marksRes.rows.map((r) => ({
      vocabId: r.vocab_id,
      lessonId: r.lesson_id,
      markedAt: r.marked_at.toISOString(),
    }));

    try {
      const gamesRes = hasLangCol
        ? await pool.query<{
            lesson_id: string;
            game_mode: GameMode;
            score: number;
            max_score: number | null;
            duration_seconds: number;
            played_at: Date;
          }>(
            `SELECT g.lesson_id, g.game_mode, g.score, g.max_score, g.duration_seconds, g.played_at
             FROM game_scores g
             JOIN lessons l ON l.id = g.lesson_id AND l.is_deleted = 0
             WHERE g.user_id = $1::uuid
               AND g.is_deleted = 0
               AND l.language_code = 'zh'
             ORDER BY g.played_at DESC`,
            [userId]
          )
        : await pool.query<{
            lesson_id: string;
            game_mode: GameMode;
            score: number;
            max_score: number | null;
            duration_seconds: number;
            played_at: Date;
          }>(
            `SELECT lesson_id, game_mode, score, max_score, duration_seconds, played_at
             FROM game_scores
             WHERE user_id = $1::uuid AND is_deleted = 0
             ORDER BY played_at DESC`,
            [userId]
          );
      games = gamesRes.rows.map((r) => ({
        lessonId: r.lesson_id,
        gameMode: r.game_mode,
        score: Number(r.score || 0),
        maxScore: r.max_score !== null ? Number(r.max_score) : null,
        durationSeconds: Number(r.duration_seconds || 0),
        playedAt: r.played_at.toISOString(),
      }));
    } catch (err) {
      if (!isUndefinedTableError(err) && !isUndefinedColumnError(err)) throw err;
      games = [];
    }
  }

  // Activity aggregation by date
  const activityByDate = new Map<string, { count: number; seconds: number }>();
  const addActivity = (iso: string, seconds: number) => {
    const key = toLocalDateKey(iso);
    const prev = activityByDate.get(key) || { count: 0, seconds: 0 };
    prev.count += 1;
    prev.seconds += Math.max(0, seconds);
    activityByDate.set(key, prev);
  };

  const todayKey = toLocalDateKey(new Date());
  let todayTests = 0;
  let todayGames = 0;
  let todayMarks = 0;
  let todaySeconds = 0;

  for (const a of attempts) {
    const secs = Math.max(60, a.durationSeconds || 0);
    addActivity(a.submittedAt, secs);
    if (toLocalDateKey(a.submittedAt) === todayKey) {
      todayTests += 1;
      todaySeconds += secs;
    }
  }
  for (const g of games) {
    const secs = Math.max(30, g.durationSeconds || 0);
    addActivity(g.playedAt, secs);
    if (toLocalDateKey(g.playedAt) === todayKey) {
      todayGames += 1;
      todaySeconds += secs;
    }
  }
  for (const m of marks) {
    addActivity(m.markedAt, 20);
    if (toLocalDateKey(m.markedAt) === todayKey) {
      todayMarks += 1;
      todaySeconds += 20;
    }
  }

  const { streakDays, bestStreakDays, studiedToday } = computeStreaks(
    new Set(activityByDate.keys())
  );

  // Build last 28 days timeline
  const activityLast28Days: DashboardActivityDay[] = [];
  const baseDate = new Date();
  for (let i = 27; i >= 0; i -= 1) {
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() - i);
    const key = toLocalDateKey(d);
    const entry = activityByDate.get(key);
    const count = entry?.count || 0;
    const minutes = entry ? Math.max(1, Math.round(entry.seconds / 60)) : 0;
    const level: 0 | 1 | 2 | 3 | 4 =
      count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
    activityLast28Days.push({ date: key, count, minutes, level });
  }

  // Per-lesson test best attempt & attempt count
  const bestAttemptByLesson = new Map<string, AttemptLite>();
  const attemptCountByLesson = new Map<string, number>();
  for (const a of attempts) {
    if (!a.lessonId) continue;
    attemptCountByLesson.set(a.lessonId, (attemptCountByLesson.get(a.lessonId) || 0) + 1);
    const prevBest = bestAttemptByLesson.get(a.lessonId);
    // attempts is ordered submitted_at DESC -> strictly > keeps latest on tie
    if (!prevBest || a.score > prevBest.score) {
      bestAttemptByLesson.set(a.lessonId, a);
    }
  }

  const gameCountByLesson = new Map<string, number>();
  for (const g of games) {
    gameCountByLesson.set(g.lessonId, (gameCountByLesson.get(g.lessonId) || 0) + 1);
  }

  const markCountByLesson = new Map<string, number>();
  for (const m of marks) {
    markCountByLesson.set(m.lessonId, (markCountByLesson.get(m.lessonId) || 0) + 1);
  }

  // Overall progress & Vocab Spaced Repetition breakdown (> 70% = Đạt)
  let completedLessons = 0;
  let totalVocab = 0;
  let masteredCount = 0;
  let learningCount = 0;
  const dueCount = marks.length;

  for (const l of lessons) {
    totalVocab += l.vocabCount;
    const best = bestAttemptByLesson.get(l.id)?.score;
    const lMarks = markCountByLesson.get(l.id) || 0;
    const lGames = gameCountByLesson.get(l.id) || 0;
    if (best !== undefined && best > LESSON_PASS_THRESHOLD) {
      completedLessons += 1;
      masteredCount += Math.max(0, l.vocabCount - lMarks);
      learningCount += Math.min(l.vocabCount, lMarks);
    } else if (best !== undefined || lGames > 0 || lMarks > 0) {
      learningCount += l.vocabCount;
    }
  }
  const newCount = Math.max(0, totalVocab - masteredCount - learningCount);

  // Pick continueLesson: prefer preferredLessonId if exists, else first lesson with best score <= 70%, else first lesson
  const preferredLesson = preferredLessonId
    ? lessons.find((l) => l.id === preferredLessonId)
    : undefined;
  const firstUnfinished = lessons.find(
    (l) => (bestAttemptByLesson.get(l.id)?.score ?? 0) <= LESSON_PASS_THRESHOLD
  );
  const chosen = preferredLesson || firstUnfinished || lessons[0] || null;

  // Load comprehensive_test questions for the chosen lesson to compute exact 4-skill ratios
  let chosenQuestions: QuestionLite[] = [];
  if (chosen) {
    if (getDbMode() === 'memory') {
      const memLesson = memoryStore.lessons.find(
        (l) => l.id === chosen.id && l.isDeleted !== 1
      );
      chosenQuestions = (memLesson?.comprehensiveTest || []).map((q) => ({
        id: q.id,
        category: q.category ?? null,
        correctIndex: q.correctIndex,
      }));
    } else {
      const pool = getPool()!;
      const qRes = await pool.query<{
        id: string;
        category: string | null;
        correct_index: number;
      }>(
        `SELECT id, category, correct_index
         FROM quiz_questions
         WHERE lesson_id = $1 AND scope = 'comprehensive_test' AND is_deleted = 0
         ORDER BY sort_order ASC`,
        [chosen.id]
      );
      chosenQuestions = qRes.rows.map((r) => ({
        id: r.id,
        category: r.category,
        correctIndex: Number(r.correct_index),
      }));
    }
  }

  const chosenBestAttempt = chosen ? bestAttemptByLesson.get(chosen.id) || null : null;

  const skillBuckets: Record<
    'vocab' | 'grammar' | 'listening' | 'reading',
    { correct: number; total: number }
  > = {
    vocab: { correct: 0, total: 0 },
    grammar: { correct: 0, total: 0 },
    listening: { correct: 0, total: 0 },
    reading: { correct: 0, total: 0 },
  };

  chosenQuestions.forEach((q, idx) => {
    const skillKey = mapCategoryToSkill(q.category);
    skillBuckets[skillKey].total += 1;
    if (chosenBestAttempt) {
      const ans = chosenBestAttempt.answers;
      const picked =
        ans[String(idx)] !== undefined
          ? ans[String(idx)]
          : ans[q.id] !== undefined
            ? ans[q.id]
            : undefined;
      if (picked === q.correctIndex) {
        skillBuckets[skillKey].correct += 1;
      }
    }
  });

  const continueLesson = chosen
    ? (() => {
        const best = chosenBestAttempt ? chosenBestAttempt.score : null;
        const attCnt = attemptCountByLesson.get(chosen.id) || 0;
        const progressPercent = best !== null ? clampPct(best) : 0;
        const passed = best !== null && best > LESSON_PASS_THRESHOLD;
        const totalEstMins = Math.max(
          10,
          Math.round(chosen.vocabCount * 0.8 + chosen.textCount * 4)
        );
        const estimatedMinutesLeft = passed
          ? 0
          : Math.max(2, Math.round((totalEstMins * (100 - progressPercent)) / 100));
        return {
          lessonId: chosen.id,
          title: chosen.title,
          hskLevel: chosen.hskLevel,
          unit: chosen.unit,
          progressPercent,
          passed,
          passThreshold: LESSON_PASS_THRESHOLD,
          vocabCount: chosen.vocabCount,
          grammarCount: chosen.grammarCount,
          textCount: chosen.textCount,
          estimatedMinutesLeft,
          bestScore: best,
          attemptCount: attCnt,
        };
      })()
    : null;

  const averageTestScore =
    attempts.length > 0
      ? Math.round(attempts.reduce((sum, a) => sum + a.score, 0) / attempts.length)
      : null;

  const fallbackLessonId = chosen?.id || lessons[0]?.id || 'lesson-1';
  const buildSkillItem = (
    id: 'vocab' | 'grammar' | 'listening' | 'reading',
    label: string,
    targetTab: 'vocab' | 'texts' | 'grammar' | 'games' | 'test'
  ): DashboardSkillItem => {
    const bucket = skillBuckets[id];
    const hasQuestions = bucket.total > 0;
    const score = hasQuestions
      ? chosenBestAttempt
        ? clampPct((bucket.correct / bucket.total) * 100)
        : 0
      : null;
    const passed = score !== null && score > LESSON_PASS_THRESHOLD;
    const detail = !hasQuestions
      ? 'Bài này chưa có câu hỏi'
      : !chosenBestAttempt
        ? `0/${bucket.total} câu (chưa làm kiểm tra)`
        : `${bucket.correct}/${bucket.total} câu đúng`;

    return {
      id,
      label,
      score,
      correctCount: bucket.correct,
      totalCount: bucket.total,
      passed,
      detail,
      targetTab,
      targetLessonId: fallbackLessonId,
    };
  };

  const skills: DashboardSkillItem[] = [
    buildSkillItem('vocab', 'Từ vựng', 'vocab'),
    buildSkillItem('grammar', 'Ngữ pháp', 'grammar'),
    buildSkillItem('listening', 'Nghe', 'texts'),
    buildSkillItem('reading', 'Đọc hiểu', 'games'),
  ];

  return {
    streakDays,
    bestStreakDays,
    studiedToday,
    today: {
      minutesStudied: Math.round(todaySeconds / 60),
      dailyGoalMinutes: 30,
      testsCompleted: todayTests,
      gamesCompleted: todayGames,
      vocabMarkedToday: todayMarks,
    },
    vocabReview: {
      totalVocab,
      dueCount,
      newCount,
      learningCount,
      masteredCount,
    },
    skills,
    activityLast28Days,
    continueLesson,
    overallProgress: {
      completedLessons,
      totalLessons: lessons.length,
      averageTestScore,
      totalTests: attempts.length,
      totalGames: games.length,
    },
  };
}
