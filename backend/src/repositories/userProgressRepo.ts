import crypto from 'node:crypto';
import { getDbMode, getPool } from '../db/pool.js';
import { memoryStore, type MemoryUser } from '../db/fallbackStore.js';
import { getEffectivePermissions } from './rbacRepo.js';
import type {
  LessonAttemptDetailRecord,
  LessonTestSummaryRecord,
  MarkedVocabCard,
  MarkedVocabRecord,
  TestAttemptRecord,
  UserProfile,
} from '../types/domain.js';

export interface AuthenticatedUserRecord extends UserProfile {
  passwordHash: string;
}

export async function findUserByEmail(email: string): Promise<AuthenticatedUserRecord | null> {
  const normalized = email.trim().toLowerCase();
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const u = memoryStore.users.find((x) => x.email === normalized);
    if (!u) return null;
    const permissions = await getEffectivePermissions(u.id, u.role);
    return { ...u, isSuperAdmin: u.role === 'admin', permissions };
  }

  const pool = getPool()!;
  const res = await pool.query<{
    id: string;
    email: string;
    password_hash: string;
    display_name: string;
    role: 'user' | 'admin';
    created_at: Date;
  }>(
    'SELECT id, email, password_hash, display_name, role, created_at FROM users WHERE email = $1',
    [normalized]
  );
  const r = res.rows[0];
  if (!r) return null;
  const permissions = await getEffectivePermissions(r.id, r.role);
  return {
    id: r.id,
    email: r.email,
    passwordHash: r.password_hash,
    displayName: r.display_name,
    role: r.role,
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
    return { ...base, isSuperAdmin: base.role === 'admin', permissions };
  }

  const pool = getPool()!;
  const res = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    role: 'user' | 'admin';
    created_at: Date;
  }>(
    'SELECT id, email, display_name, role, created_at FROM users WHERE id = $1::uuid',
    [userId]
  );
  const r = res.rows[0];
  if (!r) return null;
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

export async function getMarkedVocabMap(userId: string): Promise<Record<string, MarkedVocabRecord>> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const map = memoryStore.markedByUser.get(userId);
    const result: Record<string, MarkedVocabRecord> = {};
    if (map) {
      map.forEach((v, k) => {
        result[k] = v;
      });
    }
    return result;
  }

  const pool = getPool()!;
  const res = await pool.query<{
    vocab_id: string;
    note: string | null;
    marked_at: Date;
  }>(
    `SELECT vocab_id, note, marked_at
     FROM user_marked_vocab
     WHERE user_id = $1::uuid`,
    [userId]
  );

  const result: Record<string, MarkedVocabRecord> = {};
  for (const r of res.rows) {
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

    const currentlyMarked = userMap.has(vocabId);
    const shouldMark = marked !== undefined ? marked : !currentlyMarked;

    if (!shouldMark) {
      userMap.delete(vocabId);
      return { marked: false, record: null };
    }

    const record: MarkedVocabRecord = {
      vocabId,
      note: note ?? userMap.get(vocabId)?.note ?? null,
      markedAt: new Date().toISOString(),
    };
    userMap.set(vocabId, record);
    return { marked: true, record };
  }

  const pool = getPool()!;
  let shouldMark = marked;
  if (shouldMark === undefined) {
    const existing = await pool.query(
      'SELECT 1 FROM user_marked_vocab WHERE user_id = $1::uuid AND vocab_id = $2',
      [userId, vocabId]
    );
    shouldMark = existing.rowCount === 0;
  }

  if (!shouldMark) {
    await pool.query(
      'DELETE FROM user_marked_vocab WHERE user_id = $1::uuid AND vocab_id = $2',
      [userId, vocabId]
    );
    return { marked: false, record: null };
  }

  const res = await pool.query<{ vocab_id: string; note: string | null; marked_at: Date }>(
    `INSERT INTO user_marked_vocab (user_id, vocab_id, note, marked_at)
     VALUES ($1::uuid, $2, $3, NOW())
     ON CONFLICT (user_id, vocab_id) DO UPDATE SET
       note = COALESCE(EXCLUDED.note, user_marked_vocab.note),
       marked_at = NOW()
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
      for (const v of l.vocabulary) {
        const mark = userMap.get(v.id);
        if (mark) {
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
  const res = await pool.query(
    `SELECT
       v.id, v.hanzi, v.pinyin, v.sino_vietnamese, v.meaning, v.word_type,
       v.radical, v.breakdown, v.mnemonic, v.example_hanzi, v.example_pinyin, v.example_meaning,
       l.id AS lesson_id, l.title AS lesson_title,
       m.note, m.marked_at
     FROM user_marked_vocab m
     JOIN vocabularies v ON v.id = m.vocab_id
     JOIN lessons l ON l.id = v.lesson_id
     WHERE m.user_id = $1::uuid
     ORDER BY l.is_system DESC, l.sort_order ASC, l.created_at ASC, v.sort_order ASC, m.marked_at DESC`,
    [userId]
  );

  return res.rows.map((r) => ({
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

  const row = res.rows[0];
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
  const res = await pool.query(
    `SELECT a.id, a.lesson_id, a.exam_title, l.title AS lesson_title, a.score, a.total_questions, a.correct_count, a.duration_seconds, a.answers, a.submitted_at
     FROM test_attempts a
     LEFT JOIN lessons l ON l.id = a.lesson_id
     WHERE a.user_id = $1::uuid
     ORDER BY a.submitted_at DESC`,
    [userId]
  );

  return res.rows.map((r) => ({
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

export async function getUserLessonTestSummary(userId: string): Promise<LessonTestSummaryRecord[]> {
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
      .filter((l) => l.isSystem || l.ownerId === userId)
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
  const res = await pool.query<{
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
  }>('SELECT * FROM fn_get_user_lesson_test_summary($1::uuid)', [userId]);

  return res.rows.map((r) => ({
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
  const res = await pool.query<{
    id: string;
    lesson_id: string | null;
    exam_title: string | null;
    score: number;
    total_questions: number;
    correct_count: number;
    duration_seconds: number;
    submitted_at: Date;
  }>(
    `SELECT d.id, d.lesson_id, t.exam_title, d.score, d.total_questions, d.correct_count, d.duration_seconds, d.submitted_at
     FROM fn_get_user_lesson_attempt_details($1::uuid, $2, $3) d
     LEFT JOIN test_attempts t ON t.id = d.id
     ORDER BY d.submitted_at DESC`,
    [userId, lessonId, limit]
  );

  return res.rows.map((r) => ({
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
