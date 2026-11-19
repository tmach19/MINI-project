import { Router } from 'express';
import { PERMISSION_CODES } from '../config/rbacCatalog.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import {
  getDashboardSummary,
  getMarkedVocabCards,
  getMarkedVocabMap,
  getUserLessonAttemptDetails,
  getUserLessonTestSummary,
  listGameLeaderboard,
  listTestAttempts,
  listTestLeaderboard,
  saveGameScore,
  saveTestAttempt,
  syncGuestMarkedVocab,
  toggleMarkedVocab,
  VALID_GAME_MODES,
} from '../repositories/userProgressRepo.js';
import type { GameMode } from '../types/domain.js';

const router = Router();

router.get('/progress', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const [markedMap, markedCards, attempts] = await Promise.all([
      getMarkedVocabMap(userId),
      getMarkedVocabCards(userId),
      listTestAttempts(userId),
    ]);
    res.json({ markedMap, markedCount: markedCards.length, markedCards, attempts });
  } catch (err) {
    next(err);
  }
});

router.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    const preferredLessonId =
      typeof req.query.lessonId === 'string' && req.query.lessonId.trim()
        ? req.query.lessonId.trim()
        : undefined;
    const summary = await getDashboardSummary(req.user!.userId, preferredLessonId);
    res.json({ dashboard: summary });
  } catch (err) {
    next(err);
  }
});

router.get('/progress/marked', requireAuth, async (req, res, next) => {
  try {
    const cards = await getMarkedVocabCards(req.user!.userId);
    res.json({ cards });
  } catch (err) {
    next(err);
  }
});

router.post('/progress/mark', requirePermission(PERMISSION_CODES.VOCAB_BOOKMARK), async (req, res, next) => {
  try {
    const { vocabId, marked, note } = req.body as {
      vocabId?: string;
      marked?: boolean;
      note?: string;
    };
    if (!vocabId) {
      res.status(400).json({ error: 'Thiếu vocabId.' });
      return;
    }
    const result = await toggleMarkedVocab(req.user!.userId, vocabId, marked, note);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/progress/sync', requirePermission(PERMISSION_CODES.VOCAB_BOOKMARK), async (req, res, next) => {
  try {
    const { vocabIds } = req.body as { vocabIds?: string[] };
    const markedMap = await syncGuestMarkedVocab(
      req.user!.userId,
      Array.isArray(vocabIds) ? vocabIds : []
    );
    res.json({ markedMap });
  } catch (err) {
    next(err);
  }
});

router.post('/tests/attempt', requirePermission(PERMISSION_CODES.EXAM_TAKE), async (req, res, next) => {
  try {
    const { lessonId, examTitle, score, totalQuestions, correctCount, durationSeconds, answers } = req.body;
    if ((!lessonId && !examTitle) || typeof score !== 'number' || !totalQuestions) {
      res.status(400).json({ error: 'Dữ liệu bài kiểm tra không hợp lệ.' });
      return;
    }
    const attempt = await saveTestAttempt(req.user!.userId, {
      lessonId: lessonId || null,
      examTitle: examTitle || null,
      score,
      totalQuestions,
      correctCount: Number(correctCount || 0),
      durationSeconds: Number(durationSeconds || 0),
      answers: answers || {},
    });
    res.status(201).json({ attempt });
  } catch (err) {
    next(err);
  }
});

router.get('/tests/lesson-summary', requireAuth, async (req, res, next) => {
  try {
    const items = await getUserLessonTestSummary(req.user!.userId);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get('/tests/attempts', requireAuth, async (req, res, next) => {
  try {
    const lessonIdParam = req.query.lessonId;
    if (typeof lessonIdParam === 'string' && lessonIdParam.trim()) {
      const details = await getUserLessonAttemptDetails(
        req.user!.userId,
        lessonIdParam === '__comprehensive__' ? null : lessonIdParam.trim()
      );
      res.json({ attempts: details });
      return;
    }
    const attempts = await listTestAttempts(req.user!.userId);
    res.json({ attempts });
  } catch (err) {
    next(err);
  }
});

router.get('/tests/leaderboard', requireAuth, async (req, res, next) => {
  try {
    const rawLessonId = typeof req.query.lessonId === 'string' ? req.query.lessonId.trim() : '';
    if (!rawLessonId) {
      res.status(400).json({ error: 'Thiếu lessonId.' });
      return;
    }
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30;
    const entries = await listTestLeaderboard({
      lessonId: rawLessonId === '__comprehensive__' ? null : rawLessonId,
      limit,
    });
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

router.get('/games/leaderboard', requireAuth, async (req, res, next) => {
  try {
    const lessonId = typeof req.query.lessonId === 'string' ? req.query.lessonId.trim() : undefined;
    const rawMode = typeof req.query.gameMode === 'string' ? req.query.gameMode.trim() : undefined;
    const gameMode =
      rawMode && (VALID_GAME_MODES as readonly string[]).includes(rawMode)
        ? (rawMode as GameMode)
        : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30;
    const entries = await listGameLeaderboard({ lessonId, gameMode, limit });
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

router.post('/games/score', requireAuth, async (req, res, next) => {
  try {
    const { lessonId, gameMode, score, maxScore, durationSeconds } = req.body as {
      lessonId?: string;
      gameMode?: string;
      score?: number;
      maxScore?: number | null;
      durationSeconds?: number;
    };
    if (
      !lessonId ||
      typeof lessonId !== 'string' ||
      !gameMode ||
      !(VALID_GAME_MODES as readonly string[]).includes(gameMode) ||
      typeof score !== 'number' ||
      !Number.isFinite(score)
    ) {
      res.status(400).json({ error: 'Dữ liệu kết quả trò chơi không hợp lệ.' });
      return;
    }
    const entry = await saveGameScore(req.user!.userId, {
      lessonId: lessonId.trim(),
      gameMode: gameMode as GameMode,
      score,
      maxScore: maxScore ?? null,
      durationSeconds: Number(durationSeconds || 0),
    });
    res.status(201).json({ entry });
  } catch (err) {
    next(err);
  }
});

export default router;
