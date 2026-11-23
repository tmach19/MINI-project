import { Router } from 'express';
import { PERMISSION_CODES } from '../config/rbacCatalog.js';
import {
  hasUserPermission,
  optionalAuth,
  requireAuth,
  requirePermission,
  resolveCurrentUser,
} from '../middleware/auth.js';
import {
  createLesson,
  deleteLessonById,
  getComprehensiveExamQuestions,
  getLessonById,
  getLessonOwnership,
  getVocabGlossary,
  listLessons,
  searchAllVocabulary,
  updateLessonById,
} from '../repositories/lessonRepo.js';

const router = Router();

router.get('/vocab/glossary', optionalAuth, async (req, res, next) => {
  try {
    const items = await getVocabGlossary(req.user?.userId);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

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

router.get(
  '/tests/comprehensive-exam',
  requirePermission(PERMISSION_CODES.EXAM_TAKE),
  async (req, res, next) => {
  try {
    const rawIds = req.query.lessonIds;
    const lessonIds =
      typeof rawIds === 'string'
        ? rawIds
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : Array.isArray(rawIds)
        ? rawIds.map((s) => String(s).trim()).filter(Boolean)
        : undefined;

    const rawLimit = Number(req.query.limit || 50);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.round(rawLimit), 5), 100) : 50;

    const questions = await getComprehensiveExamQuestions(
      limit,
      lessonIds,
      req.user?.userId
    );
    const count = lessonIds?.length || 0;

    res.json({
      exam: {
        id: count > 0 ? `comprehensive_custom_${count}` : 'comprehensive_all_26',
        title:
          count > 0
            ? `Kiểm tra tổng hợp (${count} bài chọn)`
            : 'Kiểm tra tổng hợp (26 bài)',
        hskLevel: 'HSK 1 - HSK 3',
        description:
          count > 0
            ? `${questions.length} câu ngẫu nhiên tổng hợp từ ${count} bài học đã chọn.`
            : `${questions.length} câu ngẫu nhiên tổng hợp từ 26 bài học theo tỉ lệ đề thi HSK 3.`,
        questions,
      },
    });
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
    const currentUser = await resolveCurrentUser(req);
    const canTakeExam = Boolean(
      currentUser && hasUserPermission(currentUser, [PERMISSION_CODES.EXAM_TAKE])
    );
    const canPlayGames = Boolean(currentUser);
    res.json({
      lesson: {
        ...lesson,
        exercises: canPlayGames
          ? lesson.exercises
          : { sentenceScramble: [], translationExercises: [], expandedQuiz: [] },
        comprehensiveTest: canTakeExam ? lesson.comprehensiveTest : [],
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/lessons', requireAuth, async (req, res, next) => {
  try {
    const user = await resolveCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: 'Tài khoản không tồn tại.' });
      return;
    }

    const { title, hskLevel, unit, description, vocabulary, grammar, isSystem } = req.body;
    const createAsSystem = Boolean(isSystem);

    if (createAsSystem) {
      if (!hasUserPermission(user, [PERMISSION_CODES.LESSON_SYSTEM_CREATE])) {
        res.status(403).json({ error: 'Bạn không có quyền tạo bài học hệ thống.' });
        return;
      }
    } else if (!hasUserPermission(user, [PERMISSION_CODES.LESSON_CUSTOM_CRUD])) {
      res.status(403).json({ error: 'Bạn đã bị hạn chế quyền tạo buổi học cá nhân.' });
      return;
    }

    if (!title?.trim()) {
      res.status(400).json({ error: 'Tên buổi học không được để trống.' });
      return;
    }

    const created = await createLesson(
      user.id,
      {
        title,
        hskLevel: hskLevel || 'HSK 1',
        unit,
        description,
        vocabulary: Array.isArray(vocabulary) ? vocabulary : [],
        grammar: Array.isArray(grammar) ? grammar : [],
      },
      createAsSystem
    );
    res.status(201).json({ lesson: created });
  } catch (err) {
    next(err);
  }
});

router.put('/lessons/:id', requireAuth, async (req, res, next) => {
  try {
    const user = await resolveCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: 'Tài khoản không tồn tại.' });
      return;
    }

    const lessonId = String(req.params.id);
    const meta = await getLessonOwnership(lessonId);
    if (!meta) {
      res.status(404).json({ error: 'Không tìm thấy buổi học.' });
      return;
    }

    if (meta.isSystem) {
      if (!hasUserPermission(user, [PERMISSION_CODES.LESSON_SYSTEM_EDIT])) {
        res.status(403).json({ error: 'Bạn không có quyền chỉnh sửa bài học hệ thống.' });
        return;
      }
    } else {
      const isOwner = meta.ownerId === user.id;
      const canCrudCustom = hasUserPermission(user, [PERMISSION_CODES.LESSON_CUSTOM_CRUD]);
      if (!user.isSuperAdmin && (!isOwner || !canCrudCustom)) {
        res.status(403).json({ error: 'Bạn không có quyền sửa bài học này.' });
        return;
      }
    }

    const { title, hskLevel, unit, description, vocabulary, grammar } = req.body;
    if (!title?.trim()) {
      res.status(400).json({ error: 'Tên buổi học không được để trống.' });
      return;
    }

    const updated = await updateLessonById(
      lessonId,
      {
        title,
        hskLevel: hskLevel || 'HSK 1',
        unit,
        description,
        vocabulary: Array.isArray(vocabulary) ? vocabulary : [],
        grammar: Array.isArray(grammar) ? grammar : [],
      },
      user.id
    );
    res.json({ lesson: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/lessons/:id', requireAuth, async (req, res, next) => {
  try {
    const user = await resolveCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: 'Tài khoản không tồn tại.' });
      return;
    }

    const lessonId = String(req.params.id);
    const meta = await getLessonOwnership(lessonId);
    if (!meta) {
      res.status(404).json({ error: 'Không tìm thấy buổi học.' });
      return;
    }

    if (meta.isSystem) {
      if (!hasUserPermission(user, [PERMISSION_CODES.LESSON_SYSTEM_DELETE])) {
        res.status(403).json({ error: 'Bạn không có quyền xoá bài học hệ thống.' });
        return;
      }
    } else {
      const isOwner = meta.ownerId === user.id;
      const canCrudCustom = hasUserPermission(user, [PERMISSION_CODES.LESSON_CUSTOM_CRUD]);
      if (!user.isSuperAdmin && (!isOwner || !canCrudCustom)) {
        res.status(403).json({ error: 'Bạn không có quyền xoá bài học này.' });
        return;
      }
    }

    await deleteLessonById(lessonId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
