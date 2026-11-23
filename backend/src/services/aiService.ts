import { env } from '../config/env.js';
import {
  buildGameGradingCacheKey,
  getCachedGameGrade,
  getCachedTranslation,
  saveCachedGameGrade,
  saveCachedTranslation,
} from '../repositories/aiCacheRepo.js';
import {
  getLessonById,
  searchAllVocabulary,
  type GlobalVocabSearchHit,
} from '../repositories/lessonRepo.js';
import type {
  AiDictionaryEntry,
  AiDictionaryExample,
  AiPendingAction,
  AiToolExecutionSummary,
  GameGradeDirection,
  GameGradeMode,
  GameGradeResult,
  QuickLookupResult,
  TranslationDirection,
  UserProfile,
  VocabGlossaryItem,
} from '../types/domain.js';
import {
  AI_TOOL_DECLARATIONS,
  executeAiTool,
  type AiToolExecutionContext,
} from './aiTools.js';

export interface AiChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface DictionaryLookupResponse {
  query: string;
  direction: TranslationDirection;
  localHits: GlobalVocabSearchHit[];
  aiResult: AiDictionaryEntry | null;
  source: 'local_exact' | 'cache' | 'ai' | 'local_only';
  model: string | null;
  aiConfigured: boolean;
  notice?: string;
}

export function isAiConfigured(): boolean {
  return Boolean(env.ai.apiKey);
}

export function getAiPublicStatus() {
  return {
    configured: isAiConfigured(),
    provider: env.ai.provider,
    model: env.ai.model,
  };
}

function normalizeDirection(dir?: string): TranslationDirection {
  if (dir === 'zh_vi' || dir === 'vi_zh') return dir;
  return 'auto';
}

function detectLanguageHeuristic(text: string): 'zh' | 'vi' {
  return /[\u4e00-\u9fff]/.test(text) ? 'zh' : 'vi';
}

function parseJsonObject(rawText: string): Record<string, any> {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  const jsonSlice = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  return JSON.parse(jsonSlice) as Record<string, any>;
}

const GEMINI_FALLBACK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-4-hydrogen',
];

function buildGeminiThinkingConfig(model: string): Record<string, unknown> | undefined {
  const lower = model.toLowerCase();
  if (lower.includes('flash-lite')) {
    return { thinkingLevel: 'minimal' };
  }
  if (lower.startsWith('gemini-3') || lower.startsWith('gemini-4')) {
    return { thinkingLevel: 'low' };
  }
  if (lower.startsWith('gemini-2.5') && lower.includes('flash')) {
    return { thinkingBudget: 0 };
  }
  return undefined;
}

class RetryableGeminiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableGeminiError';
  }
}

interface GeminiContentTurn {
  role: 'user' | 'model';
  parts: Array<Record<string, any>>;
}

interface GeminiFunctionCallPart {
  name: string;
  args: Record<string, any>;
}

interface GeminiTurnResult {
  rawParts: Array<Record<string, any>>;
  text: string;
  functionCalls: GeminiFunctionCallPart[];
}

