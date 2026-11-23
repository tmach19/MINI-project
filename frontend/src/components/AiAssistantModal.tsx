import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  Copy,
  GraduationCap,
  History,
  Languages,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  PenTool,
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
import { LoadingCard, LoadingSpinner } from './common/LoadingState';
import { ErrorBanner, ModalCloseButton, ModalShell } from './common/ModalShell';

interface AiAssistantModalProps {
  userId?: string | null;
  initialTab?: 'dictionary' | 'chat';
  initialQuery?: string;
  currentLesson?: LessonDetail | null;
  lessons?: LessonSummary[];
  onClose: () => void;
  onJumpToLesson: (lessonId: string, tab?: TabId) => void;
  onNavigateView?: (
    view: 'dashboard' | 'study' | 'profile' | 'exam' | 'saved_vocab' | 'history'
  ) => void;
  onStartReviewExam?: (exam: ComprehensiveExamResponse, lessonIds: string[]) => void;
  onOpenWriter: (vocab: VocabularyItem) => void;
  onProgressChanged?: () => Promise<void> | void;
  onLessonsChanged?: (focusLessonId?: string) => Promise<void> | void;
}

interface AiChatSession {
  id: string;
  title: string;
  messages: AiChatMessage[];
  createdAt: string;
  updatedAt: string;
}

const HISTORY_STORAGE_KEY = 'cs_ai_dict_history';
const MAX_HISTORY_ITEMS = 12;
const MAX_CHAT_SESSIONS = 30;
const MAX_MESSAGES_PER_SESSION = 60;

function getChatSessionsKey(userScope: string): string {
  return `cs_ai_chat_sessions_v1_${userScope}`;
}

function getActiveSessionKey(userScope: string): string {
  return `cs_ai_chat_active_v1_${userScope}`;
}

