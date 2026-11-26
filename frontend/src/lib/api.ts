import type {
  AdminUserRbacRow,
  AiChatMessage,
  AiDictionaryResponse,
  AiPendingAction,
  AiStatusResponse,
  AiToolExecutionSummary,
  ComprehensiveExamResponse,
  DashboardSummary,
  GameGradeDirection,
  GameGradeResponse,
  GameLeaderboardEntry,
  GameMode,
  GlobalVocabHit,
  LanguageCode,
  LanguageInfo,
  LessonAttemptDetailRecord,
  LessonDetail,
  LessonSummary,
  LessonTestSummaryRecord,
  MarkedVocabCard,
  MarkedVocabRecord,
  PermissionCatalogItem,
  QuickLookupResponse,
  RoleWithPermissions,
  TestAttemptRecord,
  TestLeaderboardEntry,
  TranslationDirection,
  UserProfile,
  VocabGlossaryItem,
} from '../types';

const ZH_API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, '');
const EN_API_BASE = (import.meta.env.VITE_EN_API_BASE || '/api-en').replace(/\/+$/, '');

let activeApiLanguage: LanguageCode = 'zh';

export function setActiveApiLanguage(lang: LanguageCode): void {
  activeApiLanguage = lang === 'en' ? 'en' : 'zh';
}

export function getActiveApiBase(langOverride?: LanguageCode): string {
  const effective = langOverride ?? activeApiLanguage;
  return effective === 'en' ? EN_API_BASE : ZH_API_BASE;
}

function getTokenStorageKey(langOverride?: LanguageCode): string {
  const effective = langOverride ?? activeApiLanguage;
  return effective === 'en' ? 'cs_auth_token_en' : 'cs_auth_token';
}

export function getStoredToken(langOverride?: LanguageCode): string | null {
  const effective = langOverride ?? activeApiLanguage;
  if (effective === 'en') {
    return localStorage.getItem('cs_auth_token_en') || localStorage.getItem('cs_auth_token');
  }
  return localStorage.getItem('cs_auth_token') || localStorage.getItem('cs_auth_token_en');
}

export function setStoredToken(
  token: string | null,
  langOverride?: LanguageCode,
  clearSharedOnLogout = false
): void {
  const key = getTokenStorageKey(langOverride);
  if (token) {
    // Đồng bộ SSO 2 chiều giữa `/` (Tiếng Trung) và `/en` (Tiếng Anh)
    localStorage.setItem('cs_auth_token', token);
    localStorage.setItem('cs_auth_token_en', token);
  } else {
    localStorage.removeItem(key);
    if (clearSharedOnLogout) {
      localStorage.removeItem('cs_auth_token');
      localStorage.removeItem('cs_auth_token_en');
    }
  }
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  langOverride?: LanguageCode
): Promise<T> {
  const token = getStoredToken(langOverride);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const base = getActiveApiBase(langOverride);
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    if (!res.ok) {
      throw new Error(`Lỗi API (${res.status})`);
    }
    throw new Error('Không kết nối được tới máy chủ API (máy chủ trả về dữ liệu không hợp lệ).');
  }
  const data = await res.json().catch(() => {
    throw new Error('Phản hồi từ máy chủ API không đúng định dạng JSON.');
  });
  if (!res.ok) {
    throw new Error(data.error || `Lỗi API (${res.status})`);
  }
  return data as T;
}

