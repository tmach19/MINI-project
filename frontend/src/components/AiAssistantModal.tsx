import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  Copy,
  GraduationCap,
  History,
  Languages,
  MessageSquare,
  Paperclip,
  PenTool,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { speakChinese } from '../lib/audio';
import type {
  AiChatMessage,
  AiDictionaryResponse,
  AiPendingAction,
  ComprehensiveExamResponse,
  LessonDetail,
  LessonSummary,
  TabId,
  VocabularyItem,
} from '../types';
import { ChatMarkdown } from './common/ChatMarkdown';
import { LoadingSpinner } from './common/LoadingState';
import { ErrorBanner, ModalCloseButton, ModalShell } from './common/ModalShell';

interface AiAssistantModalProps {
  initialTab?: 'dictionary' | 'chat';
  initialQuery?: string;
  currentLesson?: LessonDetail | null;
  lessons?: LessonSummary[];
  onClose: () => void;
  onJumpToLesson: (lessonId: string, tab?: TabId) => void;
  onNavigateView?: (view: 'study' | 'profile' | 'exam') => void;
  onStartReviewExam?: (exam: ComprehensiveExamResponse, lessonIds: string[]) => void;
  onOpenWriter: (vocab: VocabularyItem) => void;
  onProgressChanged?: () => Promise<void> | void;
  onLessonsChanged?: (focusLessonId?: string) => Promise<void> | void;
}

const HISTORY_STORAGE_KEY = 'cs_ai_dict_history';
const MAX_HISTORY_ITEMS = 12;

function loadDictHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveDictHistory(items: string[]): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Bỏ qua lỗi quota storage
  }
}

function extractHanziChars(text: string): string[] {
  const seen = new Set<string>();
  const chars: string[] = [];
  for (const ch of Array.from(text)) {
    if (/[\u4e00-\u9fff]/.test(ch) && !seen.has(ch)) {
      seen.add(ch);
      chars.push(ch);
    }
  }
  return chars.slice(0, 12);
}

function extractChineseSnippets(text: string): string[] {
  const matches = text.match(/[\u4e00-\u9fff][\u4e00-\u9fff，。？！、；：“”‘’\s]{0,40}[\u4e00-\u9fff]|[\u4e00-\u9fff]+/g);
  if (!matches) return [];
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    const clean = m.trim();
    if (clean.length >= 2 && !seen.has(clean)) {
      seen.add(clean);
      uniq.push(clean);
      if (uniq.length >= 6) break;
    }
  }
  return uniq;
}

