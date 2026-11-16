import { Router } from 'express';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import {
  createCustomLesson,
  deleteCustomLesson,
  getLessonById,
  listLessons,
  searchAllVocabulary,
  updateCustomLesson,
} from '../repositories/lessonRepo.js';

const router = Router();

router.get('/vocab/search', optionalAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || '');
    const items = await searchAllVocabulary(q, req.user?.userId);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get('/lessons', optionalAuth, async (req, res, next) => {
  try {
    const lessons = await listLessons(req.user?.userId);
    res.json({ lessons });
  } catch (err) {
    next(err);
  }
});

router.get('/lessons/:id', optionalAuth, async (req, res, next) => {
  try {
    const lesson = await getLessonById(String(req.params.id), req.user?.userId);
    if (!lesson) {
      res.status(404).json({ error: 'Không tìm thấy buổi học.' });
      return;
    }
    res.json({ lesson });
  } catch (err) {
    next(err);
  }
});

router.post('/lessons', requireAuth, async (req, res, next) => {
  try {
    const { title, hskLevel, unit, description, vocabulary, grammar } = req.body;
    if (!title?.trim()) {
      res.status(400).json({ error: 'Tên buổi học không được để trống.' });
      return;
    }
    const created = await createCustomLesson(req.user!.userId, {
      title,
      hskLevel: hskLevel || 'HSK 1',
      unit,
      description,
      vocabulary: Array.isArray(vocabulary) ? vocabulary : [],
      grammar: Array.isArray(grammar) ? grammar : [],
    });
    res.status(201).json({ lesson: created });
  } catch (err) {
    next(err);
  }
});

router.put('/lessons/:id', requireAuth, async (req, res, next) => {
  try {
    const { title, hskLevel, unit, description, vocabulary, grammar } = req.body;
    if (!title?.trim()) {
      res.status(400).json({ error: 'Tên buổi học không được để trống.' });
      return;
    }
    const updated = await updateCustomLesson(String(req.params.id), req.user!.userId, {
      title,
      hskLevel: hskLevel || 'HSK 1',
      unit,
      description,
      vocabulary: Array.isArray(vocabulary) ? vocabulary : [],
      grammar: Array.isArray(grammar) ? grammar : [],
    });
    if (!updated) {
      res.status(403).json({ error: 'Không thể sửa bài học hệ thống hoặc bài học không thuộc quyền sở hữu của bạn.' });
      return;
    }
    res.json({ lesson: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/lessons/:id', requireAuth, async (req, res, next) => {
  try {
    const deleted = await deleteCustomLesson(String(req.params.id), req.user!.userId);
    if (!deleted) {
      res.status(403).json({ error: 'Không thể xoá bài học hệ thống hoặc bài học không tồn tại.' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