export const api = {
  health: () => apiFetch<{ ok: boolean; dbMode: 'postgres' | 'memory' }>('/health'),

  getLanguages: () =>
    apiFetch<{ languages: LanguageInfo[]; media: { enBaseUrl: string } }>('/languages', {}, 'en'),

  register: (payload: { email: string; password: string; displayName: string }) =>
    apiFetch<{ token: string; user: UserProfile }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { email: string; password: string }) =>
    apiFetch<{ token: string; user: UserProfile }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  me: () => apiFetch<{ user: UserProfile }>('/auth/me'),

  updateProfile: (payload: {
    displayName?: string;
    avatarUrl?: string | null;
    coverUrl?: string | null;
  }) =>
    apiFetch<{ user: UserProfile }>('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  listLessons: (lang?: LanguageCode) =>
    apiFetch<{ lessons: LessonSummary[]; languageCode?: LanguageCode }>(
      `/lessons${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`
    ),

  getLesson: (id: string) => apiFetch<{ lesson: LessonDetail }>(`/lessons/${encodeURIComponent(id)}`),

  createLesson: (payload: {
    languageCode?: LanguageCode;
    title: string;
    hskLevel: string;
    unit?: string;
    description?: string;
    vocabulary: any[];
    grammar: any[];
    isSystem?: boolean;
  }) =>
    apiFetch<{ lesson: LessonDetail }>('/lessons', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateLesson: (
    id: string,
    payload: {
      title: string;
      hskLevel: string;
      unit?: string;
      description?: string;
      vocabulary: any[];
      grammar: any[];
    }
  ) =>
    apiFetch<{ lesson: LessonDetail }>(`/lessons/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteLesson: (id: string) =>
    apiFetch<{ ok: boolean }>(`/lessons/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  searchVocab: (q: string, lang?: LanguageCode) =>
    apiFetch<{ items: GlobalVocabHit[] }>(
      `/vocab/search?q=${encodeURIComponent(q)}${lang ? `&lang=${encodeURIComponent(lang)}` : ''}`
    ),

  getVocabGlossary: (lang?: LanguageCode) =>
    apiFetch<{ items: VocabGlossaryItem[] }>(
      `/vocab/glossary${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`
    ),

  getProgress: (lang?: LanguageCode) =>
    apiFetch<{
      markedMap: Record<string, MarkedVocabRecord>;
      markedCount: number;
      markedCards: MarkedVocabCard[];
      attempts: TestAttemptRecord[];
    }>(`/progress${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`),

  getDashboard: (lessonId?: string, lang?: LanguageCode) => {
    const sp = new URLSearchParams();
    if (lessonId) sp.set('lessonId', lessonId);
    if (lang) sp.set('lang', lang);
    const qs = sp.toString();
    return apiFetch<{ dashboard: DashboardSummary }>(`/dashboard${qs ? `?${qs}` : ''}`);
  },

  getMarkedCards: (lang?: LanguageCode) =>
    apiFetch<{ cards: MarkedVocabCard[] }>(
      `/progress/marked${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`
    ),

  toggleMarkVocab: (payload: { vocabId: string; marked?: boolean; note?: string | null }) =>
    apiFetch<{ marked: boolean; record: MarkedVocabRecord | null }>('/progress/mark', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  syncMarkedVocab: (vocabIds: string[]) =>
    apiFetch<{ markedMap: Record<string, MarkedVocabRecord> }>('/progress/sync', {
      method: 'POST',
      body: JSON.stringify({ vocabIds }),
    }),

  getComprehensiveExam: (lessonIds?: string[], lang?: LanguageCode) => {
    const sp = new URLSearchParams();
    if (lessonIds && lessonIds.length > 0) sp.set('lessonIds', lessonIds.join(','));
    if (lang) sp.set('lang', lang);
    const qs = sp.toString();
    return apiFetch<{ exam: ComprehensiveExamResponse }>(
      `/tests/comprehensive-exam${qs ? `?${qs}` : ''}`
    );
  },

  getTestAttempts: (lang?: LanguageCode) =>
    apiFetch<{ attempts: TestAttemptRecord[] }>(
      `/tests/attempts${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`
    ),

  getLessonTestSummary: (lang?: LanguageCode) =>
    apiFetch<{ items: LessonTestSummaryRecord[] }>(
      `/tests/lesson-summary${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`
    ),

  getLessonAttemptDetails: (lessonId: string, lang?: LanguageCode) => {
    const sp = new URLSearchParams({ lessonId });
    if (lang) sp.set('lang', lang);
    return apiFetch<{ attempts: LessonAttemptDetailRecord[] }>(`/tests/attempts?${sp.toString()}`);
  },

  submitTestAttempt: (payload: {
    lessonId: string | null;
    languageCode?: LanguageCode;
    examTitle?: string | null;
    score: number;
    totalQuestions: number;
    correctCount: number;
    durationSeconds: number;
    answers: Record<string, number>;
  }) =>
    apiFetch<{ attempt: TestAttemptRecord }>('/tests/attempt', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getTestLeaderboard: (lessonId: string, limit = 30) =>
    apiFetch<{ entries: TestLeaderboardEntry[] }>(
      `/tests/leaderboard?lessonId=${encodeURIComponent(lessonId)}&limit=${limit}`
    ),

  getGameLeaderboard: (params: {
    lessonId?: string;
    gameMode?: GameMode;
    limit?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params.lessonId) sp.set('lessonId', params.lessonId);
    if (params.gameMode) sp.set('gameMode', params.gameMode);
    if (params.limit) sp.set('limit', String(params.limit));
    const qs = sp.toString();
    return apiFetch<{ entries: GameLeaderboardEntry[] }>(
      `/games/leaderboard${qs ? `?${qs}` : ''}`
    );
  },

  submitGameScore: (payload: {
    lessonId: string;
    gameMode: GameMode;
    score: number;
    maxScore?: number | null;
    durationSeconds: number;
  }) =>
    apiFetch<{ entry: GameLeaderboardEntry }>('/games/score', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getRbacCatalog: () =>
    apiFetch<{ permissions: PermissionCatalogItem[]; roles: RoleWithPermissions[] }>(
      '/admin/rbac/catalog'
    ),

  updateRolePermissions: (roleId: 'admin' | 'user', permissionIds: string[]) =>
    apiFetch<{ role: RoleWithPermissions }>(`/admin/roles/${roleId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissionIds }),
    }),

  listAdminUsers: (q = '') =>
    apiFetch<{ users: AdminUserRbacRow[] }>(
      `/admin/users${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`
    ),

  updateAdminUserRole: (userId: string, role: 'admin' | 'user') =>
    apiFetch<{ user: AdminUserRbacRow }>(`/admin/users/${encodeURIComponent(userId)}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),

  saveAdminUserPermissions: (
    userId: string,
    payload: { addedPermissions: string[]; excludedPermissions: string[] }
  ) =>
    apiFetch<{ user: AdminUserRbacRow }>(
      `/admin/users/${encodeURIComponent(userId)}/permissions`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),

  aiStatus: () => apiFetch<AiStatusResponse>('/ai/status'),

  aiDictionary: (payload: {
    query: string;
    direction?: TranslationDirection;
    forceAi?: boolean;
    lang?: LanguageCode;
  }) =>
    apiFetch<AiDictionaryResponse>('/ai/dictionary', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  aiChat: (payload: {
    message: string;
    history?: Array<Pick<AiChatMessage, 'role' | 'content'>>;
    lessonIds?: string[];
    lang?: LanguageCode;
  }) =>
    apiFetch<{
      reply: string;
      model: string;
      lessonTitle: string | null;
      lessonTitles?: string[];
      toolExecutions?: AiToolExecutionSummary[];
      pendingActions?: AiPendingAction[];
      effects?: { progressUpdated?: boolean; lessonsUpdated?: boolean };
    }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  aiGradeGame: (payload: {
    mode: 'scramble' | 'translation';
    direction?: GameGradeDirection;
    lang?: LanguageCode;
    exerciseId: string;
    promptText: string;
    expectedChinese?: string | null;
    expectedPinyin?: string | null;
    expectedMeaning?: string | null;
    userAnswer: string;
  }) =>
    apiFetch<GameGradeResponse>('/ai/grade-game', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  aiQuickLookup: (
    payload: { word: string; context?: string; lang?: LanguageCode },
    signal?: AbortSignal
  ) =>
    apiFetch<QuickLookupResponse>('/ai/quick-lookup', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    }),
};
