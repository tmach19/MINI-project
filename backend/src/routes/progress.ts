import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getMarkedVocabCards,
  getMarkedVocabMap,
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

router.post('/progress/mark', requireAuth, async (req, res, next) => {
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

router.post('/progress/sync', requireAuth, async (req, res, next) => {
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

router.post('/tests/attempt', requireAuth, async (req, res, next) => {
  try {
    const { lessonId, score, totalQuestions, correctCount, durationSeconds, answers } = req.body;
    if (!lessonId || typeof score !== 'number' || !totalQuestions) {
      res.status(400).json({ error: 'Dữ liệu bài kiểm tra không hợp lệ.' });
      return;
    }
    const attempt = await saveTestAttempt(req.user!.userId, {
      lessonId,
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

router.get('/tests/attempts', requireAuth, async (req, res, next) => {
  try {
    const attempts = await listTestAttempts(req.user!.userId);
    res.json({ attempts });
  } catch (err) {
    next(err);
  }
});

export default router;