export const AiAssistantModal: React.FC<AiAssistantModalProps> = ({
  initialTab = 'dictionary',
  initialQuery = '',
  currentLesson,
  lessons = [],
  onClose,
  onJumpToLesson,
  onNavigateView,
  onStartReviewExam,
  onOpenWriter,
  onProgressChanged,
  onLessonsChanged,
}) => {
  const [activeTab, setActiveTab] = useState<'dictionary' | 'chat'>(initialTab);

  // Dictionary state
  const [dictQuery, setDictQuery] = useState(initialQuery);
  const [dictLoading, setDictLoading] = useState(false);
  const [dictError, setDictError] = useState<string | null>(null);
  const [dictResult, setDictResult] = useState<AiDictionaryResponse | null>(null);
  const [dictHistory, setDictHistory] = useState<string[]>(() => loadDictHistory());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Tutor chat state — mặc định không đính kèm bài học nào
  const [selectedLessonIds, setSelectedLessonIds] = useState<string[]>([]);
  const [showLessonPicker, setShowLessonPicker] = useState(false);
  const [lessonSearch, setLessonSearch] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<AiChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [actionStates, setActionStates] = useState<
    Record<
      string,
      {
        status: 'saving' | 'done' | 'dismissed' | 'error';
        error?: string;
        savedLessonId?: string;
      }
    >
  >({});
  const chatEndRef = useRef<HTMLDivElement>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialQuery.trim()) {
      void runDictionaryLookup(initialQuery.trim(), false);
    }
  }, [initialQuery]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  const pushHistory = (q: string) => {
    const clean = q.trim();
    if (!clean) return;
    setDictHistory((prev) => {
      const next = [clean, ...prev.filter((item) => item !== clean)].slice(0, MAX_HISTORY_ITEMS);
      saveDictHistory(next);
      return next;
    });
  };

  const runDictionaryLookup = async (rawQuery = dictQuery, forceAi = false) => {
    const trimmed = rawQuery.trim();
    if (!trimmed || dictLoading) return;
    setDictError(null);
    setDictLoading(true);
    try {
      const res = await api.aiDictionary({ query: trimmed, direction: 'auto', forceAi });
      setDictResult(res);
      pushHistory(trimmed);
    } catch (err) {
      setDictError((err as Error).message || 'Không tra cứu được từ điển AI.');
    } finally {
      setDictLoading(false);
    }
  };

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
    } catch {
      // Bỏ qua nếu trình duyệt chặn clipboard
    }
  };

  const availableLessons = useMemo(() => {
    if (lessons.length > 0) return lessons;
    if (!currentLesson) return [];
    return [
      {
        id: currentLesson.id,
        title: currentLesson.title,
        hskLevel: currentLesson.hskLevel,
        unit: currentLesson.unit,
        description: currentLesson.description,
        isSystem: currentLesson.isSystem,
        ownerId: currentLesson.ownerId,
        vocabCount: currentLesson.vocabulary.length,
        grammarCount: currentLesson.grammar.length,
        textCount: currentLesson.texts.length,
        testCount: currentLesson.comprehensiveTest.length,
      },
    ] as LessonSummary[];
  }, [lessons, currentLesson]);

  const selectedLessons = useMemo(
    () => availableLessons.filter((l) => selectedLessonIds.includes(l.id)),
    [availableLessons, selectedLessonIds]
  );

  const filteredPickerLessons = useMemo(() => {
    const q = lessonSearch.trim().toLowerCase();
    if (!q) return availableLessons;
    return availableLessons.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        l.hskLevel.toLowerCase().includes(q) ||
        (l.unit || '').toLowerCase().includes(q)
    );
  }, [availableLessons, lessonSearch]);

  const allFilteredSelected =
    filteredPickerLessons.length > 0 &&
    filteredPickerLessons.every((l) => selectedLessonIds.includes(l.id));
  const someFilteredSelected =
    filteredPickerLessons.some((l) => selectedLessonIds.includes(l.id)) && !allFilteredSelected;

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = someFilteredSelected;
    }
  }, [someFilteredSelected, showLessonPicker]);

  const toggleAttachedLesson = (lessonId: string) => {
    setSelectedLessonIds((prev) =>
      prev.includes(lessonId) ? prev.filter((id) => id !== lessonId) : [...prev, lessonId]
    );
  };

  const toggleSelectAllFiltered = () => {
    const visibleIds = filteredPickerLessons.map((l) => l.id);
    if (visibleIds.length === 0) return;
    if (allFilteredSelected) {
      const visibleSet = new Set(visibleIds);
      setSelectedLessonIds((prev) => prev.filter((id) => !visibleSet.has(id)));
    } else {
      setSelectedLessonIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const sendChatMessage = async (rawPrompt?: string) => {
    const text = (rawPrompt ?? chatInput).trim();
    if (!text || chatLoading) return;
    setChatError(null);

    const nextUserMsg: AiChatMessage = { role: 'user', content: text };
    const nextHistory = [...chatMessages, nextUserMsg];
    setChatMessages(nextHistory);
    if (!rawPrompt) setChatInput('');
    setChatLoading(true);

    try {
      const res = await api.aiChat({
        message: text,
        history: chatMessages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        lessonIds: selectedLessonIds,
      });
      setChatMessages([
        ...nextHistory,
        {
          role: 'assistant',
          content: res.reply,
          toolExecutions: res.toolExecutions,
          pendingActions: res.pendingActions,
        },
      ]);
      if (res.effects?.progressUpdated) {
        await onProgressChanged?.();
      }
    } catch (err) {
      setChatError((err as Error).message || 'Gia sư AI không phản hồi được.');
    } finally {
      setChatLoading(false);
    }
  };

  const handleConfirmLessonAction = async (
    action: Extract<AiPendingAction, { type: 'create_lesson' | 'update_lesson' }>
  ) => {
    setActionStates((prev) => ({ ...prev, [action.id]: { status: 'saving' } }));
    try {
      const payload = {
        title: action.title,
        hskLevel: action.hskLevel,
        unit: action.unit,
        description: action.description,
        vocabulary: action.vocabulary,
        grammar: action.grammar,
        isSystem: action.isSystem,
      };
      const res =
        action.type === 'create_lesson'
          ? await api.createLesson(payload)
          : await api.updateLesson(action.lessonId, payload);

      setActionStates((prev) => ({
        ...prev,
        [action.id]: { status: 'done', savedLessonId: res.lesson.id },
      }));
      await onLessonsChanged?.(res.lesson.id);
    } catch (err) {
      setActionStates((prev) => ({
        ...prev,
        [action.id]: {
          status: 'error',
          error: (err as Error).message || 'Không lưu được buổi học.',
        },
      }));
    }
  };

  const quickPrompts = useMemo(() => {
    if (selectedLessons.length === 1) {
      const target = selectedLessons[0];
      return [
        `Giải thích các điểm ngữ pháp trọng tâm trong ${target.title}`,
        `Tạo đề kiểm tra ôn tập 20 câu cho ${target.title}`,
        `Tạo 1 đoạn hội thoại ngắn (4 câu) dùng từ vựng của ${target.title}`,
        `Đánh dấu giúp mình 5 từ quan trọng nhất trong ${target.title}`,
      ];
    }
    if (selectedLessons.length > 1) {
      return [
        `Tổng hợp và so sánh ngữ pháp chính trong ${selectedLessons.length} bài đã chọn`,
        `Tạo đề kiểm tra ôn tập 25 câu tổng hợp từ ${selectedLessons.length} bài đã chọn`,
        `Tạo 1 đoạn hội thoại ngắn kết hợp từ vựng từ các bài đã chọn`,
        `Kiểm tra tiến độ thi của mình ở các bài này và gợi ý phần cần ôn`,
      ];
    }
    return [
      'Xem tiến độ thi & tạo đề kiểm tra ôn tập 20 câu từ các bài mình cần ôn lại',
      'Tạo giúp mình 1 bài tự tạo chủ đề Đi ăn nhà hàng (HSK 2, 6 từ vựng)',
      'Tìm và đánh dấu các từ có nghĩa liên quan đến "thời gian" để ôn tập',
      'Phân biệt 有点儿 (yǒudiǎnr) và 一点儿 (yīdiǎnr)',
    ];
  }, [selectedLessons]);

  const aiHanziChars = useMemo(
    () => (dictResult?.aiResult?.hanzi ? extractHanziChars(dictResult.aiResult.hanzi) : []),
    [dictResult]
  );

  return (
    <ModalShell onClose={onClose} maxWidthClass="max-w-4xl" flexColumn>
      {/* Modal Header */}
      <div className="p-5 bg-stone-50 dark:bg-slate-800/60 border-b border-stone-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-red-600 to-amber-600 text-white flex items-center justify-center shadow-md">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Từ điển &amp; Trợ lý AI Tiếng Trung
            </h3>
            <p className="text-xs text-gray-500 dark:text-slate-400">
              Tra từ vựng Trung ⇄ Việt, dịch câu, luyện hội thoại &amp; giải thích ngữ pháp HSK.
            </p>
          </div>
        </div>
        <ModalCloseButton onClick={onClose} />
      </div>

      {/* Sub Tabs */}
      <div className="px-6 py-2.5 bg-stone-100/80 dark:bg-slate-950/60 border-b border-stone-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('dictionary')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition ${
              activeTab === 'dictionary'
                ? 'bg-red-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 border border-stone-200 dark:border-slate-700 hover:bg-stone-50 dark:hover:bg-slate-700'
            }`}
          >
            <Languages className="w-3.5 h-3.5" /> Từ điển &amp; Dịch Trung ⇄ Việt
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition ${
              activeTab === 'chat'
                ? 'bg-red-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 border border-stone-200 dark:border-slate-700 hover:bg-stone-50 dark:hover:bg-slate-700'
            }`}
          >
            <Bot className="w-3.5 h-3.5" /> Gia sư AI hỏi đáp
          </button>
        </div>

        {activeTab === 'chat' && chatMessages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setChatMessages([]);
              setChatError(null);
            }}
            className="text-[11px] font-semibold text-gray-500 dark:text-slate-400 hover:text-red-600 inline-flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" /> Xoá cuộc trò chuyện
          </button>
        )}
      </div>

      {/* Body */}
      {activeTab === 'dictionary' ? (
        <div className="p-6 overflow-y-auto space-y-5 flex-grow">
          {/* Search Box */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <textarea
                rows={2}
                value={dictQuery}
                onChange={(e) => setDictQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void runDictionaryLookup(dictQuery, false);
                  }
                }}
                placeholder="Nhập chữ Hán (vd: 笔记本), Pinyin (bǐjìběn), từ tiếng Việt hoặc cả câu cần dịch... (Enter để tra)"
                className="flex-1 p-3 rounded-2xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-red-500/40"
              />
              <button
                type="button"
                disabled={dictLoading || !dictQuery.trim()}
                onClick={() => void runDictionaryLookup(dictQuery, false)}
                className="px-5 py-3 rounded-2xl bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-bold inline-flex items-center justify-center gap-2 shadow-sm flex-shrink-0"
              >
                {dictLoading ? <LoadingSpinner size="sm" /> : <Languages className="w-4 h-4" />}
                <span>{dictLoading ? 'Đang tra...' : 'Tra / Dịch'}</span>
              </button>
            </div>

            {dictHistory.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-gray-400 dark:text-slate-500 inline-flex items-center gap-1 mr-1">
                  <History className="w-3 h-3" /> Gần đây:
                </span>
                {dictHistory.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setDictQuery(item);
                      void runDictionaryLookup(item, false);
                    }}
                    className="px-2.5 py-0.5 rounded-full bg-stone-100 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-900/30 text-[11px] text-gray-700 dark:text-slate-300 border border-stone-200 dark:border-slate-700 transition"
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>

          <ErrorBanner message={dictError} />

          {dictResult?.notice && (
            <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-200">
              {dictResult.notice}
            </div>
          )}

          {dictResult && dictResult.localHits.length === 0 && !dictResult.aiResult && !dictLoading && (
            <div className="p-6 rounded-2xl border border-dashed border-stone-200 dark:border-slate-800 text-center text-xs text-gray-500 dark:text-slate-400">
              Không tìm thấy “<strong>{dictResult.query}</strong>” trong giáo trình HSK hiện có.
            </div>
          )}

          {!dictResult && !dictLoading && (
            <div className="p-8 rounded-2xl border border-dashed border-stone-200 dark:border-slate-800 text-center space-y-2 text-xs text-gray-500 dark:text-slate-400">
              <p className="font-semibold text-gray-700 dark:text-slate-300">
                Tra từ điển song ngữ Trung ⇄ Việt kết hợp giáo trình HSK &amp; AI
              </p>
              <p>
                Ưu tiên trả ngay từ có sẵn trong 26 bài HSK; các từ/câu mới được AI phân tích chi tiết (Pinyin, Âm Hán Việt, Bộ thủ, Ví dụ).
              </p>
            </div>
          )}

          {/* Local HSK hits */}
          {dictResult && dictResult.localHits.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
                  Khớp trong giáo trình HSK / Bài của bạn ({dictResult.localHits.length})
                </h4>
                {dictResult.source === 'local_exact' && dictResult.aiConfigured && (
                  <button
                    type="button"
                    disabled={dictLoading}
                    onClick={() => void runDictionaryLookup(dictResult.query, true)}
                    className="px-3 py-1 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-[11px] font-bold hover:bg-amber-100 dark:hover:bg-amber-900/50 inline-flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3" /> Phân tích mở rộng &amp; ví dụ bằng AI
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {dictResult.localHits.slice(0, 6).map((hit) => (
                  <div
                    key={hit.id}
                    className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200 dark:border-slate-800 flex items-start justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="chinese-serif text-lg font-black text-gray-900 dark:text-white">
                          {hit.hanzi}
                        </span>
                        <span className="text-xs font-mono text-red-600 dark:text-red-400 font-semibold">
                          {hit.pinyin}
                        </span>
                        {hit.sinoVietnamese && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 font-bold uppercase">
                            {hit.sinoVietnamese}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-medium text-gray-800 dark:text-slate-200">
                        {hit.meaning}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-slate-400 truncate">
                        {hit.hskLevel} • {hit.lessonTitle}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => speakChinese(hit.hanzi)}
                        className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:text-red-600"
                        title="Nghe phát âm"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenWriter(hit)}
                        className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:text-red-600"
                        title="Tập viết chữ Hán"
                      >
                        <PenTool className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onJumpToLesson(hit.lessonId);
                          onClose();
                        }}
                        className="p-1.5 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 hover:bg-red-100"
                        title="Mở bài học"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI / Cache Structured Dictionary Result */}
          {dictResult?.aiResult && (
            <div className="rounded-3xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-gradient-to-r from-red-50 to-amber-50/70 dark:from-red-950/30 dark:to-amber-950/20 border-b border-stone-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-gray-800 dark:text-slate-200">
                  <Sparkles className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                  <span>Từ điển AI</span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopy(
                        `${dictResult.aiResult!.hanzi} (${dictResult.aiResult!.pinyin}) - ${dictResult.aiResult!.meaning}`,
                        'main'
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-stone-200 dark:border-slate-700 text-[11px] font-semibold text-gray-700 dark:text-slate-200 inline-flex items-center gap-1"
                  >
                    {copiedKey === 'main' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" /> Đã chép
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" /> Chép nhanh
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('chat');
                      void sendChatMessage(
                        `Hãy giải thích kỹ hơn về cách dùng và ví dụ của "${dictResult.aiResult!.hanzi}" (${dictResult.aiResult!.meaning})`
                      );
                    }}
                    className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold inline-flex items-center gap-1"
                  >
                    <MessageSquare className="w-3 h-3" /> Hỏi sâu Gia sư AI
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-4">
                {/* Main Headword */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="chinese-serif text-3xl font-black text-gray-900 dark:text-white">
                        {dictResult.aiResult.hanzi}
                      </span>
                      {dictResult.aiResult.pinyin && (
                        <span className="text-sm font-mono font-bold text-red-600 dark:text-red-400">
                          {dictResult.aiResult.pinyin}
                        </span>
                      )}
                      {dictResult.aiResult.sinoVietnamese && (
                        <span className="px-2.5 py-0.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-xs font-bold uppercase">
                          Hán Việt: {dictResult.aiResult.sinoVietnamese}
                        </span>
                      )}
                      {dictResult.aiResult.wordType && (
                        <span className="px-2.5 py-0.5 rounded-lg bg-stone-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 text-[11px] font-semibold">
                          {dictResult.aiResult.wordType}
                        </span>
                      )}
                    </div>
                    <p className="text-base font-bold text-gray-900 dark:text-white">
                      {dictResult.aiResult.meaning}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => speakChinese(dictResult.aiResult!.hanzi)}
                    className="px-3.5 py-2 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-bold inline-flex items-center gap-1.5 self-start hover:bg-red-100"
                  >
                    <Volume2 className="w-4 h-4" /> Nghe phát âm
                  </button>
                </div>

                {/* Extra meanings */}
                {dictResult.aiResult.meanings.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {dictResult.aiResult.meanings.map((m, idx) => (
                      <span
                        key={`${m}-${idx}`}
                        className="px-2.5 py-1 rounded-xl bg-stone-100 dark:bg-slate-800 text-xs text-gray-700 dark:text-slate-300"
                      >
                        {idx + 1}. {m}
                      </span>
                    ))}
                  </div>
                )}

                {/* Radical / Breakdown / Mnemonic / Grammar */}
                {(dictResult.aiResult.radical ||
                  dictResult.aiResult.breakdown ||
                  dictResult.aiResult.mnemonic ||
                  dictResult.aiResult.grammarNote) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    {dictResult.aiResult.radical && (
                      <div className="p-3 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
                        <span className="font-bold text-gray-500 dark:text-slate-400 block mb-0.5">
                          Bộ thủ
                        </span>
                        <span className="text-gray-900 dark:text-white font-semibold">
                          {dictResult.aiResult.radical}
                        </span>
                      </div>
                    )}
                    {dictResult.aiResult.breakdown && (
                      <div className="p-3 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
                        <span className="font-bold text-gray-500 dark:text-slate-400 block mb-0.5">
                          Chiết tự
                        </span>
                        <span className="text-gray-900 dark:text-white">
                          {dictResult.aiResult.breakdown}
                        </span>
                      </div>
                    )}
                    {dictResult.aiResult.mnemonic && (
                      <div className="p-3 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800 md:col-span-2">
                        <span className="font-bold text-gray-500 dark:text-slate-400 block mb-0.5">
                          Mẹo ghi nhớ
                        </span>
                        <span className="text-gray-800 dark:text-slate-200">
                          {dictResult.aiResult.mnemonic}
                        </span>
                      </div>
                    )}
                    {dictResult.aiResult.grammarNote && (
                      <div className="p-3 rounded-2xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/70 dark:border-blue-900/50 md:col-span-2">
                        <span className="font-bold text-blue-700 dark:text-blue-300 block mb-0.5">
                          Cách dùng &amp; Ngữ pháp
                        </span>
                        <span className="text-gray-800 dark:text-slate-200">
                          {dictResult.aiResult.grammarNote}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* HanziWriter quick buttons */}
                {aiHanziChars.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <span className="text-[11px] font-bold text-gray-500 dark:text-slate-400 inline-flex items-center gap-1">
                      <PenTool className="w-3.5 h-3.5" /> Tập viết từng chữ:
                    </span>
                    {aiHanziChars.map((ch) => (
                      <button
                        key={ch}
                        type="button"
                        onClick={() =>
                          onOpenWriter({
                            id: `ai_${ch}`,
                            hanzi: ch,
                            pinyin: dictResult.aiResult!.pinyin || '',
                            meaning: dictResult.aiResult!.meaning,
                          })
                        }
                        className="chinese-serif px-3 py-1 rounded-xl bg-stone-100 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-900/30 border border-stone-200 dark:border-slate-700 text-base font-bold text-gray-900 dark:text-white transition"
                      >
                        {ch}
                      </button>
                    ))}
                  </div>
                )}

                {/* Examples */}
                {dictResult.aiResult.examples.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <h5 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                      Câu ví dụ song ngữ
                    </h5>
                    <div className="space-y-2">
                      {dictResult.aiResult.examples.map((ex, idx) => (
                        <div
                          key={`${ex.hanzi}-${idx}`}
                          className="p-3 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800 flex items-start justify-between gap-3"
                        >
                          <div className="space-y-0.5">
                            <p className="chinese-serif text-sm font-bold text-gray-900 dark:text-white">
                              {ex.hanzi}
                            </p>
                            {ex.pinyin && (
                              <p className="text-xs font-mono text-red-600 dark:text-red-400">
                                {ex.pinyin}
                              </p>
                            )}
                            <p className="text-xs text-gray-600 dark:text-slate-300">{ex.meaning}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => speakChinese(ex.hanzi)}
                            className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 text-gray-500 hover:text-red-600 flex-shrink-0"
                            title="Nghe câu ví dụ"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Tab 2: Gia sư AI HSK */
        <div className="flex flex-col flex-grow min-h-[420px] max-h-[70vh]">
          <div className="px-5 py-2.5 bg-stone-50 dark:bg-slate-800/40 border-b border-stone-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="font-semibold text-gray-600 dark:text-slate-300 inline-flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5 text-red-500" />
                  Ngữ cảnh bài học:
                </span>
                {selectedLessons.length === 0 ? (
                  <span className="text-[11px] text-gray-500 dark:text-slate-400">
                    Không đính kèm bài nào (hỏi đáp tự do)
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-[11px] font-bold">
                    Đã chọn {selectedLessons.length}/{availableLessons.length} bài
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {currentLesson && !selectedLessonIds.includes(currentLesson.id) && (
                  <button
                    type="button"
                    onClick={() => toggleAttachedLesson(currentLesson.id)}
                    className="px-2.5 py-1 rounded-lg border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-red-400 text-[11px] font-semibold text-gray-700 dark:text-slate-200"
                  >
                    + Bài đang mở
                  </button>
                )}
                {selectedLessonIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedLessonIds([])}
                    className="px-2.5 py-1 rounded-lg border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:text-red-600 text-[11px] font-semibold text-gray-600 dark:text-slate-300"
                  >
                    Bỏ chọn hết
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowLessonPicker((s) => !s)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 border transition ${
                    showLessonPicker
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-white dark:bg-slate-800 border-stone-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:border-red-400'
                  }`}
                >
                  <Plus className="w-3 h-3" />
                  {showLessonPicker ? 'Đóng chọn bài' : 'Chọn bài đính kèm'}
                </button>
              </div>
            </div>

            {selectedLessons.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap max-h-20 overflow-y-auto">
                {selectedLessons.length === availableLessons.length && availableLessons.length > 3 ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800/70 text-[11px] font-semibold text-gray-800 dark:text-slate-200">
                    <span>Tất cả buổi học ({selectedLessons.length} bài)</span>
                    <button
                      type="button"
                      onClick={() => setSelectedLessonIds([])}
                      className="text-gray-400 hover:text-red-600"
                      title="Bỏ chọn tất cả"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ) : (
                  selectedLessons.map((lesson) => (
                    <span
                      key={lesson.id}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800/70 text-[11px] font-semibold text-gray-800 dark:text-slate-200"
                    >
                      <span className="max-w-[200px] truncate">{lesson.title}</span>
                      <button
                        type="button"
                        onClick={() => toggleAttachedLesson(lesson.id)}
                        className="text-gray-400 hover:text-red-600"
                        title="Gỡ bài học này"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))
                )}
              </div>
            )}

            {showLessonPicker && (
              <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 shadow-lg space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={lessonSearch}
                      onChange={(e) => setLessonSearch(e.target.value)}
                      placeholder="Tìm buổi học để đính kèm..."
                      className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 text-xs text-gray-900 dark:text-white focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowLessonPicker(false)}
                    className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold"
                  >
                    Xong
                  </button>
                </div>

                {filteredPickerLessons.length > 0 && (
                  <label className="px-2 py-1.5 rounded-lg bg-stone-50 dark:bg-slate-800/70 border border-stone-200/80 dark:border-slate-700/80 flex items-center justify-between gap-2 text-xs cursor-pointer select-none">
                    <div className="flex items-center gap-2">
                      <input
                        ref={selectAllCheckboxRef}
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAllFiltered}
                        className="rounded border-stone-300 dark:border-slate-600 text-red-600 focus:ring-red-500"
                      />
                      <span className="font-bold text-gray-800 dark:text-slate-100">
                        {lessonSearch.trim() ? 'Chọn tất cả kết quả đang lọc' : 'Chọn tất cả buổi học'}
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-gray-500 dark:text-slate-400">
                      {filteredPickerLessons.length} bài
                    </span>
                  </label>
                )}

                <div className="max-h-44 overflow-y-auto divide-y divide-stone-100 dark:divide-slate-800">
                  {filteredPickerLessons.length === 0 ? (
                    <p className="py-4 text-center text-[11px] text-gray-400 dark:text-slate-500">
                      Không tìm thấy buổi học phù hợp.
                    </p>
                  ) : (
                    filteredPickerLessons.map((lesson) => {
                      const checked = selectedLessonIds.includes(lesson.id);
                      return (
                        <label
                          key={lesson.id}
                          className="py-2 px-2 flex items-center justify-between gap-2 text-xs rounded-lg cursor-pointer hover:bg-stone-50 dark:hover:bg-slate-800/60"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleAttachedLesson(lesson.id)}
                              className="rounded border-stone-300 dark:border-slate-600 text-red-600 focus:ring-red-500"
                            />
                            <span className="font-semibold text-gray-800 dark:text-slate-200 truncate">
                              {lesson.title}
                            </span>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-stone-100 dark:bg-slate-800 text-[10px] font-bold text-gray-500 dark:text-slate-400 flex-shrink-0">
                            {lesson.hskLevel}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex-grow overflow-y-auto p-5 space-y-4">
            {chatMessages.length === 0 ? (
              <div className="space-y-4 py-4">
                <div className="p-4 rounded-2xl bg-gradient-to-br from-red-50 to-amber-50/70 dark:from-red-950/30 dark:to-amber-950/20 border border-red-200/70 dark:border-red-900/50 text-xs text-gray-800 dark:text-slate-200 space-y-1">
                  <p className="font-bold text-red-700 dark:text-red-300 flex items-center gap-1.5">
                    <Bot className="w-4 h-4" /> Xin chào! Mình là Gia sư tiếng Trung AI.
                  </p>
                  <p>
                    Ngoài dịch và giải đáp ngữ pháp HSK, bạn có thể nhờ AI xem tiến độ điểm thi, đánh dấu từ vựng cần ôn tập, tạo đề kiểm tra tổng hợp theo bài học, hoặc tạo/cập nhật buổi học mới.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500">
                    Gợi ý câu hỏi nhanh
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {quickPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        disabled={chatLoading}
                        onClick={() => void sendChatMessage(prompt)}
                        className="p-3 rounded-2xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 hover:border-red-400 dark:hover:border-red-600 text-left text-xs font-medium text-gray-700 dark:text-slate-200 transition"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              chatMessages.map((msg, idx) => {
                const snippets = msg.role === 'assistant' ? extractChineseSnippets(msg.content) : [];
                return (
                  <div
                    key={idx}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[90%] rounded-2xl px-4 py-3 text-xs space-y-2.5 ${
                        msg.role === 'user'
                          ? 'bg-red-600 text-white shadow-sm whitespace-pre-wrap leading-relaxed'
                          : 'bg-white dark:bg-slate-800/90 text-gray-900 dark:text-slate-100 border border-stone-200 dark:border-slate-700 shadow-sm'
                      }`}
                    >
                      {msg.toolExecutions && msg.toolExecutions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pb-2 border-b border-stone-200/80 dark:border-slate-700">
                          {msg.toolExecutions.map((exec, tIdx) => (
                            <span
                              key={`${exec.name}-${tIdx}`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100/80 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold"
                            >
                              <Check className="w-3 h-3" /> {exec.summary}
                            </span>
                          ))}
                        </div>
                      )}

                      {msg.role === 'user' ? (
                        <div>{msg.content}</div>
                      ) : (
                        <ChatMarkdown content={msg.content} />
                      )}

                      {msg.pendingActions && msg.pendingActions.length > 0 && (
                        <div className="space-y-2 pt-1">
                          {msg.pendingActions.map((act) => {
                            if (act.type === 'navigate') {
                              return (
                                <button
                                  key={act.id}
                                  type="button"
                                  onClick={() => {
                                    if (act.view === 'study' && act.lessonId) {
                                      onJumpToLesson(act.lessonId, act.tab || 'vocab');
                                    } else {
                                      onNavigateView?.(act.view);
                                    }
                                    onClose();
                                  }}
                                  className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold inline-flex items-center gap-1.5 shadow-sm"
                                >
                                  <ArrowRight className="w-3.5 h-3.5" /> {act.label}
                                </button>
                              );
                            }

                            if (act.type === 'start_review_exam') {
                              return (
                                <div
                                  key={act.id}
                                  className="p-3.5 rounded-2xl bg-gradient-to-br from-red-50 to-amber-50 dark:from-red-950/30 dark:to-amber-950/20 border border-red-200 dark:border-red-900/50 space-y-2.5 text-left"
                                >
                                  <div className="flex items-start justify-between gap-2 flex-wrap">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-1.5 text-xs font-bold text-red-700 dark:text-red-300">
                                        <GraduationCap className="w-4 h-4 flex-shrink-0" />
                                        <span>{act.title}</span>
                                      </div>
                                      <p className="text-[11px] text-gray-600 dark:text-slate-300">
                                        {act.description}
                                      </p>
                                    </div>
                                    <span className="px-2 py-0.5 rounded-full bg-white/90 dark:bg-slate-900/80 border border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-300 text-[10px] font-bold">
                                      {act.questions.length} câu • {act.lessonIds.length} bài
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onStartReviewExam?.(
                                        {
                                          id: act.id,
                                          title: act.title,
                                          hskLevel: 'HSK 1 - HSK 3',
                                          description: act.description,
                                          questions: act.questions,
                                        },
                                        act.lessonIds
                                      );
                                      onClose();
                                    }}
                                    className="px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold inline-flex items-center gap-1.5 shadow-sm transition"
                                  >
                                    <ArrowRight className="w-3.5 h-3.5" /> Làm bài kiểm tra ngay
                                  </button>
                                </div>
                              );
                            }

                            const state = actionStates[act.id];
                            const isDone = state?.status === 'done';
                            const isDismissed = state?.status === 'dismissed';
                            const isSaving = state?.status === 'saving';

                            return (
                              <div
                                key={act.id}
                                className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 space-y-2.5 text-left"
                              >
                                <div className="flex items-start justify-between gap-2 flex-wrap">
                                  <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-bold text-xs text-gray-900 dark:text-white">
                                        {act.type === 'create_lesson'
                                          ? 'Đề xuất tạo buổi học mới'
                                          : 'Đề xuất cập nhật buổi học'}
                                        : {act.title}
                                      </span>
                                      <span className="px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-[10px] font-bold">
                                        {act.hskLevel}
                                      </span>
                                      <span
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                          act.isSystem
                                            ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300'
                                            : 'bg-stone-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300'
                                        }`}
                                      >
                                        {act.isSystem ? 'Bài hệ thống' : 'Bài tự tạo'}
                                      </span>
                                    </div>
                                    {act.description && (
                                      <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
                                        {act.description}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                <div className="max-h-36 overflow-y-auto rounded-xl border border-stone-100 dark:border-slate-800 divide-y divide-stone-100 dark:divide-slate-800">
                                  {act.vocabulary.map((v, vIdx) => (
                                    <div
                                      key={`${v.hanzi}-${vIdx}`}
                                      className="px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]"
                                    >
                                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                        <span className="chinese-serif font-bold text-gray-900 dark:text-white">
                                          {v.hanzi}
                                        </span>
                                        <span className="font-mono text-red-600 dark:text-red-400">
                                          {v.pinyin}
                                        </span>
                                        <span className="text-gray-600 dark:text-slate-300">
                                          {v.meaning}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>

                                {act.grammar.length > 0 && (
                                  <p className="text-[11px] text-gray-500 dark:text-slate-400">
                                    Kèm {act.grammar.length} điểm ngữ pháp:{' '}
                                    {act.grammar.map((g) => g.title).join(', ')}
                                  </p>
                                )}

                                {state?.error && (
                                  <p className="text-[11px] font-semibold text-red-600 dark:text-red-400">
                                    {state.error}
                                  </p>
                                )}

                                <div className="flex items-center gap-2 flex-wrap pt-0.5">
                                  {isDone ? (
                                    <>
                                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                                        <Check className="w-3.5 h-3.5" /> Đã lưu buổi học thành công
                                      </span>
                                      {state?.savedLessonId && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            onJumpToLesson(state.savedLessonId!, 'vocab');
                                            onClose();
                                          }}
                                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold inline-flex items-center gap-1"
                                        >
                                          Mở bài vừa lưu <ArrowRight className="w-3 h-3" />
                                        </button>
                                      )}
                                    </>
                                  ) : isDismissed ? (
                                    <span className="text-[11px] text-gray-400 dark:text-slate-500">
                                      Đã bỏ qua đề xuất này.
                                    </span>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        disabled={isSaving}
                                        onClick={() => void handleConfirmLessonAction(act)}
                                        className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-[11px] font-bold inline-flex items-center gap-1.5 shadow-sm"
                                      >
                                        {isSaving ? <LoadingSpinner size="sm" /> : <Check className="w-3.5 h-3.5" />}
                                        {isSaving
                                          ? 'Đang lưu...'
                                          : act.type === 'create_lesson'
                                          ? 'Xác nhận tạo bài'
                                          : 'Xác nhận cập nhật'}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isSaving}
                                        onClick={() =>
                                          setActionStates((prev) => ({
                                            ...prev,
                                            [act.id]: { status: 'dismissed' },
                                          }))
                                        }
                                        className="px-3 py-1.5 rounded-xl border border-stone-200 dark:border-slate-700 text-[11px] font-semibold text-gray-600 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-800"
                                      >
                                        Bỏ qua
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {snippets.length > 0 && (
                        <div className="mt-2.5 pt-2 border-t border-stone-200/80 dark:border-slate-700 flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-bold text-gray-500 dark:text-slate-400">
                            Nghe câu:
                          </span>
                          {snippets.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => speakChinese(s)}
                              className="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-600 text-[11px] font-semibold text-gray-700 dark:text-slate-200 hover:text-red-600 inline-flex items-center gap-1"
                            >
                              <Volume2 className="w-3 h-3 text-red-500" />
                              <span className="chinese-serif max-w-[140px] truncate">{s}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {chatLoading && (
              <div className="flex justify-start">
                <div className="px-4 py-3 rounded-2xl bg-stone-100 dark:bg-slate-800 border border-stone-200 dark:border-slate-700 inline-flex items-center gap-2 text-xs text-gray-600 dark:text-slate-300">
                  <LoadingSpinner size="sm" /> Gia sư AI đang soạn câu trả lời...
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          <div className="px-5 pt-2">
            <ErrorBanner message={chatError} />
          </div>

          <div className="p-4 border-t border-stone-200 dark:border-slate-800 bg-stone-50/70 dark:bg-slate-900/90 flex gap-2 items-end">
            <textarea
              rows={2}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendChatMessage();
                }
              }}
              placeholder="Hỏi ngữ pháp, cách đặt câu, hoặc nhờ luyện hội thoại... (Enter để gửi, Shift+Enter xuống dòng)"
              className="flex-1 p-3 rounded-2xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-gray-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-red-500/40"
            />
            <button
              type="button"
              disabled={chatLoading || !chatInput.trim()}
              onClick={() => void sendChatMessage()}
              className="px-4 py-3 rounded-2xl bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
            >
              <Send className="w-4 h-4" /> Gửi
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
};
