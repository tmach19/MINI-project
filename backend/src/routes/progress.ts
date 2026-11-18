import { Router } from 'express';
import { PERMISSION_CODES } from '../config/rbacCatalog.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import {
  getMarkedVocabCards,
  getMarkedVocabMap,
  getUserLessonAttemptDetails,
  getUserLessonTestSummary,
  listTestAttempts,
  saveTestAttempt,
  syncGuestMarkedVocab,
  toggleMarkedVocab,
} from '../repositories/userProgressRepo.js';

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

export default router;