async function callGeminiSingleModel(
  model: string,
  options: {
    systemInstruction: string;
    contents: GeminiContentTurn[];
    jsonMode?: boolean;
    temperature?: number;
    maxOutputTokens?: number;
    tools?: Array<Record<string, any>>;
  }
): Promise<GeminiTurnResult> {
  const baseUrl =
    env.ai.baseUrl.replace(/\/+$/, '') || 'https://generativelanguage.googleapis.com/v1beta';
  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;

  const thinkingConfig = buildGeminiThinkingConfig(model);
  const body: Record<string, any> = {
    systemInstruction: {
      parts: [{ text: options.systemInstruction }],
    },
    contents: options.contents,
    generationConfig: {
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxOutputTokens ?? 1600,
      ...(options.jsonMode ? { responseMimeType: 'application/json' } : {}),
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
    ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.ai.timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.ai.apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      const apiMsg = data?.error?.message || `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Gemini API Key không hợp lệ hoặc chưa được cấp quyền (${apiMsg}).`);
      }
      if (res.status === 404 || res.status === 429 || res.status === 503) {
        throw new RetryableGeminiError(`Lỗi Gemini API (${res.status}): ${apiMsg}`);
      }
      throw new Error(`Lỗi Gemini API: ${apiMsg}`);
    }

    const parts = data?.candidates?.[0]?.content?.parts;
    const rawParts: Array<Record<string, any>> = Array.isArray(parts) ? parts : [];
    const functionCalls: GeminiFunctionCallPart[] = rawParts
      .filter((p) => p?.functionCall && typeof p.functionCall.name === 'string')
      .map((p) => ({
        name: String(p.functionCall.name),
        args:
          p.functionCall.args && typeof p.functionCall.args === 'object'
            ? p.functionCall.args
            : {},
      }));

    const text = rawParts
      .filter((p: any) => !p?.thought && typeof p?.text === 'string')
      .map((p: any) => p.text)
      .join('')
      .trim();

    if (!text && functionCalls.length === 0) {
      throw new Error('AI không trả về nội dung hợp lệ.');
    }
    return { rawParts, text, functionCalls };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new RetryableGeminiError('Kết nối tới Gemini API quá thời gian chờ. Vui lòng thử lại.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callGeminiTurn(options: {
  systemInstruction: string;
  contents: GeminiContentTurn[];
  jsonMode?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  tools?: Array<Record<string, any>>;
}): Promise<GeminiTurnResult & { usedModel: string }> {
  const primary = env.ai.model || 'gemini-3.5-flash-lite';
  const candidates = Array.from(new Set([primary, ...GEMINI_FALLBACK_MODELS]));

  let lastErr: Error | null = null;
  for (const model of candidates) {
    try {
      const turn = await callGeminiSingleModel(model, options);
      return { ...turn, usedModel: model };
    } catch (err) {
      if (err instanceof RetryableGeminiError) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Không thể kết nối tới Gemini API lúc này.');
}

async function callGemini(options: {
  systemInstruction: string;
  contents: GeminiContentTurn[];
  jsonMode?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<{ text: string; usedModel: string }> {
  const res = await callGeminiTurn(options);
  return { text: res.text, usedModel: res.usedModel };
}

async function callOpenAiCompatible(options: {
  systemInstruction: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const baseUrl = env.ai.baseUrl.replace(/\/+$/, '') || 'https://api.openai.com/v1';
  const url = `${baseUrl}/chat/completions`;
  const body: Record<string, any> = {
    model: env.ai.model,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 1400,
    messages: [{ role: 'system', content: options.systemInstruction }, ...options.messages],
    ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.ai.timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.ai.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      const apiMsg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Lỗi AI API (${res.status}): ${apiMsg}`);
    }
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('AI API không trả về nội dung hợp lệ.');
    }
    return text.trim();
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error('Kết nối tới AI API quá thời gian chờ.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function generateAiResponse(options: {
  systemInstruction: string;
  history?: AiChatHistoryItem[];
  userPrompt: string;
  jsonMode?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<{ text: string; usedModel: string }> {
  if (!isAiConfigured()) {
    console.warn('[AI] Chưa cấu hình GEMINI_API_KEY hoặc AI_API_KEY trong backend/.env.');
    throw new Error('Dịch vụ trợ lý AI hiện đang tạm thời gián đoạn. Vui lòng thử lại sau.');
  }

  const cleanHistory = (options.history || []).slice(-10);

  if (env.ai.provider === 'openai-compatible') {
    const text = await callOpenAiCompatible({
      systemInstruction: options.systemInstruction,
      messages: [...cleanHistory, { role: 'user', content: options.userPrompt }],
      jsonMode: options.jsonMode,
      temperature: options.temperature,
      maxTokens: options.maxOutputTokens,
    });
    return { text, usedModel: env.ai.model };
  }

  const contents = [
    ...cleanHistory.map((m) => ({
      role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      parts: [{ text: m.content }],
    })),
    { role: 'user' as const, parts: [{ text: options.userPrompt }] },
  ];

  return callGemini({
    systemInstruction: options.systemInstruction,
    contents,
    jsonMode: options.jsonMode,
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
  });
}

function normalizeExamples(raw: unknown): AiDictionaryExample[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .slice(0, 3)
    .map((item: any) => ({
      hanzi: String(item.hanzi || '').trim(),
      pinyin: String(item.pinyin || '').trim(),
      meaning: String(item.meaning || '').trim(),
    }))
    .filter((ex) => ex.hanzi && ex.meaning);
}

async function generateDictionaryEntryWithAi(
  query: string,
  direction: TranslationDirection
): Promise<{ entry: AiDictionaryEntry; usedModel: string }> {
  const dirInstruction =
    direction === 'zh_vi'
      ? 'Hãy dịch và phân tích từ tiếng Trung (giản thể/phồn thể hoặc Pinyin) sang tiếng Việt.'
      : direction === 'vi_zh'
      ? 'Hãy dịch từ tiếng Việt sang tiếng Trung giản thể chuẩn phổ thông kèm giải thích chi tiết.'
      : 'Tự nhận diện ngôn ngữ đầu vào (tiếng Trung, Pinyin, hay tiếng Việt) rồi dịch và phân tích sang ngôn ngữ còn lại.';

  const systemInstruction = `Bạn là từ điển học thuật Trung-Việt chuyên sâu cho người Việt học HSK.
${dirInstruction}
Luôn trả về DUY NHẤT một JSON object hợp lệ (không markdown dư thừa) với đúng các field sau:
{
  "detectedLanguage": "zh" | "vi" | "mixed",
  "isSentence": boolean,
  "hanzi": "Chữ Hán giản thể chuẩn (nếu input là tiếng Việt hoặc Pinyin thì là bản dịch tiếng Trung tương ứng)",
  "pinyin": "Pinyin có dấu thanh điệu chuẩn, cách âm rõ ràng",
  "sinoVietnamese": "Âm Hán Việt viết hoa chữ cái đầu nếu là từ/cụm từ ngắn, hoặc null nếu là câu dài",
  "wordType": "Từ loại (Danh từ, Động từ, Tính từ, Thành ngữ, Câu giao tiếp...)",
  "meaning": "Nghĩa tiếng Việt chính xác, súc tích nhất (hoặc bản dịch tiếng Việt tự nhiên nếu input là câu tiếng Trung)",
  "meanings": ["Nghĩa 1", "Nghĩa 2 (nếu có nhiều nét nghĩa)"],
  "radical": "Bộ thủ chính nếu là 1-2 chữ Hán (ví dụ: 木 (Mộc), 訁 (Ngôn)), ngược lại null",
  "breakdown": "Chiết tự ngắn gọn các thành phần chữ Hán để dễ nhớ (nếu là từ), ngược lại null",
  "mnemonic": "Mẹo ghi nhớ ngắn gọn bằng tiếng Việt (nếu phù hợp), ngược lại null",
  "grammarNote": "Lưu ý ngữ pháp, cách dùng hoặc phân biệt từ gần nghĩa (1-3 câu tiếng Việt)",
  "examples": [
    { "hanzi": "Câu ví dụ tiếng Trung ngắn tự nhiên", "pinyin": "Pinyin có dấu", "meaning": "Nghĩa tiếng Việt" }
  ]
}`;

  const { text: raw, usedModel } = await generateAiResponse({
    systemInstruction,
    userPrompt: `Tra từ / Dịch cụm câu sau: "${query.trim()}"`,
    jsonMode: true,
    temperature: 0.2,
  });

  const parsed = parseJsonObject(raw);
  const meaningsArr = Array.isArray(parsed.meanings)
    ? parsed.meanings.map((m: unknown) => String(m || '').trim()).filter(Boolean)
    : [];

  return {
    usedModel,
    entry: {
      query: query.trim(),
      direction,
      detectedLanguage:
        parsed.detectedLanguage === 'zh' || parsed.detectedLanguage === 'vi'
          ? parsed.detectedLanguage
          : detectLanguageHeuristic(query),
      isSentence: Boolean(parsed.isSentence),
      hanzi: String(parsed.hanzi || query).trim(),
      pinyin: String(parsed.pinyin || '').trim(),
      sinoVietnamese: parsed.sinoVietnamese ? String(parsed.sinoVietnamese).trim() : null,
      wordType: parsed.wordType ? String(parsed.wordType).trim() : null,
      meaning: String(parsed.meaning || meaningsArr[0] || '').trim(),
      meanings: meaningsArr,
      radical: parsed.radical ? String(parsed.radical).trim() : null,
      breakdown: parsed.breakdown ? String(parsed.breakdown).trim() : null,
      mnemonic: parsed.mnemonic ? String(parsed.mnemonic).trim() : null,
      grammarNote: parsed.grammarNote ? String(parsed.grammarNote).trim() : null,
      examples: normalizeExamples(parsed.examples),
    },
  };
}

function hasExactLocalMatch(hits: GlobalVocabSearchHit[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q || hits.length === 0) return false;
  return hits.some(
    (h) =>
      h.hanzi.trim().toLowerCase() === q ||
      (h.pinyin || '').trim().toLowerCase() === q ||
      (h.meaning || '').trim().toLowerCase() === q
  );
}

export async function lookupDictionary(options: {
  query: string;
  direction?: string;
  userId?: string;
  forceAi?: boolean;
}): Promise<DictionaryLookupResponse> {
  const query = options.query.trim();
  const direction = normalizeDirection(options.direction);
  const aiConfigured = isAiConfigured();

  const localHits = await searchAllVocabulary(query, options.userId);
  const cached = await getCachedTranslation(direction, query);

  if (cached && !options.forceAi) {
    return {
      query,
      direction,
      localHits,
      aiResult: cached.payload,
      source: 'cache',
      model: cached.model,
      aiConfigured,
    };
  }

  const exactLocal = hasExactLocalMatch(localHits, query);
  if (exactLocal && !options.forceAi) {
    return {
      query,
      direction,
      localHits,
      aiResult: null,
      source: 'local_exact',
      model: null,
      aiConfigured,
    };
  }

  if (!aiConfigured) {
    console.warn('[AI] Chưa cấu hình AI key -> chỉ trả về kết quả từ giáo trình HSK.');
    return {
      query,
      direction,
      localHits,
      aiResult: null,
      source: 'local_only',
      model: null,
      aiConfigured: false,
    };
  }

  const { entry: aiResult, usedModel } = await generateDictionaryEntryWithAi(query, direction);
  await saveCachedTranslation(direction, query, usedModel, aiResult);

  return {
    query,
    direction,
    localHits,
    aiResult,
    source: 'ai',
    model: usedModel,
    aiConfigured: true,
  };
}

const MAX_ATTACHED_LESSONS = 50;
const MAX_TOOL_ROUNDS = 4;

const INTERNAL_TOOL_PATTERN =
  'propose_create_lesson|propose_update_lesson|get_study_progress_summary|search_curriculum_vocab|bookmark_vocab_items|generate_review_exam|open_study_target|list_lessons|get_lesson_detail';

const TOOL_VIETNAMESE_LABELS: Record<string, string> = {
  get_study_progress_summary: 'thống kê tiến độ & lịch sử làm bài',
  list_lessons: 'danh sách buổi học',
  get_lesson_detail: 'chi tiết buổi học',
  search_curriculum_vocab: 'tìm kiếm từ vựng giáo trình',
  bookmark_vocab_items: 'đánh dấu từ vựng ôn tập',
  propose_create_lesson: 'tạo buổi học mới',
  propose_update_lesson: 'chỉnh sửa buổi học',
  open_study_target: 'mở màn hình học tập',
  generate_review_exam: 'tạo đề kiểm tra ôn tập',
};

export function sanitizeUserFacingReply(rawText: string): string {
  let text = String(rawText || '');
  text = text.replace(
    new RegExp(
      `\\s*\\(\\s*\`?(?:${INTERNAL_TOOL_PATTERN})\`?(?:\\s*(?:,|\\/|hoặc|và)\\s*\`?(?:${INTERNAL_TOOL_PATTERN})\`?)*\\s*\\)`,
      'gi'
    ),
    ''
  );
  text = text.replace(
    new RegExp(
      `\\s+(?:qua|bằng|nhờ|với)\\s+\`?(?:${INTERNAL_TOOL_PATTERN})\`?(?=[\\s.,;:!?)]|$)`,
      'gi'
    ),
    ''
  );
  text = text.replace(
    new RegExp(`\`?(${INTERNAL_TOOL_PATTERN})\`?`, 'gi'),
    (_, fn: string) => TOOL_VIETNAMESE_LABELS[fn.toLowerCase()] || 'công cụ hỗ trợ'
  );
  text = text.replace(/`?bestScore\s*>\s*70%`?/gi, 'điểm cao nhất > 70%');
  text = text.replace(/`?bestScore`?/g, 'điểm cao nhất');
  text = text.replace(/\s+\(\s*`?passed`?\s*\)/gi, '');
  text = text.replace(/`(?:lessonIds?|vocabIds?)`/g, 'danh sách bài/từ liên quan');
  text = text.replace(/ +([.,;:!?])/g, '$1');
  return text.trim();
}

export interface AiTutorChatResponse {
  reply: string;
  model: string;
  lessonTitle: string | null;
  lessonTitles: string[];
  toolExecutions: AiToolExecutionSummary[];
  pendingActions: AiPendingAction[];
  effects: {
    progressUpdated: boolean;
    lessonsUpdated: boolean;
  };
}

export async function askTutorChat(options: {
  message: string;
  history?: AiChatHistoryItem[];
  lessonIds?: string[];
  lessonId?: string;
  userId?: string;
  user?: UserProfile;
}): Promise<AiTutorChatResponse> {
  const requestedIds = Array.from(
    new Set(
      [
        ...(Array.isArray(options.lessonIds) ? options.lessonIds : []),
        ...(options.lessonId ? [options.lessonId] : []),
      ]
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    )
  ).slice(0, MAX_ATTACHED_LESSONS);

  let lessonContextBlock = '';
  const lessonTitles: string[] = [];

  if (requestedIds.length > 0) {
    const loadedLessons = (
      await Promise.all(requestedIds.map((id) => getLessonById(id, options.userId)))
    ).filter((l): l is NonNullable<typeof l> => Boolean(l));

    if (loadedLessons.length > 0) {
      const vocabPerLesson =
        loadedLessons.length <= 2 ? 30 : loadedLessons.length <= 8 ? 15 : 10;
      const grammarPerLesson =
        loadedLessons.length <= 2 ? 12 : loadedLessons.length <= 8 ? 6 : 4;

      const sections = loadedLessons.map((lesson) => {
        lessonTitles.push(lesson.title);
        const vocabLines =
          loadedLessons.length > 8
            ? lesson.vocabulary
                .slice(0, vocabPerLesson)
                .map((v) => `${v.hanzi}(${v.pinyin}:${v.meaning})`)
                .join('; ')
            : lesson.vocabulary
                .slice(0, vocabPerLesson)
                .map(
                  (v) =>
                    `- ${v.hanzi} (${v.pinyin})${v.sinoVietnamese ? ` [${v.sinoVietnamese}]` : ''}: ${v.meaning}`
                )
                .join('\n');
        const grammarLines = lesson.grammar
          .slice(0, grammarPerLesson)
          .map((g) => `- ${g.title}: ${g.formula}`)
          .join('\n');

        return `### ${lesson.title} (${lesson.hskLevel})
${vocabLines ? (loadedLessons.length > 8 ? `Từ vựng: ${vocabLines}` : `Từ vựng:\n${vocabLines}`) : ''}
${grammarLines ? `Ngữ pháp:\n${grammarLines}` : ''}`.trim();
      });

      lessonContextBlock = `\n\nNGỮ CẢNH CÁC BUỔI HỌC ĐƯỢC ĐÍNH KÈM (${loadedLessons.length} bài):\n${sections.join('\n\n')}`;
    }
  }

  const systemInstruction = `Bạn là Trợ lý AI & Gia sư tiếng Trung HSK (汉语学堂) chuyên biệt cho ứng dụng học tiếng Trung này.

PHẠM VI KHẢ NĂNG HỖ TRỢ (CHỈ LÀM TRONG CÁC NHÓM SAU):
- Học tiếng Trung HSK: giải thích từ vựng, chữ Hán, Pinyin, Âm Hán Việt, bộ thủ, ngữ pháp, sửa câu, luyện hội thoại, dịch Trung–Việt.
- Quản lý buổi học trong app: xem danh sách/chi tiết buổi học, đề xuất tạo hoặc chỉnh sửa buổi học qua tool \`propose_create_lesson\` / \`propose_update_lesson\` (theo đúng quyền RBAC).
- Tiến độ Dashboard, thống kê điểm đạt & lịch sử kiểm tra: xem số bài đạt theo chuẩn Dashboard (điểm cao nhất > 70%), điểm 4 kỹ năng (Từ vựng, Ngữ pháp, Nghe, Đọc hiểu), chuỗi ngày học (streak), lịch sử làm bài kiểm tra theo bài & tổng hợp, từ đánh dấu qua \`get_study_progress_summary\` (truyền \`lessonId\` nếu người dùng hỏi về một buổi học cụ thể); tìm và đánh dấu/bỏ đánh dấu từ vựng qua \`search_curriculum_vocab\` / \`bookmark_vocab_items\`.
- Tạo đề kiểm tra ôn tập & điều hướng: bốc đề kiểm tra ngẫu nhiên cho 1, nhiều hoặc tất cả buổi học qua \`generate_review_exam\`, hoặc tạo nút mở màn hình Tổng quan (\`dashboard\`), Từ đã đánh dấu (\`saved_vocab\`), Lịch sử làm bài (\`history\`), Học chi tiết (\`study\`), Kiểm tra tổng hợp (\`exam\`), Hồ sơ (\`profile\`) qua \`open_study_target\`.

QUY TẮC TỪ CHỐI YÊU CẦU NGOÀI KHẢ NĂNG (RẤT QUAN TRỌNG):
- Nếu người dùng hỏi hoặc nhờ làm việc NGOÀI phạm vi trên (ví dụ: viết code lập trình, giải toán/lý/hoá, tư vấn y tế/pháp lý/tài chính, hỏi thời tiết/tin tức/chính trị, trò chuyện giải trí không liên quan tiếng Trung, HOẶC yêu cầu chức năng app mà bạn không có tool như: xoá vĩnh viễn bài học, đổi mật khẩu/email, phân quyền admin cho tài khoản, xuất file Excel, truy cập dữ liệu của người dùng khác):
  -> KHÔNG cố trả lời lan man hay tự bịa tính năng không tồn tại.
  -> Hãy thông báo lịch sự, rõ ràng với người dùng đúng ý: **"Yêu cầu của bạn hiện không nằm trong khả năng hỗ trợ của AI trong ứng dụng."** (kèm 1 câu ngắn nêu rõ AI chỉ hỗ trợ học tiếng Trung HSK, quản lý buổi học, theo dõi tiến độ/đánh dấu từ vựng và tạo đề kiểm tra ôn tập).

Quy tắc trình bày & gọi tool khi trong phạm vi:
1. Giải thích bằng tiếng Việt tự nhiên, súc tích, thân thiện. Trình bày đẹp bằng Markdown chuẩn (tiêu đề \`###\`, danh sách gạch đầu dòng ngắn gọn, bảng Markdown khi so sánh hoặc thống kê điểm thi; hạn chế emoji dư thừa).
2. TUYỆT ĐỐI KHÔNG nhắc tên hàm nội bộ, tên tool hay tên biến kỹ thuật (ví dụ: không viết \`get_study_progress_summary\`, \`propose_create_lesson\`, \`propose_update_lesson\`, \`search_curriculum_vocab\`, \`bookmark_vocab_items\`, \`generate_review_exam\`, \`open_study_target\`, \`list_lessons\`, \`get_lesson_detail\`, \`lessonId\`, \`vocabId\`, \`bestScore\`, \`passed\`) trong nội dung trả lời cho người dùng; kể cả khi giới thiệu tính năng, hãy mô tả hoàn toàn bằng ngôn ngữ tiếng Việt dễ hiểu (VD: "xem thống kê Dashboard & 4 kỹ năng", "đề xuất tạo buổi học mới").
3. Mọi chữ Hán đưa ra phải kèm Pinyin có thanh điệu trong ngoặc đơn (ví dụ: 学习 (xuéxí) — học tập).
4. Khi người học hỏi về điểm số, điều kiện để đạt, bài yếu, kỹ năng yếu, chuỗi streak hoặc tổng hợp lịch sử làm bài kiểm tra: BẮT BUỘC gọi \`get_study_progress_summary\` trước để đọc đúng số liệu từ Dashboard (chuẩn đạt của Dashboard là \`bestScore > 70%\` và 4 kỹ năng: Từ vựng, Ngữ pháp, Nghe, Đọc hiểu). Nếu người học nhắc đích danh một buổi học (ví dụ "Bài 1"), hãy truyền \`lessonId\` tương ứng vào \`get_study_progress_summary\` (sau khi xác định từ \`list_lessons\` nếu chưa rõ ID) để tư vấn chính xác kỹ năng đang yếu của bài đó.
5. Nếu người học nhờ phân biệt từ gần nghĩa hoặc sửa câu sai, hãy nêu rõ: (a) Câu đúng / Khác biệt cốt lõi, (b) Lý do, (c) 2 ví dụ ngắn.
6. Nếu người học muốn tạo đề ôn tập từ các bài đã chọn hoặc các bài điểm yếu, hãy chủ động gọi \`generate_review_exam\` với đúng \`lessonIds\` (không cần gọi thêm \`open_study_target\` vì thẻ kết quả đã có nút vào làm bài ngay).
7. Muốn đánh dấu từ vựng thì PHẢI tìm đúng \`vocabId\` thật qua \`search_curriculum_vocab\` hoặc \`get_lesson_detail\` trước, tuyệt đối không tự bịa \`vocabId\`.${lessonContextBlock}`;

  if (env.ai.provider === 'openai-compatible' || !options.user) {
    const { text: reply, usedModel } = await generateAiResponse({
      systemInstruction,
      history: options.history,
      userPrompt: options.message.trim(),
      jsonMode: false,
      temperature: 0.45,
    });

    return {
      reply: sanitizeUserFacingReply(reply),
      model: usedModel,
      lessonTitle: lessonTitles[0] || null,
      lessonTitles,
      toolExecutions: [],
      pendingActions: [],
      effects: { progressUpdated: false, lessonsUpdated: false },
    };
  }

  if (!isAiConfigured()) {
    console.warn('[AI] Chưa cấu hình GEMINI_API_KEY hoặc AI_API_KEY trong backend/.env.');
    throw new Error('Dịch vụ trợ lý AI hiện đang tạm thời gián đoạn. Vui lòng thử lại sau.');
  }

  const cleanHistory = (options.history || []).slice(-10);
  const contents: GeminiContentTurn[] = [
    ...cleanHistory.map((m) => ({
      role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: options.message.trim() }] },
  ];

  const toolCtx: AiToolExecutionContext = {
    user: options.user,
    executions: [],
    pendingActions: [],
    effects: { progressUpdated: false, lessonsUpdated: false },
  };

  const toolsPayload = [{ functionDeclarations: AI_TOOL_DECLARATIONS }];
  let finalReply = '';
  let finalModel = env.ai.model;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const turn = await callGeminiTurn({
      systemInstruction,
      contents,
      jsonMode: false,
      temperature: 0.4,
      tools: toolsPayload,
    });
    finalModel = turn.usedModel;

    if (turn.functionCalls.length === 0) {
      finalReply = turn.text;
      break;
    }

    // Bắt buộc giữ nguyên rawParts (gồm cả thoughtSignature) cho Gemini 3/4
    contents.push({ role: 'model', parts: turn.rawParts });

    const responseParts: Array<Record<string, any>> = [];
    for (const fc of turn.functionCalls) {
      const result = await executeAiTool(fc.name, fc.args, toolCtx);
      responseParts.push({
        functionResponse: {
          name: fc.name,
          response: result,
        },
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  if (!finalReply) {
    const fallbackTurn = await callGeminiTurn({
      systemInstruction,
      contents,
      jsonMode: false,
      temperature: 0.4,
    });
    finalModel = fallbackTurn.usedModel;
    finalReply = fallbackTurn.text;
  }

  return {
    reply: sanitizeUserFacingReply(finalReply),
    model: finalModel,
    lessonTitle: lessonTitles[0] || null,
    lessonTitles,
    toolExecutions: toolCtx.executions,
    pendingActions: toolCtx.pendingActions,
    effects: toolCtx.effects,
  };
}

const PINYIN_TONE_STRIP_MAP: Record<string, string> = {
  ā: 'a', á: 'a', ǎ: 'a', à: 'a',
  ē: 'e', é: 'e', ě: 'e', è: 'e',
  ī: 'i', í: 'i', ǐ: 'i', ì: 'i',
  ō: 'o', ó: 'o', ǒ: 'o', ò: 'o',
  ū: 'u', ú: 'u', ǔ: 'u', ù: 'u',
  ǖ: 'u', ǘ: 'u', ǚ: 'u', ǜ: 'u', ü: 'u',
};

function normalizeGameText(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\s,.;:!?'"“”‘’()（）！？。，、]/g, '')
    .trim();
}

function stripGamePinyinTones(str: string): string {
  return normalizeGameText(str).replace(
    /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/g,
    (ch) => PINYIN_TONE_STRIP_MAP[ch] ?? ch
  );
}

function tokenizeGameWords(str: string): string[] {
  return str
    .toLowerCase()
    .replace(/[,.;:!?'"“”‘’()（）！？。，、/]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function hasSameCharMultiset(a: string, b: string): boolean {
  const arrA = Array.from(normalizeGameText(a)).sort();
  const arrB = Array.from(normalizeGameText(b)).sort();
  if (arrA.length !== arrB.length) return false;
  for (let i = 0; i < arrA.length; i++) {
    if (arrA[i] !== arrB[i]) return false;
  }
  return true;
}

export interface GradeGameAnswerParams {
  mode: GameGradeMode;
  direction?: GameGradeDirection;
  exerciseId: string;
  promptText: string;
  expectedChinese?: string | null;
  expectedPinyin?: string | null;
  expectedMeaning?: string | null;
  userAnswer: string;
  canConsumeAiQuota?: () => boolean;
}

export async function gradeGameAnswer(params: GradeGameAnswerParams): Promise<GameGradeResult> {
  const userAnswer = params.userAnswer.trim();
  const direction: GameGradeDirection | null =
    params.mode === 'translation' ? (params.direction || 'vi_to_zh') : null;
  const cleanUser = normalizeGameText(userAnswer);

  if (!cleanUser) {
    return {
      isCorrect: false,
      feedback: 'Bạn chưa nhập đáp án.',
      suggestion: null,
      source: 'local',
      aiUsed: false,
    };
  }

  const expectedZh = (params.expectedChinese || '').trim();
  const expectedPy = (params.expectedPinyin || '').trim();
  const expectedMeaning = (params.expectedMeaning || '').trim();

  // --- Tier 1: Local exact check + Guardrails (0ms, 0 token) ---
  if (params.mode === 'scramble') {
    const cleanExpectedZh = normalizeGameText(expectedZh);
    if (cleanExpectedZh && cleanUser === cleanExpectedZh) {
      return {
        isCorrect: true,
        feedback: '',
        suggestion: null,
        source: 'local',
        aiUsed: false,
      };
    }
    if (cleanExpectedZh && !hasSameCharMultiset(userAnswer, expectedZh)) {
      return {
        isCorrect: false,
        feedback: 'Câu ghép chưa khớp đủ tập từ của đề bài.',
        suggestion: expectedZh || null,
        source: 'local',
        aiUsed: false,
      };
    }
  } else if (direction === 'vi_to_zh') {
    const cleanZh = normalizeGameText(expectedZh);
    const cleanPy = normalizeGameText(expectedPy);
    const cleanUserNoTone = stripGamePinyinTones(userAnswer);
    const cleanPyNoTone = stripGamePinyinTones(expectedPy);

    if (
      (cleanZh && cleanUser === cleanZh) ||
      (cleanPy && (cleanUser === cleanPy || cleanUserNoTone === cleanPyNoTone))
    ) {
      return {
        isCorrect: true,
        feedback: '',
        suggestion: null,
        source: 'local',
        aiUsed: false,
      };
    }

    const userHasHanzi = /[\u4e00-\u9fff]/.test(userAnswer);
    if (userHasHanzi) {
      if (cleanZh.length >= 4 && cleanUser.length < Math.max(2, Math.floor(cleanZh.length * 0.45))) {
        return {
          isCorrect: false,
          feedback: 'Câu trả lời còn thiếu nội dung so với đề bài.',
          suggestion: null,
          source: 'local',
          aiUsed: false,
        };
      }
    } else if (
      cleanPyNoTone.length >= 8 &&
      cleanUserNoTone.length < Math.max(4, Math.floor(cleanPyNoTone.length * 0.45))
    ) {
      return {
        isCorrect: false,
        feedback: 'Phần Pinyin còn quá ngắn hoặc chưa dịch đủ hết câu.',
        suggestion: null,
        source: 'local',
        aiUsed: false,
      };
    }
  } else {
    const cleanExpectedMeaning = normalizeGameText(expectedMeaning);
    if (cleanExpectedMeaning && cleanUser === cleanExpectedMeaning) {
      return {
        isCorrect: true,
        feedback: '',
        suggestion: null,
        source: 'local',
        aiUsed: false,
      };
    }
    const expectedWords = tokenizeGameWords(expectedMeaning);
    const userWords = tokenizeGameWords(userAnswer);
    if (
      cleanUser.length < 2 ||
      (expectedWords.length >= 4 &&
        userWords.length < Math.max(2, Math.ceil(expectedWords.length * 0.35)))
    ) {
      return {
        isCorrect: false,
        feedback: 'Bản dịch còn quá ngắn hoặc thiếu ý chính của câu.',
        suggestion: null,
        source: 'local',
        aiUsed: false,
      };
    }
  }

  // --- Tier 2: Persistent / RAM Cache Lookup (~10ms, 0 token) ---
  const normalizedCacheAnswer =
    params.mode === 'scramble'
      ? cleanUser
      : direction === 'vi_to_zh'
        ? /[\u4e00-\u9fff]/.test(userAnswer)
          ? cleanUser
          : stripGamePinyinTones(userAnswer)
        : userAnswer.toLowerCase().replace(/\s+/g, ' ');

  const cacheKey = buildGameGradingCacheKey(
    params.mode,
    params.exerciseId || normalizeGameText(params.promptText).slice(0, 64),
    direction,
    normalizedCacheAnswer
  );

  try {
    const cached = await getCachedGameGrade(cacheKey);
    if (cached) {
      return {
        isCorrect: cached.isCorrect,
        feedback: cached.feedback,
        suggestion: cached.suggestion,
        source: 'cache',
        aiUsed: true,
      };
    }
  } catch (err) {
    console.warn('[AI Game Grade] Không đọc được cache, tiếp tục xử lý:', err);
  }

  // --- Tier 3: AI Semantic Grader Fallback ---
  if (!isAiConfigured()) {
    console.warn('[AI Game Grade] AI chưa được cấu hình, fallback chấm local.');
    return {
      isCorrect: false,
      feedback: '',
      suggestion: null,
      source: 'local_fallback',
      aiUsed: false,
    };
  }

  if (params.canConsumeAiQuota && !params.canConsumeAiQuota()) {
    return {
      isCorrect: false,
      feedback: '',
      suggestion: null,
      source: 'local_fallback',
      aiUsed: false,
    };
  }

  const systemInstruction =
    params.mode === 'scramble'
      ? [
          'Bạn là giáo viên tiếng Trung HSK giàu kinh nghiệm, chấm bài Sắp xếp từ thành câu.',
          'QUAN TRỌNG: Phải phân tích kỹ từng từ trong trường "analysis" TRƯỚC, rồi mới kết luận "isCorrect" sao cho 100% nhất quán với phần phân tích.',
          'Chỉ trả về JSON thuần đúng thứ tự các trường sau: {"analysis": string, "isCorrect": boolean, "feedback": string, "suggestion": string | null}.',
          'Lưu ý đặc biệt của trò chơi ghép từ:',
          '- Các mảnh từ KHÔNG có dấu câu (không có dấu phẩy `，`), nên từ cảm thán/đáp lại đầu câu (như 是, 对, 好, 嗯, 不, 没有) sẽ dính liền với vế sau. Ví dụ: "是我每个周末都到那儿买书" chính là "是，我每个周末都到那儿买书".',
          '- TUYỆT ĐỐI KHÔNG đánh sai chỉ vì khác trật tự với "Câu chuẩn tham khảo". Tiêu chí duy nhất là: câu người học ghép có ĐÚNG NGỮ PHÁP tiếng Trung hiện đại, tự nhiên và CÙNG NGHĨA với đề tiếng Việt hay không.',
          'Quy tắc chấm:',
          '- BẮT BUỘC CHẤP NHẬN (isCorrect=true) khi câu ghép đúng ngữ pháp và cùng nghĩa, bao gồm mọi cách đảo hợp lệ như: trạng ngữ thời gian đặt TRƯỚC hoặc SAU chủ ngữ ("我每个周末都..." = "每个周末我都...", "我们下午去吧" = "下午我们去吧"), hai cụm đẳng lập đổi chỗ, v.v.',
          '- CHỈ TỪ CHỐI (isCorrect=false) khi câu THỰC SỰ sai ngữ pháp tiếng Trung (sai vị trí phó từ 都/也/就/还, sai vị trí trợ từ 吧/吗/了/的/呢, sai trật tự định ngữ-trung tâm ngữ, hoặc đổi ngược chủ ngữ-tân ngữ làm sai nghĩa).',
          'Ví dụ mẫu:',
          '1) Câu chuẩn: "是每个周末我都到那儿买书" | Người học: "是我每个周末都到那儿买书" -> {"analysis": "Người học ghép là 是，我每个周末都到那儿买书. Cấu trúc Chủ ngữ (我) + Trạng ngữ thời gian (每个周末) + 都 + Động từ (到那儿买书) hoàn toàn đúng ngữ pháp và cùng nghĩa.", "isCorrect": true, "feedback": "Trạng ngữ thời gian 每个周末 đặt sau chủ ngữ 我 hoàn toàn tự nhiên và đúng ngữ pháp.", "suggestion": null}',
          '2) Câu chuẩn: "是每个周末我都到那儿买书" | Người học: "是我都每个周末到那儿买书" -> {"analysis": "Phó từ 都 đứng trước 每个周末 là sai ngữ pháp tiếng Trung, 都 phải đứng sau 每个周末 và trước động từ 到.", "isCorrect": false, "feedback": "Trong cấu trúc 每...都..., phó từ 都 phải đặt sau 每个周末 và trước động từ 到.", "suggestion": "是我每个周末都到那儿买书"}',
          '- Trường feedback viết bằng tiếng Việt ngắn gọn (1 câu, tối đa 180 ký tự), KHÔNG mở đầu bằng "Chính xác!", "Đúng rồi!" hay "Sai rồi!" (vì giao diện đã hiển thị sẵn nhãn này) và PHẢI khớp hoàn toàn với isCorrect.',
        ].join('\n')
      : direction === 'vi_to_zh'
        ? [
            'Bạn là giáo viên tiếng Trung HSK chấm bài Dịch Việt → Trung (người học có thể gõ Hán tự, Pinyin có dấu hoặc Pinyin không dấu).',
            'Phải phân tích kỹ từng vế trong "analysis" TRƯỚC rồi mới chốt "isCorrect" nhất quán 100% với phân tích.',
            'Chỉ trả về JSON thuần đúng thứ tự các trường: {"analysis": string, "isCorrect": boolean, "feedback": string, "suggestion": string | null}.',
            'Quy tắc chấm:',
            '- KHÔNG chấm sai chỉ vì khác câu mẫu. BẮT BUỘC CHẤP NHẬN (isCorrect=true) nếu câu người học dịch ĐẦY ĐỦ TẤT CẢ CÁC VẾ Ý của đề tiếng Việt, đúng ngữ pháp và tự nhiên; chấp nhận từ đồng nghĩa phù hợp (vd: 药店/药房, 这样/为了, 我们/咱们), trật tự trạng ngữ linh hoạt (我每个周末都... / 每个周末我都..., 下午我们去吧 / 我们下午去吧), và chấp nhận Pinyin không dấu hoặc dính/tách âm tiết miễn đọc đúng âm của từ đúng.',
            '- TỪ CHỐI (isCorrect=false) nếu dịch thiếu vế/thiếu câu, sai nghĩa chính, gõ sai âm Pinyin làm lệch nghĩa, hoặc sai ngữ pháp nghiêm trọng.',
            '- Trường feedback viết bằng tiếng Việt ngắn gọn (1-2 câu, tối đa 220 ký tự), khớp hoàn toàn với isCorrect.',
            '- Trường suggestion: nếu cần gợi ý 1 cách diễn đạt tự nhiên hơn thì ghi ngắn gọn, không thì để null.',
          ].join('\n')
        : [
            'Bạn là giáo viên tiếng Trung HSK chấm bài Dịch Trung → Việt.',
            'Phải phân tích kỹ trong "analysis" TRƯỚC rồi mới chốt "isCorrect" nhất quán 100% với phân tích.',
            'Chỉ trả về JSON thuần đúng thứ tự các trường: {"analysis": string, "isCorrect": boolean, "feedback": string, "suggestion": string | null}.',
            'Quy tắc chấm:',
            '- BẮT BUỘC CHẤP NHẬN (isCorrect=true) nếu bản dịch tiếng Việt đúng và ĐỦ TẤT CẢ Ý CHÍNH của câu tiếng Trung, chấp nhận khác đại từ xưng hô (tôi/tớ/mình, cậu/bạn/anh/chị) hoặc từ đồng nghĩa tự nhiên.',
            '- TỪ CHỐI (isCorrect=false) nếu dịch thiếu vế/thiếu thông tin quan trọng hoặc sai nghĩa.',
            '- Trường feedback viết bằng tiếng Việt ngắn gọn (1-2 câu, tối đa 220 ký tự), khớp hoàn toàn với isCorrect.',
            '- Trường suggestion: để null nếu không cần sửa thêm.',
          ].join('\n');

  const userPrompt =
    params.mode === 'scramble'
      ? [
          `Nghĩa tiếng Việt: ${params.promptText}`,
          `Câu chuẩn tham khảo: ${expectedZh}${expectedPy ? ` (${expectedPy})` : ''}`,
          `Câu người học ghép (không có dấu phẩy): ${userAnswer}`,
          'Hãy đọc thật kỹ từng chữ của câu người học ghép, phân tích ngữ pháp trong "analysis" trước rồi kết luận "isCorrect".',
        ].join('\n')
      : direction === 'vi_to_zh'
        ? [
            `Đề tiếng Việt cần dịch: ${params.promptText}`,
            `Đáp án tham khảo (Hán tự): ${expectedZh || '(không có)'}`,
            `Đáp án tham khảo (Pinyin): ${expectedPy || '(không có)'}`,
            `Câu trả lời của người học: ${userAnswer}`,
          ].join('\n')
        : [
            `Câu tiếng Trung cần dịch: ${params.promptText}`,
            `Nghĩa tham khảo tiếng Việt: ${expectedMeaning || '(không có)'}`,
            `Bản dịch của người học: ${userAnswer}`,
          ].join('\n');

  try {
    const { text, usedModel } = await generateAiResponse({
      systemInstruction,
      userPrompt,
      jsonMode: true,
      temperature: 0,
      maxOutputTokens: 520,
    });

    const parsed = parseJsonObject(text);
    const isCorrect = Boolean(parsed.isCorrect);
    const rawFeedback =
      typeof parsed.feedback === 'string'
        ? parsed.feedback
            .trim()
            .replace(
              /^(?:chính xác|đúng rồi|rất tốt|tuyệt vời|chưa chính xác|chưa khớp|chưa đúng(?:\s+thứ\s+tự)?|sai rồi)\s*[!.,:\-–—]*\s*/iu,
              ''
            )
            .trim()
        : '';
    const normalizedFeedback = rawFeedback
      ? rawFeedback.charAt(0).toUpperCase() + rawFeedback.slice(1)
      : '';
    const feedback =
      normalizedFeedback.slice(0, 280) ||
      (isCorrect
        ? 'Cách diễn đạt này đúng ngữ pháp và sát nghĩa với đề bài.'
        : 'Câu trả lời chưa khớp nghĩa hoặc ngữ pháp với đề bài.');
    const suggestion =
      typeof parsed.suggestion === 'string' && parsed.suggestion.trim()
        ? parsed.suggestion.trim().slice(0, 280)
        : null;

    await saveCachedGameGrade({
      cacheKey,
      gameMode: params.mode,
      direction,
      exerciseId: params.exerciseId || 'unknown',
      userAnswer,
      isCorrect,
      feedback,
      suggestion,
      model: usedModel,
    }).catch((err) => {
      console.warn('[AI Game Grade] Không lưu được cache:', err);
    });

    return {
      isCorrect,
      feedback,
      suggestion,
      source: 'ai',
      aiUsed: true,
    };
  } catch (err) {
    console.warn('[AI Game Grade] Lỗi gọi AI, fallback local:', err);
    return {
      isCorrect: false,
      feedback: '',
      suggestion: null,
      source: 'local_fallback',
      aiUsed: false,
    };
  }
}

export interface QuickLookupWordParams {
  word: string;
  context?: string;
  userId?: string;
  canConsumeAiQuota?: () => boolean;
}

export async function quickLookupChineseWord(
  params: QuickLookupWordParams
): Promise<QuickLookupResult> {
  const cleanWord = params.word.trim().replace(/[^\u4e00-\u9fff]/g, '');
  if (!cleanWord || cleanWord.length > 12) {
    return { entry: null, source: 'unavailable' };
  }

  // --- Tier 1: Tra trực tiếp kho từ vựng DB (< 5ms, 0 token) ---
  try {
    const hits = await searchAllVocabulary(cleanWord, params.userId);
    const exact = hits.find((h) => {
      const normalizedHead = h.hanzi
        .replace(/\([^)]*\)|（[^）]*）/g, '')
        .split(/[/／、,，]/)
        .map((p) => p.replace(/[^\u4e00-\u9fff]/g, '').trim());
      return normalizedHead.includes(cleanWord);
    });
    if (exact) {
      return {
        entry: {
          hanzi: cleanWord,
          pinyin: exact.pinyin || '',
          sinoVietnamese: exact.sinoVietnamese || null,
          meaning: exact.meaning || '',
          wordType: exact.type || null,
          source: 'db',
        },
        source: 'db',
      };
    }
  } catch (err) {
    console.warn('[Quick Lookup] Lỗi tra DB, chuyển sang cache:', err);
  }

  // --- Tier 2: Tra translation_cache dùng chung (~10ms, 0 token) ---
  // Ưu tiên bản từ điển đầy đủ nếu đã có, sau đó tới bản tra nhanh quick::
  try {
    const cached =
      (await getCachedTranslation('zh_vi', cleanWord)) ||
      (await getCachedTranslation('zh_vi', `quick::${cleanWord}`));
    if (cached?.payload?.meaning) {
      return {
        entry: {
          hanzi: cleanWord,
          pinyin: cached.payload.pinyin || '',
          sinoVietnamese: cached.payload.sinoVietnamese || null,
          meaning: cached.payload.meaning,
          wordType: cached.payload.wordType || null,
          source: 'cache',
        },
        source: 'cache',
      };
    }
  } catch (err) {
    console.warn('[Quick Lookup] Lỗi đọc translation_cache, chuyển sang AI:', err);
  }

  // --- Tier 3: Gọi AI siêu gọn (~120 token) & lưu vào translation_cache ---
  if (!isAiConfigured()) {
    console.warn('[Quick Lookup] AI chưa được cấu hình, bỏ qua tra nhanh AI.');
    return { entry: null, source: 'unavailable' };
  }
  if (params.canConsumeAiQuota && !params.canConsumeAiQuota()) {
    return { entry: null, source: 'unavailable' };
  }

  const contextClean = (params.context || '').trim().slice(0, 220);
  const systemInstruction = [
    'Bạn là từ điển Trung-Việt ngắn gọn chuẩn HSK cho thẻ gợi ý di chuột (Wikipedia-style).',
    'Chỉ trả về JSON thuần đúng cấu trúc: {"hanzi": string, "pinyin": string, "sinoVietnamese": string | null, "wordType": string | null, "meaning": string}.',
    'Quy tắc:',
    '- pinyin có dấu thanh điệu đầy đủ (ưu tiên đúng âm đọc theo ngữ cảnh nếu có câu ngữ cảnh).',
    '- sinoVietnamese: âm Hán-Việt viết hoa chữ cái đầu mỗi tiếng (ví dụ "Hầu Lung", "Phát Viêm"), hoặc null nếu là trợ từ thuần khẩu ngữ.',
    '- wordType: từ loại ngắn gọn bằng tiếng Việt (vd "Danh từ", "Động từ", "Danh từ / Động từ"), hoặc null.',
    '- meaning: nghĩa tiếng Việt súc tích (tối đa 110 ký tự). Nếu từ có nhiều từ loại khác nhau, tách rõ từng từ loại bằng dấu chấm phẩy (vd: "Danh từ: giờ; Động từ: châm lửa, gọi món").',
  ].join('\n');

  const userPrompt = contextClean
    ? `Tra nhanh từ: ${cleanWord}\nCâu ngữ cảnh: ${contextClean}`
    : `Tra nhanh từ: ${cleanWord}`;

  try {
    const { text, usedModel } = await generateAiResponse({
      systemInstruction,
      userPrompt,
      jsonMode: true,
      temperature: 0.1,
      maxOutputTokens: 220,
    });

    const parsed = parseJsonObject(text);
    const meaning = typeof parsed.meaning === 'string' ? parsed.meaning.trim().slice(0, 140) : '';
    if (!meaning) {
      return { entry: null, source: 'unavailable' };
    }

    const entry: VocabGlossaryItem = {
      hanzi: cleanWord,
      pinyin: typeof parsed.pinyin === 'string' ? parsed.pinyin.trim().slice(0, 80) : '',
      sinoVietnamese:
        typeof parsed.sinoVietnamese === 'string' && parsed.sinoVietnamese.trim()
          ? parsed.sinoVietnamese.trim().slice(0, 80)
          : null,
      meaning,
      wordType:
        typeof parsed.wordType === 'string' && parsed.wordType.trim()
          ? parsed.wordType.trim().slice(0, 40)
          : null,
      source: 'ai',
    };

    // Lưu vào translation_cache để user sau hưởng qua Read-through / Cache DB
    const cachePayload: AiDictionaryEntry = {
      query: cleanWord,
      direction: 'zh_vi',
      detectedLanguage: 'zh',
      isSentence: false,
      hanzi: entry.hanzi,
      pinyin: entry.pinyin,
      sinoVietnamese: entry.sinoVietnamese,
      wordType: entry.wordType,
      meaning: entry.meaning,
      meanings: [entry.meaning],
      radical: null,
      breakdown: null,
      mnemonic: null,
      grammarNote: null,
      examples: [],
    };
    await saveCachedTranslation('zh_vi', `quick::${cleanWord}`, usedModel, cachePayload).catch((err) => {
      console.warn('[Quick Lookup] Không lưu được cache:', err);
    });

    return { entry, source: 'ai' };
  } catch (err) {
    console.warn('[Quick Lookup] Lỗi gọi AI:', err);
    return { entry: null, source: 'unavailable' };
  }
}
