import type {
  AdminUserRbacRow,
  AiChatMessage,
  AiDictionaryResponse,
  AiPendingAction,
  AiStatusResponse,
  AiToolExecutionSummary,
  ComprehensiveExamResponse,
  DashboardSummary,
  GameGradeResponse,
  GameLeaderboardEntry,
  GameMode,
  GlobalVocabHit,
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

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

export function getStoredToken(): string | null {
  return localStorage.getItem('cs_auth_token');
}

export function setStoredToken(token: string | null): void {
  if (token) localStorage.setItem('cs_auth_token', token);
  else localStorage.removeItem('cs_auth_token');
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Lỗi API (${res.status})`);
  }
  return data as T;
}

export const api = {
  health: () => apiFetch<{ ok: boolean; dbMode: 'postgres' | 'memory' }>('/health'),

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

  listLessons: () => apiFetch<{ lessons: LessonSummary[] }>('/lessons'),

  getLesson: (id: string) => apiFetch<{ lesson: LessonDetail }>(`/lessons/${encodeURIComponent(id)}`),

  createLesson: (payload: {
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

  searchVocab: (q: string) =>
    apiFetch<{ items: GlobalVocabHit[] }>(`/vocab/search?q=${encodeURIComponent(q)}`),

  getVocabGlossary: () => apiFetch<{ items: VocabGlossaryItem[] }>('/vocab/glossary'),

  getProgress: () =>
    apiFetch<{
      markedMap: Record<string, MarkedVocabRecord>;
      markedCount: number;
      markedCards: MarkedVocabCard[];
      attempts: TestAttemptRecord[];
    }>('/progress'),

  getDashboard: (lessonId?: string) =>
    apiFetch<{ dashboard: DashboardSummary }>(
      `/dashboard${lessonId ? `?lessonId=${encodeURIComponent(lessonId)}` : ''}`
    ),

  getMarkedCards: () => apiFetch<{ cards: MarkedVocabCard[] }>('/progress/marked'),

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

  getComprehensiveExam: (lessonIds?: string[]) => {
    const query =
      lessonIds && lessonIds.length > 0
        ? `?lessonIds=${encodeURIComponent(lessonIds.join(','))}`
        : '';
    return apiFetch<{ exam: ComprehensiveExamResponse }>(`/tests/comprehensive-exam${query}`);
  },

  getTestAttempts: () => apiFetch<{ attempts: TestAttemptRecord[] }>('/tests/attempts'),

  getLessonTestSummary: () =>
    apiFetch<{ items: LessonTestSummaryRecord[] }>('/tests/lesson-summary'),

  getLessonAttemptDetails: (lessonId: string) =>
    apiFetch<{ attempts: LessonAttemptDetailRecord[] }>(
      `/tests/attempts?lessonId=${encodeURIComponent(lessonId)}`
    ),

  submitTestAttempt: (payload: {
    lessonId: string | null;
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
  }) =>
    apiFetch<AiDictionaryResponse>('/ai/dictionary', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  aiChat: (payload: {
    message: string;
    history?: Array<Pick<AiChatMessage, 'role' | 'content'>>;
    lessonIds?: string[];
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
    direction?: 'vi_to_zh' | 'zh_to_vi';
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
    payload: { word: string; context?: string },
    signal?: AbortSignal
  ) =>
    apiFetch<QuickLookupResponse>('/ai/quick-lookup', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    }),
};
