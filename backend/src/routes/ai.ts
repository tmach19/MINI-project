import { Router } from 'express';
import { PERMISSION_CODES } from '../config/rbacCatalog.js';
import { requirePermission } from '../middleware/auth.js';
import {
  askTutorChat,
  getAiPublicStatus,
  lookupDictionary,
  type AiChatHistoryItem,
} from '../services/aiService.js';

const router = Router();

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 20;
const rateBucket = new Map<string, number[]>();

function checkUserRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = (rateBucket.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_MAX_REQUESTS) {
    rateBucket.set(userId, timestamps);
    return false;
  }
  timestamps.push(now);
  rateBucket.set(userId, timestamps);
  return true;
}

router.get('/status', (_req, res) => {
  res.json(getAiPublicStatus());
});

router.post(
  '/dictionary',
  requirePermission(PERMISSION_CODES.AI_ASSISTANT_USE),
  async (req, res, next) => {
    try {
      const { query, direction, forceAi } = req.body as {
        query?: string;
        direction?: string;
        forceAi?: boolean;
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
      const { message, history, lessonId, lessonIds } = req.body as {
        message?: string;
        history?: AiChatHistoryItem[];
        lessonId?: string;
        lessonIds?: string[];
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
        userId: req.user!.userId,
        user: req.currentUser,
      });
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