function loadSavedSessions(userScope: string): AiChatSession[] {
  try {
    const raw = localStorage.getItem(getChatSessionsKey(userScope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is AiChatSession =>
        Boolean(s) &&
        typeof s.id === 'string' &&
        typeof s.title === 'string' &&
        Array.isArray(s.messages) &&
        s.messages.length > 0
    );
  } catch {
    return [];
  }
}

function saveSessionsToStorage(userScope: string, sessions: AiChatSession[]): void {
  try {
    localStorage.setItem(
      getChatSessionsKey(userScope),
      JSON.stringify(sessions.slice(0, MAX_CHAT_SESSIONS))
    );
  } catch {
    // Bỏ qua lỗi quota storage
  }
}

function loadActiveSessionId(userScope: string): string | null {
  try {
    return localStorage.getItem(getActiveSessionKey(userScope));
  } catch {
    return null;
  }
}

function saveActiveSessionId(userScope: string, sessionId: string | null): void {
  try {
    if (sessionId) localStorage.setItem(getActiveSessionKey(userScope), sessionId);
    else localStorage.removeItem(getActiveSessionKey(userScope));
  } catch {
    // Bỏ qua lỗi quota storage
  }
}

function deriveSessionTitle(messages: AiChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  const raw = (firstUser?.content || 'Cuộc trò chuyện mới').replace(/\s+/g, ' ').trim();
  return raw.length > 52 ? `${raw.slice(0, 52)}...` : raw;
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

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
  userId,
  initialTab = 'dictionary',
  initialQuery = '',
  onClose,
  onJumpToLesson,
  onNavigateView,
  onStartReviewExam,
  onOpenWriter,
  onProgressChanged,
  onLessonsChanged,
}) => {
  const userScope = userId || 'guest';
  const [activeTab, setActiveTab] = useState<'dictionary' | 'chat'>(initialTab);

  // Dictionary state
  const [dictQuery, setDictQuery] = useState(initialQuery);
  const [dictLoading, setDictLoading] = useState(false);
  const [dictLoadingQuery, setDictLoadingQuery] = useState<string | null>(null);
  const [dictError, setDictError] = useState<string | null>(null);
  const [dictResult, setDictResult] = useState<AiDictionaryResponse | null>(null);
  const [dictBackStack, setDictBackStack] = useState<
    Array<{ query: string; result: AiDictionaryResponse }>
  >([]);
  const [dictHistory, setDictHistory] = useState<string[]>(() => loadDictHistory());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const dictBodyRef = useRef<HTMLDivElement | null>(null);

  // Tutor chat state — tự động lưu & lịch sử các cuộc trò chuyện
  const [sessions, setSessions] = useState<AiChatSession[]>(() => loadSavedSessions(userScope));
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const saved = loadSavedSessions(userScope);
    const storedId = loadActiveSessionId(userScope);
    return storedId || saved[0]?.id || createSessionId();
  });
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<AiChatMessage[]>(() => {
    const saved = loadSavedSessions(userScope);
    const storedId = loadActiveSessionId(userScope);
    const targetId = storedId || saved[0]?.id;
    const found = targetId ? saved.find((s) => s.id === targetId) : undefined;
    return found ? found.messages : [];
  });
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
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

  useEffect(() => {
    if (initialQuery.trim()) {
      void runDictionaryLookup(initialQuery.trim(), false);
    }
  }, [initialQuery]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  const upsertSavedSession = (sessionId: string, messages: AiChatMessage[]) => {
    if (messages.length === 0) return;
    const nowIso = new Date().toISOString();
    const trimmedMessages = messages.slice(-MAX_MESSAGES_PER_SESSION);
    const title = deriveSessionTitle(trimmedMessages);
    setSessions((prev) => {
      const existing = prev.find((s) => s.id === sessionId);
      const updatedSession: AiChatSession = {
        id: sessionId,
        title,
        messages: trimmedMessages,
        createdAt: existing?.createdAt || nowIso,
        updatedAt: nowIso,
      };
      const next = [updatedSession, ...prev.filter((s) => s.id !== sessionId)].slice(
        0,
        MAX_CHAT_SESSIONS
      );
      saveSessionsToStorage(userScope, next);
      return next;
    });
    saveActiveSessionId(userScope, sessionId);
  };

  const handleNewChat = () => {
    const nextId = createSessionId();
    setActiveSessionId(nextId);
    setChatMessages([]);
    setChatError(null);
    setShowHistoryDrawer(false);
    saveActiveSessionId(userScope, nextId);
  };

  const handleSelectSession = (session: AiChatSession) => {
    setActiveSessionId(session.id);
    setChatMessages(session.messages);
    setChatError(null);
    setShowHistoryDrawer(false);
    saveActiveSessionId(userScope, session.id);
  };

  const handleDeleteSession = (sessionId: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      saveSessionsToStorage(userScope, next);
      return next;
    });
    if (sessionId === activeSessionId) {
      const freshId = createSessionId();
      setActiveSessionId(freshId);
      setChatMessages([]);
      setChatError(null);
      saveActiveSessionId(userScope, freshId);
    }
  };

  const handleClearAllSessions = () => {
    setSessions([]);
    saveSessionsToStorage(userScope, []);
    const freshId = createSessionId();
    setActiveSessionId(freshId);
    setChatMessages([]);
    setChatError(null);
    setShowHistoryDrawer(false);
    saveActiveSessionId(userScope, freshId);
  };

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
    const prevSnapshot =
      dictResult && dictResult.query.trim().toLowerCase() !== trimmed.toLowerCase()
        ? { query: dictResult.query, result: dictResult }
        : null;

    setDictError(null);
    setDictLoading(true);
    setDictLoadingQuery(trimmed);
    dictBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const res = await api.aiDictionary({ query: trimmed, direction: 'auto', forceAi });
      if (prevSnapshot) {
        setDictBackStack((prev) => [...prev.slice(-14), prevSnapshot]);
      }
      setDictResult(res);
      pushHistory(trimmed);
    } catch (err) {
      setDictError((err as Error).message || 'Không tra cứu được từ điển AI.');
    } finally {
      setDictLoading(false);
      setDictLoadingQuery(null);
    }
  };

  const handleDictGoBack = () => {
    if (dictLoading || dictBackStack.length === 0) return;
    const previous = dictBackStack[dictBackStack.length - 1];
    setDictBackStack((prev) => prev.slice(0, -1));
    setDictError(null);
    setDictQuery(previous.query);
    setDictResult(previous.result);
    dictBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
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

  const sendChatMessage = async (rawPrompt?: string) => {
    const text = (rawPrompt ?? chatInput).trim();
    if (!text || chatLoading) return;
    setChatError(null);
    setShowHistoryDrawer(false);

    const sessionId = activeSessionId;
    const priorMessages = chatMessages;
    const nextUserMsg: AiChatMessage = { role: 'user', content: text };
    const nextHistory = [...priorMessages, nextUserMsg];
    setChatMessages(nextHistory);
    upsertSavedSession(sessionId, nextHistory);
    if (!rawPrompt) setChatInput('');
    setChatLoading(true);

    try {
      const res = await api.aiChat({
        message: text,
        history: priorMessages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        lessonIds: [],
      });
      const completedMessages: AiChatMessage[] = [
        ...nextHistory,
        {
          role: 'assistant',
          content: res.reply,
          toolExecutions: res.toolExecutions,
          pendingActions: res.pendingActions,
        },
      ];
      setChatMessages(completedMessages);
      upsertSavedSession(sessionId, completedMessages);
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

  const quickPrompts = [
    'Xem tiến độ Dashboard, các kỹ năng yếu & gợi ý ôn tập cho mình',
    'Tổng hợp lịch sử làm bài kiểm tra của mình gần đây',
    'Tìm và đánh dấu các từ có nghĩa liên quan đến "thời gian" để ôn tập',
    'Phân biệt 有点儿 (yǒudiǎnr) và 一点儿 (yīdiǎnr)',
  ];

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

        {activeTab === 'chat' && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setShowHistoryDrawer((v) => !v)}
              className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold inline-flex items-center gap-1.5 transition ${
                showHistoryDrawer
                  ? 'bg-slate-900 dark:bg-slate-700 border-slate-900 dark:border-slate-600 text-white'
                  : 'bg-white dark:bg-slate-800 border-stone-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-stone-50 dark:hover:bg-slate-700'
              }`}
              title="Xem lịch sử các cuộc trò chuyện đã lưu"
            >
              <History className="w-3.5 h-3.5" />
              <span>Lịch sử ({sessions.length})</span>
            </button>

            <button
              type="button"
              onClick={handleNewChat}
              className="px-2.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold inline-flex items-center gap-1 shadow-sm transition"
              title="Bắt đầu cuộc trò chuyện mới"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              <span>Trò chuyện mới</span>
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      {activeTab === 'dictionary' ? (
        <div ref={dictBodyRef} className="p-6 overflow-y-auto space-y-5 flex-grow">
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

          {dictBackStack.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={dictLoading}
                onClick={handleDictGoBack}
                className="px-3 py-1.5 rounded-xl bg-stone-100 dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-900/30 border border-stone-200 dark:border-slate-700 hover:border-purple-400 dark:hover:border-purple-500/70 text-xs font-bold text-gray-700 dark:text-slate-200 hover:text-purple-700 dark:hover:text-purple-300 inline-flex items-center gap-1.5 disabled:opacity-40 transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>
                  Quay lại “
                  <span className="chinese-serif">
                    {dictBackStack[dictBackStack.length - 1].query}
                  </span>
                  ”
                </span>
              </button>
              {dictBackStack.length > 1 && (
                <span className="text-[11px] text-gray-400 dark:text-slate-500">
                  {dictBackStack.length} bước trước đó
                </span>
              )}
            </div>
          )}

          {dictLoading && (
            <LoadingCard
              compact
              message={`Đang tra cứu “${dictLoadingQuery || dictQuery}”...`}
              subMessage="Đang tải nghĩa, chiết tự, từ ghép phổ biến và ví dụ song ngữ"
            />
          )}

          {dictResult?.notice && !dictLoading && (
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
          {!dictLoading && dictResult && dictResult.localHits.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
                  Khớp trong giáo trình HSK / Bài của bạn ({dictResult.localHits.length})
                </h4>
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
          {!dictLoading && dictResult?.aiResult && (
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

                {/* Compounds (Từ ghép phổ biến) */}
                {dictResult.aiResult.compounds && dictResult.aiResult.compounds.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <h5 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                      Từ ghép phổ biến
                    </h5>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {dictResult.aiResult.compounds.map((comp, idx) => (
                        <div
                          key={`${comp.hanzi}-${idx}`}
                          className="p-2.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800 hover:border-purple-400 dark:hover:border-purple-500/70 flex items-center justify-between gap-2 transition group"
                        >
                          <button
                            type="button"
                            disabled={dictLoading}
                            onClick={() => {
                              setDictQuery(comp.hanzi);
                              void runDictionaryLookup(comp.hanzi, false);
                            }}
                            title={`Tra chi tiết từ "${comp.hanzi}"`}
                            className="text-left min-w-0 flex-1 disabled:opacity-60"
                          >
                            <div className="flex items-baseline gap-1.5 flex-wrap">
                              <span className="chinese-serif text-sm font-bold text-gray-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition">
                                {comp.hanzi}
                              </span>
                              {dictLoading && dictLoadingQuery === comp.hanzi && (
                                <Loader2 className="w-3 h-3 animate-spin text-purple-500" />
                              )}
                              {comp.pinyin && (
                                <span className="text-[11px] font-mono text-red-600 dark:text-red-400">
                                  {comp.pinyin}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-600 dark:text-slate-300 truncate">
                              {comp.meaning}
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => speakChinese(comp.hanzi)}
                            className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 text-gray-500 hover:text-red-600 flex-shrink-0"
                            title={`Nghe phát âm ${comp.hanzi}`}
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
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
          {showHistoryDrawer && (
            <div className="px-5 py-3 bg-stone-50 dark:bg-slate-800/60 border-b border-stone-200 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <History className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                  <span className="text-xs font-bold text-gray-900 dark:text-white">
                    Lịch sử các cuộc trò chuyện ({sessions.length})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {sessions.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAllSessions}
                      className="text-[11px] font-semibold text-gray-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 inline-flex items-center gap-1 transition"
                    >
                      <Trash2 className="w-3 h-3" /> Xoá tất cả
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowHistoryDrawer(false)}
                    aria-label="Đóng"
                    title="Đóng"
                    className="p-1 rounded-lg text-gray-500 dark:text-slate-400 hover:bg-stone-200/70 dark:hover:bg-slate-700 transition"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {sessions.length === 0 ? (
                <p className="py-3 text-center text-xs text-gray-500 dark:text-slate-400">
                  Chưa có cuộc trò chuyện nào được lưu.
                </p>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                  {sessions.map((session) => {
                    const isActive = session.id === activeSessionId;
                    return (
                      <div
                        key={session.id}
                        className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border transition ${
                          isActive
                            ? 'bg-red-50/80 dark:bg-red-950/30 border-red-300 dark:border-red-800'
                            : 'bg-white dark:bg-slate-900 border-stone-200 dark:border-slate-700 hover:border-red-300 dark:hover:border-red-700'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectSession(session)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                              {session.title}
                            </span>
                            {isActive && (
                              <span className="px-1.5 py-0.5 rounded-md bg-red-600 text-white text-[10px] font-bold shrink-0">
                                Đang mở
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 tabular-nums">
                            {session.messages.length} tin nhắn •{' '}
                            {new Date(session.updatedAt).toLocaleString('vi-VN')}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSession(session.id)}
                          aria-label="Xoá cuộc trò chuyện"
                          title="Xoá cuộc trò chuyện này"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 shrink-0 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

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
