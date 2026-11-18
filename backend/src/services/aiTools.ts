import crypto from 'node:crypto';
import { PERMISSION_CODES } from '../config/rbacCatalog.js';
import { memoryStore } from '../db/fallbackStore.js';
import { getDbMode, getPool } from '../db/pool.js';
import { hasUserPermission } from '../middleware/auth.js';
import {
  getComprehensiveExamQuestions,
  getLessonById,
  getLessonOwnership,
  listLessons,
  searchAllVocabulary,
} from '../repositories/lessonRepo.js';
import {
  getMarkedVocabCards,
  getUserLessonTestSummary,
  listTestAttempts,
  toggleMarkedVocab,
} from '../repositories/userProgressRepo.js';
import type {
  AiLessonDraftGrammar,
  AiLessonDraftVocab,
  AiPendingAction,
  AiToolExecutionSummary,
  UserProfile,
} from '../types/domain.js';

export interface AiToolExecutionContext {
  user: UserProfile;
  executions: AiToolExecutionSummary[];
  pendingActions: AiPendingAction[];
  effects: {
    progressUpdated: boolean;
    lessonsUpdated: boolean;
  };
}

export const AI_TOOL_DECLARATIONS = [
  {
    name: 'get_study_progress_summary',
    description:
      'Lấy tổng hợp tiến độ học tập của người dùng hiện tại: điểm thi theo từng buổi học, các bài đạt/chưa đạt/chưa thi, các lượt thi tổng hợp 26 bài gần đây, và danh sách từ vựng đang được đánh dấu cần ôn.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'list_lessons',
    description:
      'Liệt kê tất cả các buổi học hiện có (bao gồm bài hệ thống HSK và bài tự tạo của người dùng) kèm id, tiêu đề, cấp độ HSK, số lượng từ vựng/ngữ pháp.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'get_lesson_detail',
    description:
      'Xem chi tiết từ vựng (kèm vocabId) và ngữ pháp của một buổi học cụ thể dựa vào lessonId.',
    parameters: {
      type: 'OBJECT',
      properties: {
        lessonId: {
          type: 'STRING',
          description: 'ID của buổi học cần xem (ví dụ lesson-1 hoặc custom_xxxx)',
        },
      },
      required: ['lessonId'],
    },
  },
  {
    name: 'search_curriculum_vocab',
    description:
      'Tìm kiếm từ vựng có sẵn trong giáo trình HSK và bài học tự tạo của người dùng theo Hán tự, Pinyin, nghĩa tiếng Việt, Hán Việt hoặc bộ thủ. Dùng để lấy chính xác vocabId trước khi đánh dấu.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Từ khoá cần tìm (chữ Hán, Pinyin, tiếng Việt, bộ thủ)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'bookmark_vocab_items',
    description:
      'Đánh dấu hoặc bỏ đánh dấu danh sách từ vựng vào mục Từ cần ôn tập trong hồ sơ của người dùng. Cần có vocabId thật lấy từ search_curriculum_vocab hoặc get_lesson_detail.',
    parameters: {
      type: 'OBJECT',
      properties: {
        marked: {
          type: 'BOOLEAN',
          description: 'true để đánh dấu ôn tập, false để bỏ đánh dấu',
        },
        note: {
          type: 'STRING',
          description: 'Ghi chú ôn tập ngắn đính kèm cho các từ (tuỳ chọn)',
        },
        vocabIds: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Danh sách vocabId hợp lệ cần đánh dấu/bỏ đánh dấu (tối đa 20 từ)',
        },
      },
      required: ['marked', 'vocabIds'],
    },
  },
  {
    name: 'propose_create_lesson',
    description:
      'Đề xuất tạo một buổi học mới (bài tự tạo cá nhân hoặc bài hệ thống nếu user có quyền) để người dùng xem trước và bấm xác nhận lưu. Luôn soạn đầy đủ hanzi, pinyin, meaning cho từng từ vựng.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Tên buổi học' },
        hskLevel: {
          type: 'STRING',
          description: 'Cấp độ HSK: HSK 1, HSK 2, HSK 3, HSK 4, HSK 5 hoặc HSK 6',
        },
        unit: { type: 'STRING', description: 'Nhóm/Chủ đề bài học (tuỳ chọn)' },
        description: { type: 'STRING', description: 'Mô tả ngắn trọng tâm buổi học' },
        isSystem: {
          type: 'BOOLEAN',
          description: 'true nếu tạo bài học hệ thống (chỉ dùng khi user có quyền và yêu cầu rõ), mặc định false',
        },
        vocabulary: {
          type: 'ARRAY',
          description: 'Danh sách từ vựng (tối thiểu 2 từ, nên từ 5-15 từ)',
          items: {
            type: 'OBJECT',
            properties: {
              hanzi: { type: 'STRING' },
              pinyin: { type: 'STRING' },
              sinoVietnamese: { type: 'STRING' },
              meaning: { type: 'STRING' },
              radical: { type: 'STRING' },
              breakdown: { type: 'STRING' },
              example: { type: 'STRING' },
            },
            required: ['hanzi', 'pinyin', 'meaning'],
          },
        },
        grammar: {
          type: 'ARRAY',
          description: 'Danh sách điểm ngữ pháp đi kèm (tuỳ chọn)',
          items: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING' },
              formula: { type: 'STRING' },
              explanation: { type: 'STRING' },
            },
            required: ['title', 'formula'],
          },
        },
      },
      required: ['title', 'hskLevel', 'vocabulary'],
    },
  },
  {
    name: 'propose_update_lesson',
    description:
      'Đề xuất cập nhật nội dung (tiêu đề, mô tả, toàn bộ danh sách từ vựng/ngữ pháp sau khi chỉnh sửa hoặc bổ sung) cho một buổi học hiện có, để người dùng xem trước và xác nhận.',
    parameters: {
      type: 'OBJECT',
      properties: {
        lessonId: { type: 'STRING', description: 'ID buổi học cần cập nhật' },
        title: { type: 'STRING', description: 'Tên buổi học' },
        hskLevel: { type: 'STRING', description: 'Cấp độ HSK' },
        unit: { type: 'STRING' },
        description: { type: 'STRING' },
        vocabulary: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              hanzi: { type: 'STRING' },
              pinyin: { type: 'STRING' },
              sinoVietnamese: { type: 'STRING' },
              meaning: { type: 'STRING' },
              radical: { type: 'STRING' },
              breakdown: { type: 'STRING' },
              example: { type: 'STRING' },
            },
            required: ['hanzi', 'pinyin', 'meaning'],
          },
        },
        grammar: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING' },
              formula: { type: 'STRING' },
              explanation: { type: 'STRING' },
            },
            required: ['title', 'formula'],
          },
        },
      },
      required: ['lessonId', 'title', 'hskLevel', 'vocabulary'],
    },
  },
  {
    name: 'open_study_target',
    description:
      'Tạo nút điều hướng nhanh trên giao diện để người dùng bấm mở một buổi học, sang tab Kiểm tra/Trò chơi/Từ vựng, mở trang Profile hoặc Kiểm tra tổng hợp 50 câu.',
    parameters: {
      type: 'OBJECT',
      properties: {
        label: { type: 'STRING', description: 'Nhãn hiển thị trên nút bấm' },
        view: {
          type: 'STRING',
          description: 'Màn hình đích: study | profile | exam',
        },
        lessonId: { type: 'STRING', description: 'ID bài học nếu view = study' },
        tab: {
          type: 'STRING',
          description: 'Tab nếu view = study: vocab | texts | grammar | games | test',
        },
      },
      required: ['label', 'view'],
    },
  },
  {
    name: 'generate_review_exam',
    description:
      'Tạo một đề kiểm tra tổng hợp / ôn tập ngẫu nhiên cho 1 bài, nhiều bài, hoặc tất cả bài học (theo danh sách lessonIds), rồi tự động hiển thị thẻ "Làm bài kiểm tra ngay" trên giao diện. Không cần gọi thêm open_study_target.',
    parameters: {
      type: 'OBJECT',
      properties: {
        lessonIds: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description:
            'Danh sách ID các buổi học muốn bốc đề (bỏ trống nếu muốn bốc ngẫu nhiên từ tất cả bài hệ thống)',
        },
        questionCount: {
          type: 'INTEGER',
          description:
            'Số lượng câu hỏi (từ 5 đến 50; mặc định 50 nếu chọn >= 3 bài hoặc tất cả bài, 20 nếu chọn 1-2 bài trừ khi người dùng yêu cầu số khác)',
        },
        examTitle: {
          type: 'STRING',
          description: 'Tiêu đề ngắn gọn cho đề ôn tập (tuỳ chọn)',
        },
      },
    },
  },
];

