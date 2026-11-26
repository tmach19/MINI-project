import { Router } from 'express';
import { PERMISSION_CODES } from '../config/rbacCatalog.js';
import { normalizeLanguageCode } from '../languages/registry.js';
import { requirePermission } from '../middleware/auth.js';
import {
  askTutorChat,
  getAiPublicStatus,
  gradeGameAnswer,
  lookupDictionary,
  quickLookupChineseWord,
  type AiChatHistoryItem,
} from '../services/aiService.js';

const router = Router();

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 20;
const GRADE_RATE_MAX_REQUESTS = 40;
const QUICK_LOOKUP_RATE_MAX_REQUESTS = 60;
const rateBucket = new Map<string, number[]>();
const gradeRateBucket = new Map<string, number[]>();
const quickLookupRateBucket = new Map<string, number[]>();

function checkBucketRateLimit(
  bucket: Map<string, number[]>,
  userId: string,
  maxRequests: number
): boolean {
  const now = Date.now();
  const timestamps = (bucket.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= maxRequests) {
    bucket.set(userId, timestamps);
    return false;
  }
  timestamps.push(now);
  bucket.set(userId, timestamps);
  return true;
}

function checkUserRateLimit(userId: string): boolean {
  return checkBucketRateLimit(rateBucket, userId, RATE_MAX_REQUESTS);
}

function checkGameGradeRateLimit(userId: string): boolean {
  return checkBucketRateLimit(gradeRateBucket, userId, GRADE_RATE_MAX_REQUESTS);
}

function checkQuickLookupRateLimit(userId: string): boolean {
  return checkBucketRateLimit(quickLookupRateBucket, userId, QUICK_LOOKUP_RATE_MAX_REQUESTS);
}

router.get('/status', (_req, res) => {
  res.json(getAiPublicStatus());
});

