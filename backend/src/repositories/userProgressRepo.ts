import crypto from 'node:crypto';
import { getDbMode, getPool } from '../db/pool.js';
import { memoryStore, type MemoryUser } from '../db/fallbackStore.js';
import type {
  MarkedVocabCard,
  MarkedVocabRecord,
  TestAttemptRecord,
  UserProfile,
} from '../types/domain.js';

export async function findUserByEmail(email: string): Promise<MemoryUser | null> {
  const normalized = email.trim().toLowerCase();
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    return memoryStore.users.find((u) => u.email === normalized) || null;
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
  return {
    id: r.id,
    email: r.email,
    passwordHash: r.password_hash,
    displayName: r.display_name,
    role: r.role,
    createdAt: r.created_at.toISOString(),
  };
}

export async function findUserById(userId: string): Promise<UserProfile | null> {
  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const u = memoryStore.users.find((x) => x.id === userId);
    if (!u) return null;
    const { passwordHash: _pw, ...profile } = u;
    return profile;
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
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
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
    const { passwordHash: _pw, ...profile } = user;
    return profile;
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
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
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

    for (const l of memoryStore.lessons) {
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
    return cards.sort((a, b) => b.markedAt.localeCompare(a.markedAt));
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
     ORDER BY m.marked_at DESC`,
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
    const lesson = memoryStore.lessons.find((l) => l.id === payload.lessonId);
    const rec: TestAttemptRecord = {
      id: crypto.randomUUID(),
      lessonId: payload.lessonId,
      lessonTitle: lesson?.title || payload.lessonId,
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
    `INSERT INTO test_attempts (user_id, lesson_id, score, total_questions, correct_count, duration_seconds, answers)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id, submitted_at`,
    [
      userId,
      payload.lessonId,
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
    lessonId: payload.lessonId,
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
    `SELECT a.id, a.lesson_id, l.title AS lesson_title, a.score, a.total_questions, a.correct_count, a.duration_seconds, a.answers, a.submitted_at
     FROM test_attempts a
     JOIN lessons l ON l.id = a.lesson_id
     WHERE a.user_id = $1::uuid
     ORDER BY a.submitted_at DESC
     LIMIT 30`,
    [userId]
  );

  return res.rows.map((r) => ({
    id: r.id,
    lessonId: r.lesson_id,
    lessonTitle: r.lesson_title,
    score: r.score,
    totalQuestions: r.total_questions,
    correctCount: r.correct_count,
    durationSeconds: r.duration_seconds,
    answers: r.answers || {},
    submittedAt: r.submitted_at.toISOString(),
  }));
}