async function filterAccessibleVocabIds(
  userId: string,
  vocabIds: string[]
): Promise<Array<{ id: string; hanzi: string }>> {
  const cleanIds = Array.from(new Set(vocabIds.map((x) => String(x || '').trim()).filter(Boolean))).slice(
    0,
    20
  );
  if (cleanIds.length === 0) return [];

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const idSet = new Set(cleanIds);
    const matched: Array<{ id: string; hanzi: string }> = [];
    for (const lesson of memoryStore.lessons) {
      if (!lesson.isSystem && lesson.ownerId !== userId) continue;
      for (const v of lesson.vocabulary) {
        if (idSet.has(v.id)) {
          matched.push({ id: v.id, hanzi: v.hanzi });
        }
      }
    }
    return matched;
  }

  const pool = getPool()!;
  const res = await pool.query<{ id: string; hanzi: string }>(
    `SELECT v.id, v.hanzi
     FROM vocabularies v
     JOIN lessons l ON l.id = v.lesson_id
     WHERE v.id = ANY($1::text[])
       AND (l.is_system = TRUE OR l.owner_id = $2::uuid)`,
    [cleanIds, userId]
  );
  return res.rows;
}

function normalizeDraftVocabulary(raw: unknown): AiLessonDraftVocab[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .slice(0, 40)
    .map((item: any) => ({
      hanzi: String(item.hanzi || '').trim(),
      pinyin: String(item.pinyin || item.hanzi || '').trim(),
      sinoVietnamese: item.sinoVietnamese ? String(item.sinoVietnamese).trim() : null,
      meaning: String(item.meaning || '').trim(),
      radical: item.radical ? String(item.radical).trim() : null,
      breakdown: item.breakdown ? String(item.breakdown).trim() : null,
      example: item.example ? String(item.example).trim() : null,
    }))
    .filter((v) => v.hanzi && v.meaning);
}