router.post(
  '/dictionary',
  requirePermission(PERMISSION_CODES.AI_ASSISTANT_USE),
  async (req, res, next) => {
    try {
      const { query, direction, forceAi, lang } = req.body as {
        query?: string;
        direction?: string;
        forceAi?: boolean;
        lang?: string;
      };

      const trimmed = typeof query === 'string' ? query.trim() : '';
      if (!trimmed) {
        res.status(400).json({ error: 'Vui lòng nhập từ hoặc câu cần tra cứu.' });
        return;
      }
      if (trimmed.length > 500) {
        res.status(400).json({ error: 'Nội dung tra cứu tối đa 500 ký tự.' });
        return;
      }

      if (!checkUserRateLimit(req.user!.userId)) {
        res.status(429).json({
          error: 'Bạn thao tác AI quá nhanh. Vui lòng chờ vài giây rồi thử lại.',
        });
        return;
      }

      const result = await lookupDictionary({
        query: trimmed,
        direction,
        lang: normalizeLanguageCode(lang ?? req.query.lang),
        userId: req.user!.userId,
        forceAi: Boolean(forceAi),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/chat',
  requirePermission(PERMISSION_CODES.AI_ASSISTANT_USE),
  async (req, res, next) => {
    try {
      const { message, history, lessonId, lessonIds, lang } = req.body as {
        message?: string;
        history?: AiChatHistoryItem[];
        lessonId?: string;
        lessonIds?: string[];
        lang?: string;
      };

      const trimmed = typeof message === 'string' ? message.trim() : '';
      if (!trimmed) {
        res.status(400).json({ error: 'Vui lòng nhập câu hỏi cho Gia sư AI.' });
        return;
      }
      if (trimmed.length > 1500) {
        res.status(400).json({ error: 'Câu hỏi tối đa 1500 ký tự.' });
        return;
      }

      if (!checkUserRateLimit(req.user!.userId)) {
        res.status(429).json({
          error: 'Bạn gửi yêu cầu AI quá nhanh. Vui lòng chờ vài giây rồi thử lại.',
        });
        return;
      }

      const cleanHistory: AiChatHistoryItem[] = Array.isArray(history)
        ? history
            .filter(
              (m) =>
                m &&
                (m.role === 'user' || m.role === 'assistant') &&
                typeof m.content === 'string' &&
                m.content.trim().length > 0
            )
            .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 2000) }))
        : [];

      const cleanLessonIds = Array.isArray(lessonIds)
        ? lessonIds
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
            .map((id) => id.trim())
        : undefined;

      const data = await askTutorChat({
        message: trimmed,
        history: cleanHistory,
        lessonIds: cleanLessonIds,
        lessonId: typeof lessonId === 'string' && lessonId.trim() ? lessonId.trim() : undefined,
        lang: normalizeLanguageCode(lang ?? req.query.lang),
        userId: req.user!.userId,
        user: req.currentUser,
      });
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/grade-game',
  requirePermission(PERMISSION_CODES.AI_ASSISTANT_USE),
  async (req, res, next) => {
    try {
      const {
        mode,
        direction,
        lang,
        exerciseId,
        promptText,
        expectedChinese,
        expectedPinyin,
        expectedMeaning,
        userAnswer,
      } = req.body as {
        mode?: string;
        direction?: string;
        lang?: string;
        exerciseId?: string;
        promptText?: string;
        expectedChinese?: string | null;
        expectedPinyin?: string | null;
        expectedMeaning?: string | null;
        userAnswer?: string;
      };

      if (mode !== 'scramble' && mode !== 'translation') {
        res.status(400).json({ error: 'Chế độ chấm điểm không hợp lệ.' });
        return;
      }

      const cleanAnswer = typeof userAnswer === 'string' ? userAnswer.trim() : '';
      if (!cleanAnswer) {
        res.status(400).json({ error: 'Vui lòng nhập đáp án trước khi kiểm tra.' });
        return;
      }
      if (cleanAnswer.length > 600) {
        res.status(400).json({ error: 'Đáp án quá dài (tối đa 600 ký tự).' });
        return;
      }

      const cleanPrompt = typeof promptText === 'string' ? promptText.trim() : '';
      if (!cleanPrompt) {
        res.status(400).json({ error: 'Thiếu nội dung đề bài cần chấm.' });
        return;
      }

      const safeLang = normalizeLanguageCode(
        lang ??
          req.query.lang ??
          (direction === 'vi_to_en' || direction === 'en_to_vi' ? 'en' : 'zh')
      );
      const parsedDirection =
        mode === 'translation'
          ? safeLang === 'en'
            ? direction === 'en_to_vi' || direction === 'zh_to_vi'
              ? 'en_to_vi'
              : 'vi_to_en'
            : direction === 'zh_to_vi'
              ? 'zh_to_vi'
              : 'vi_to_zh'
          : undefined;

      const userId = req.user!.userId;
      const result = await gradeGameAnswer({
        mode,
        direction: parsedDirection,
        lang: safeLang,
        exerciseId: typeof exerciseId === 'string' ? exerciseId.trim() : '',
        promptText: cleanPrompt,
        expectedChinese: typeof expectedChinese === 'string' ? expectedChinese : null,
        expectedPinyin: typeof expectedPinyin === 'string' ? expectedPinyin : null,
        expectedMeaning: typeof expectedMeaning === 'string' ? expectedMeaning : null,
        userAnswer: cleanAnswer,
        canConsumeAiQuota: () => checkGameGradeRateLimit(userId),
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/quick-lookup',
  requirePermission(PERMISSION_CODES.AI_ASSISTANT_USE),
  async (req, res, next) => {
    try {
      const { word, context, lang } = req.body as {
        word?: string;
        context?: string;
        lang?: string;
      };

      const trimmed = typeof word === 'string' ? word.trim() : '';
      if (!trimmed) {
        res.status(400).json({ error: 'Vui lòng cung cấp từ cần tra.' });
        return;
      }
      if (trimmed.length > 40) {
        res.status(400).json({ error: 'Từ tra nhanh quá dài.' });
        return;
      }

      const userId = req.user!.userId;
      const result = await quickLookupChineseWord({
        word: trimmed,
        context: typeof context === 'string' ? context.slice(0, 240) : undefined,
        lang: normalizeLanguageCode(lang ?? req.query.lang),
        userId,
        canConsumeAiQuota: () => checkQuickLookupRateLimit(userId),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
