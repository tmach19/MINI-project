import { Router } from 'express';
import { env } from '../config/env.js';
import { PERMISSION_CODES } from '../config/rbacCatalog.js';
import { getLanguageStrategy, normalizeLanguageCode } from '../languages/registry.js';
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
  listLanguages,
  listLessons,
  searchAllVocabulary,
  updateLessonById,
} from '../repositories/lessonRepo.js';

const router = Router();

router.get('/languages', async (_req, res, next) => {
  try {
    const languages = await listLanguages();
    res.json({
      languages,
      media: {
        enBaseUrl: env.media.enBaseUrl || '/media/en',
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/vocab/glossary', optionalAuth, async (req, res, next) => {
  try {
    const lang = normalizeLanguageCode(req.query.lang);
    const items = await getVocabGlossary(req.user?.userId, lang);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get('/vocab/search', optionalAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || '');
    const lang = normalizeLanguageCode(req.query.lang);
    const items = await searchAllVocabulary(q, req.user?.userId, lang);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get('/lessons', optionalAuth, async (req, res, next) => {
  try {
    const lang = normalizeLanguageCode(req.query.lang);
    const lessons = await listLessons(req.user?.userId, lang);
    res.json({ lessons, languageCode: lang });
  } catch (err) {
    next(err);
  }
});

router.get(
  '/tests/comprehensive-exam',
  requirePermission(PERMISSION_CODES.EXAM_TAKE),
  async (req, res, next) => {
  try {
    const lang = normalizeLanguageCode(req.query.lang);
    const strategy = getLanguageStrategy(lang);
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
      req.user?.userId,
      lang
    );
    const count = lessonIds?.length || 0;

    res.json({
      exam: {
        id:
          count > 0
            ? `comprehensive_${lang}_custom_${count}`
            : lang === 'en'
              ? 'comprehensive_en_all'
              : 'comprehensive_all_26',
        languageCode: lang,
        title:
          count > 0
            ? `Kiểm tra tổng hợp (${count} bài chọn)`
            : strategy.meta.examTitleAll,
        hskLevel: strategy.meta.examLevelRange,
        description:
          count > 0
            ? `${questions.length} câu ngẫu nhiên tổng hợp từ ${count} bài học đã chọn.`
            : lang === 'en'
              ? `${questions.length} câu ngẫu nhiên tổng hợp từ lộ trình Tiếng Anh CEFR A1.`
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

    const { title, hskLevel, unit, description, vocabulary, grammar, isSystem, languageCode } = req.body;
    const createAsSystem = Boolean(isSystem);
    const safeLang = normalizeLanguageCode(languageCode ?? req.query.lang);

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
        languageCode: safeLang,
        title,
        hskLevel: hskLevel || (safeLang === 'en' ? 'CEFR A1' : 'HSK 1'),
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