function normalizeDraftGrammar(raw: unknown): AiLessonDraftGrammar[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .slice(0, 20)
    .map((item: any) => ({
      title: String(item.title || '').trim(),
      formula: String(item.formula || '').trim(),
      explanation: item.explanation ? String(item.explanation).trim() : null,
    }))
    .filter((g) => g.title);
}

export async function executeAiTool(
  name: string,
  rawArgs: Record<string, any>,
  ctx: AiToolExecutionContext
): Promise<Record<string, any>> {
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};

  switch (name) {
    case 'get_study_progress_summary': {
      const [lessonSummary, markedCards, attempts] = await Promise.all([
        getUserLessonTestSummary(ctx.user.id),
        getMarkedVocabCards(ctx.user.id),
        listTestAttempts(ctx.user.id),
      ]);

      const attempted = lessonSummary.filter((l) => l.attemptCount > 0);
      const passed = attempted.filter((l) => l.status === 'passed');
      const failed = attempted.filter((l) => l.status === 'failed');
      const unattempted = lessonSummary.filter((l) => l.attemptCount === 0);
      const comprehensiveAttempts = attempts.filter((a) => !a.lessonId).slice(0, 10);

      const weakest = [...attempted]
        .sort((a, b) => (a.avgScore ?? 0) - (b.avgScore ?? 0))
        .slice(0, 5)
        .map((l) => ({
          lessonId: l.lessonId,
          lessonTitle: l.lessonTitle,
          avgScore: l.avgScore,
          bestScore: l.bestScore,
          attemptCount: l.attemptCount,
          status: l.status,
        }));

      ctx.executions.push({
        name,
        summary: `Đọc tiến độ (${attempted.length}/${lessonSummary.length} bài đã thi, ${markedCards.length} từ đánh dấu)`,
      });

      return {
        stats: {
          totalLessons: lessonSummary.length,
          attemptedLessons: attempted.length,
          passedLessons: passed.length,
          failedLessons: failed.length,
          unattemptedLessons: unattempted.length,
          markedVocabCount: markedCards.length,
          totalAttempts: attempts.length,
        },
        weakestLessons: weakest,
        unattemptedSample: unattempted.slice(0, 8).map((l) => ({
          lessonId: l.lessonId,
          lessonTitle: l.lessonTitle,
        })),
        markedVocabSample: markedCards.slice(0, 20).map((m) => ({
          vocabId: m.id,
          hanzi: m.hanzi,
          pinyin: m.pinyin,
          meaning: m.meaning,
          lessonId: m.lessonId,
          lessonTitle: m.lessonTitle,
          note: m.note || null,
        })),
        recentComprehensiveExams: comprehensiveAttempts.map((a) => ({
          score: a.score,
          correctCount: a.correctCount,
          totalQuestions: a.totalQuestions,
          submittedAt: a.submittedAt,
        })),
      };
    }

    case 'list_lessons': {
      const lessons = await listLessons(ctx.user.id);
      ctx.executions.push({ name, summary: `Liệt kê ${lessons.length} buổi học` });
      return {
        total: lessons.length,
        lessons: lessons.map((l) => ({
          id: l.id,
          title: l.title,
          hskLevel: l.hskLevel,
          unit: l.unit,
          isSystem: l.isSystem,
          vocabCount: l.vocabCount,
          grammarCount: l.grammarCount,
        })),
      };
    }

    case 'get_lesson_detail': {
      const lessonId = String(args.lessonId || '').trim();
      if (!lessonId) return { ok: false, error: 'Thiếu lessonId.' };
      const lesson = await getLessonById(lessonId, ctx.user.id);
      if (!lesson) return { ok: false, error: `Không tìm thấy buổi học ${lessonId}.` };

      ctx.executions.push({ name, summary: `Đọc chi tiết "${lesson.title}"` });
      return {
        id: lesson.id,
        title: lesson.title,
        hskLevel: lesson.hskLevel,
        unit: lesson.unit,
        description: lesson.description,
        isSystem: lesson.isSystem,
        vocabulary: lesson.vocabulary.slice(0, 40).map((v) => ({
          vocabId: v.id,
          hanzi: v.hanzi,
          pinyin: v.pinyin,
          sinoVietnamese: v.sinoVietnamese,
          meaning: v.meaning,
          radical: v.radical,
        })),
        grammar: lesson.grammar.slice(0, 15).map((g) => ({
          title: g.title,
          formula: g.formula,
          explanation: g.explanation,
        })),
      };
    }

    case 'search_curriculum_vocab': {
      const query = String(args.query || '').trim();
      if (!query) return { ok: false, error: 'Thiếu từ khoá tìm kiếm.' };
      const hits = await searchAllVocabulary(query, ctx.user.id);
      ctx.executions.push({
        name,
        summary: `Tìm từ "${query}" (${hits.length} kết quả)`,
      });
      return {
        total: hits.length,
        items: hits.slice(0, 15).map((h) => ({
          vocabId: h.id,
          hanzi: h.hanzi,
          pinyin: h.pinyin,
          sinoVietnamese: h.sinoVietnamese,
          meaning: h.meaning,
          radical: h.radical,
          lessonId: h.lessonId,
          lessonTitle: h.lessonTitle,
        })),
      };
    }

    case 'bookmark_vocab_items': {
      if (!hasUserPermission(ctx.user, [PERMISSION_CODES.VOCAB_BOOKMARK])) {
        return {
          ok: false,
          error: 'Tài khoản của bạn không có quyền đánh dấu từ vựng (VOCAB_BOOKMARK).',
        };
      }

      const rawIds = Array.isArray(args.vocabIds) ? args.vocabIds : [];
      const accessible = await filterAccessibleVocabIds(ctx.user.id, rawIds);
      if (accessible.length === 0) {
        return {
          ok: false,
          error: 'Không tìm thấy vocabId hợp lệ trong giáo trình hoặc bài học của bạn.',
        };
      }

      const marked = Boolean(args.marked);
      const note = typeof args.note === 'string' && args.note.trim() ? args.note.trim() : undefined;

      for (const item of accessible) {
        await toggleMarkedVocab(ctx.user.id, item.id, marked, note);
      }

      ctx.effects.progressUpdated = true;
      ctx.executions.push({
        name,
        summary: `${marked ? 'Đã đánh dấu' : 'Đã bỏ đánh dấu'} ${accessible.length} từ (${accessible
          .map((x) => x.hanzi)
          .join(', ')})`,
      });

      return {
        ok: true,
        marked,
        count: accessible.length,
        items: accessible,
      };
    }

    case 'propose_create_lesson': {
      const requestedSystem = Boolean(args.isSystem);
      const canSystem = hasUserPermission(ctx.user, [PERMISSION_CODES.LESSON_SYSTEM_CREATE]);
      const canCustom = hasUserPermission(ctx.user, [PERMISSION_CODES.LESSON_CUSTOM_CRUD]);

      if (requestedSystem && !canSystem) {
        return {
          ok: false,
          error:
            'Bạn không có quyền tạo bài học hệ thống (LESSON_SYSTEM_CREATE). Bạn chỉ có thể đề xuất tạo buổi học tự tạo (isSystem: false) nếu có quyền LESSON_CUSTOM_CRUD.',
        };
      }
      if (!requestedSystem && !canCustom) {
        return {
          ok: false,
          error: 'Tài khoản của bạn đã bị hạn chế quyền tạo buổi học tự tạo (LESSON_CUSTOM_CRUD).',
        };
      }

      const title = String(args.title || '').trim();
      const vocabulary = normalizeDraftVocabulary(args.vocabulary);
      const grammar = normalizeDraftGrammar(args.grammar);
      if (!title || vocabulary.length === 0) {
        return {
          ok: false,
          error: 'Buổi học đề xuất cần có tiêu đề và ít nhất 1 từ vựng hợp lệ.',
        };
      }

      const draft: AiPendingAction = {
        id: crypto.randomUUID(),
        type: 'create_lesson',
        title,
        hskLevel: String(args.hskLevel || 'HSK 1').trim() || 'HSK 1',
        unit: args.unit ? String(args.unit).trim() : undefined,
        description: args.description ? String(args.description).trim() : undefined,
        isSystem: requestedSystem,
        vocabulary,
        grammar,
      };

      ctx.pendingActions.push(draft);
      ctx.executions.push({
        name,
        summary: `Chuẩn bị bản nháp bài mới "${title}" (${vocabulary.length} từ)`,
      });

      return {
        ok: true,
        status: 'pending_user_confirmation',
        message:
          'Đã tạo thẻ xem trước trên màn hình để người dùng kiểm tra và bấm "Xác nhận tạo bài học".',
        title,
        vocabCount: vocabulary.length,
        grammarCount: grammar.length,
      };
    }

    case 'propose_update_lesson': {
      const lessonId = String(args.lessonId || '').trim();
      if (!lessonId) return { ok: false, error: 'Thiếu lessonId.' };

      const meta = await getLessonOwnership(lessonId);
      if (!meta) return { ok: false, error: `Không tìm thấy buổi học ${lessonId}.` };

      if (meta.isSystem) {
        if (!hasUserPermission(ctx.user, [PERMISSION_CODES.LESSON_SYSTEM_EDIT])) {
          return {
            ok: false,
            error: 'Bạn không có quyền chỉnh sửa bài học hệ thống (LESSON_SYSTEM_EDIT).',
          };
        }
      } else {
        const isOwner = meta.ownerId === ctx.user.id;
        const canCustom = hasUserPermission(ctx.user, [PERMISSION_CODES.LESSON_CUSTOM_CRUD]);
        if (!ctx.user.isSuperAdmin && (!isOwner || !canCustom)) {
          return { ok: false, error: 'Bạn không có quyền chỉnh sửa buổi học này.' };
        }
      }

      const title = String(args.title || '').trim();
      const vocabulary = normalizeDraftVocabulary(args.vocabulary);
      const grammar = normalizeDraftGrammar(args.grammar);
      if (!title || vocabulary.length === 0) {
        return {
          ok: false,
          error: 'Nội dung cập nhật cần có tiêu đề và ít nhất 1 từ vựng hợp lệ.',
        };
      }

      const draft: AiPendingAction = {
        id: crypto.randomUUID(),
        type: 'update_lesson',
        lessonId,
        title,
        hskLevel: String(args.hskLevel || 'HSK 1').trim() || 'HSK 1',
        unit: args.unit ? String(args.unit).trim() : undefined,
        description: args.description ? String(args.description).trim() : undefined,
        isSystem: meta.isSystem,
        vocabulary,
        grammar,
      };

      ctx.pendingActions.push(draft);
      ctx.executions.push({
        name,
        summary: `Chuẩn bị bản cập nhật "${title}" (${vocabulary.length} từ)`,
      });

      return {
        ok: true,
        status: 'pending_user_confirmation',
        message:
          'Đã tạo thẻ xem trước cập nhật trên màn hình để người dùng bấm "Xác nhận cập nhật".',
        lessonId,
        title,
        vocabCount: vocabulary.length,
        grammarCount: grammar.length,
      };
    }

    case 'open_study_target': {
      const view =
        args.view === 'profile' || args.view === 'exam' ? args.view : ('study' as const);
      const tabRaw = String(args.tab || '');
      const validTab =
        tabRaw === 'vocab' ||
        tabRaw === 'texts' ||
        tabRaw === 'grammar' ||
        tabRaw === 'games' ||
        tabRaw === 'test'
          ? tabRaw
          : undefined;
      const label = String(args.label || 'Mở màn hình học tập').trim();
      const lessonId =
        typeof args.lessonId === 'string' && args.lessonId.trim()
          ? args.lessonId.trim()
          : undefined;

      ctx.pendingActions.push({
        id: crypto.randomUUID(),
        type: 'navigate',
        label,
        view,
        lessonId,
        tab: validTab,
      });
      ctx.executions.push({ name, summary: `Tạo nút điều hướng "${label}"` });
      return { ok: true, label, view, lessonId, tab: validTab };
    }

    case 'generate_review_exam': {
      if (!hasUserPermission(ctx.user, [PERMISSION_CODES.EXAM_TAKE])) {
        return {
          ok: false,
          error: 'Tài khoản của bạn đã bị hạn chế quyền làm bài kiểm tra (EXAM_TAKE).',
        };
      }

      const allLessons = await listLessons(ctx.user.id);
      const lessonMap = new Map(allLessons.map((l) => [l.id, l]));

      const requestedIds = Array.isArray(args.lessonIds)
        ? Array.from(
            new Set(
              args.lessonIds
                .map((id: unknown) => String(id || '').trim())
                .filter((id: string) => lessonMap.has(id))
            )
          )
        : [];

      const targetIds =
        requestedIds.length > 0
          ? requestedIds
          : allLessons.filter((l) => l.isSystem).map((l) => l.id);

      if (targetIds.length === 0) {
        return { ok: false, error: 'Không có buổi học hợp lệ nào để tạo đề kiểm tra.' };
      }

      const defaultCount = targetIds.length <= 2 ? 20 : 50;
      const rawCount = Number(args.questionCount || defaultCount);
      const count = Number.isFinite(rawCount)
        ? Math.min(Math.max(Math.round(rawCount), 5), 50)
        : defaultCount;

      const questions = await getComprehensiveExamQuestions(count, targetIds, ctx.user.id);
      if (questions.length === 0) {
        return {
          ok: false,
          error: 'Các buổi học được chọn hiện chưa có đủ câu hỏi trắc nghiệm ôn tập.',
        };
      }

      const selectedTitles = targetIds
        .map((id) => lessonMap.get(id)?.title)
        .filter((t): t is string => Boolean(t));

      const defaultTitle =
        targetIds.length === 1
          ? `Ôn tập: ${selectedTitles[0] || targetIds[0]}`
          : requestedIds.length === 0
          ? `Kiểm tra tổng hợp (${targetIds.length} bài)`
          : `Kiểm tra ôn tập (${targetIds.length} bài chọn)`;

      const title =
        typeof args.examTitle === 'string' && args.examTitle.trim()
          ? args.examTitle.trim()
          : defaultTitle;

      const description =
        targetIds.length === 1
          ? `${questions.length} câu ngẫu nhiên từ ${selectedTitles[0] || 'bài học đã chọn'}.`
          : `${questions.length} câu ngẫu nhiên tổng hợp từ ${targetIds.length} bài học đã chọn.`;

      ctx.pendingActions.push({
        id: crypto.randomUUID(),
        type: 'start_review_exam',
        title,
        description,
        lessonIds: targetIds,
        questions,
      });

      ctx.executions.push({
        name,
        summary: `Tạo đề "${title}" (${questions.length} câu)`,
      });

      return {
        ok: true,
        title,
        questionCount: questions.length,
        lessonCount: targetIds.length,
        lessons: selectedTitles,
      };
    }

    default:
      return { ok: false, error: `Không hỗ trợ công cụ: ${name}` };
  }
}
