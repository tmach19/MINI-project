import { env } from '../config/env.js';
import { getCachedTranslation, saveCachedTranslation } from '../repositories/aiCacheRepo.js';
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
  TranslationDirection,
  UserProfile,
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
}): Promise<{ text: string; usedModel: string }> {
  if (!isAiConfigured()) {
    throw new Error('Chưa cấu hình GEMINI_API_KEY (hoặc AI_API_KEY) trong backend/.env.');
  }

  const cleanHistory = (options.history || []).slice(-10);

  if (env.ai.provider === 'openai-compatible') {
    const text = await callOpenAiCompatible({
      systemInstruction: options.systemInstruction,
      messages: [...cleanHistory, { role: 'user', content: options.userPrompt }],
      jsonMode: options.jsonMode,
      temperature: options.temperature,
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
    return {
      query,
      direction,
      localHits,
      aiResult: null,
      source: 'local_only',
      model: null,
      aiConfigured: false,
      notice:
        'Chưa cấu hình GEMINI_API_KEY trong backend/.env nên hệ thống chỉ hiển thị kết quả từ giáo trình HSK.',
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
- Tiến độ & ôn tập: xem điểm thi/bài yếu/từ đánh dấu (\`get_study_progress_summary\`), tìm từ trong giáo trình (\`search_curriculum_vocab\`), đánh dấu hoặc bỏ đánh dấu từ vựng (\`bookmark_vocab_items\`).
- Tạo đề kiểm tra ôn tập & điều hướng: bốc đề kiểm tra ngẫu nhiên cho 1, nhiều hoặc tất cả buổi học qua \`generate_review_exam\`, hoặc tạo nút mở màn hình học/thi qua \`open_study_target\`.

QUY TẮC TỪ CHỐI YÊU CẦU NGOÀI KHẢ NĂNG (RẤT QUAN TRỌNG):
- Nếu người dùng hỏi hoặc nhờ làm việc NGOÀI phạm vi trên (ví dụ: viết code lập trình, giải toán/lý/hoá, tư vấn y tế/pháp lý/tài chính, hỏi thời tiết/tin tức/chính trị, trò chuyện giải trí không liên quan tiếng Trung, HOẶC yêu cầu chức năng app mà bạn không có tool như: xoá vĩnh viễn bài học, đổi mật khẩu/email, phân quyền admin cho tài khoản, xuất file Excel, truy cập dữ liệu của người dùng khác):
  -> KHÔNG cố trả lời lan man hay tự bịa tính năng không tồn tại.
  -> Hãy thông báo lịch sự, rõ ràng với người dùng đúng ý: **"Yêu cầu của bạn hiện không nằm trong khả năng hỗ trợ của AI trong ứng dụng."** (kèm 1 câu ngắn nêu rõ AI chỉ hỗ trợ học tiếng Trung HSK, quản lý buổi học, theo dõi tiến độ/đánh dấu từ vựng và tạo đề kiểm tra ôn tập).

Quy tắc trình bày & gọi tool khi trong phạm vi:
1. Giải thích bằng tiếng Việt tự nhiên, súc tích. Trình bày đẹp bằng Markdown chuẩn (tiêu đề \`###\`, danh sách gạch đầu dòng ngắn gọn, bảng Markdown khi so sánh hoặc thống kê điểm thi; hạn chế emoji dư thừa).
2. Mọi chữ Hán đưa ra phải kèm Pinyin có thanh điệu trong ngoặc đơn (ví dụ: 学习 (xuéxí) — học tập).
3. Nếu người học nhờ phân biệt từ gần nghĩa hoặc sửa câu sai, hãy nêu rõ: (a) Câu đúng / Khác biệt cốt lõi, (b) Lý do, (c) 2 ví dụ ngắn.
4. Nếu người học muốn tạo đề ôn tập từ các bài đã chọn hoặc các bài điểm yếu, hãy chủ động gọi \`generate_review_exam\` với đúng \`lessonIds\` (không cần gọi thêm \`open_study_target\` vì thẻ kết quả đã có nút vào làm bài ngay).
5. Muốn đánh dấu từ vựng thì PHẢI tìm đúng \`vocabId\` thật qua \`search_curriculum_vocab\` hoặc \`get_lesson_detail\` trước, tuyệt đối không tự bịa \`vocabId\`.${lessonContextBlock}`;

  if (env.ai.provider === 'openai-compatible' || !options.user) {
    const { text: reply, usedModel } = await generateAiResponse({
      systemInstruction,
      history: options.history,
      userPrompt: options.message.trim(),
      jsonMode: false,
      temperature: 0.45,
    });

    return {
      reply,
      model: usedModel,
      lessonTitle: lessonTitles[0] || null,
      lessonTitles,
      toolExecutions: [],
      pendingActions: [],
      effects: { progressUpdated: false, lessonsUpdated: false },
    };
  }

  if (!isAiConfigured()) {
    throw new Error('Chưa cấu hình GEMINI_API_KEY (hoặc AI_API_KEY) trong backend/.env.');
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
    reply: finalReply,
    model: finalModel,
    lessonTitle: lessonTitles[0] || null,
    lessonTitles,
    toolExecutions: toolCtx.executions,
    pendingActions: toolCtx.pendingActions,
    effects: toolCtx.effects,
  };
}
