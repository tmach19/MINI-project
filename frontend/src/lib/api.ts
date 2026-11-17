import type {
  ComprehensiveExamResponse,
  GlobalVocabHit,
  LessonAttemptDetailRecord,
  LessonDetail,
  LessonSummary,
  LessonTestSummaryRecord,
  MarkedVocabCard,
  MarkedVocabRecord,
  TestAttemptRecord,
  UserProfile,
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

  listLessons: () => apiFetch<{ lessons: LessonSummary[] }>('/lessons'),

  getLesson: (id: string) => apiFetch<{ lesson: LessonDetail }>(`/lessons/${encodeURIComponent(id)}`),

  createLesson: (payload: {
    title: string;
    hskLevel: string;
    unit?: string;
    description?: string;
    vocabulary: any[];
    grammar: any[];
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

  getProgress: () =>
    apiFetch<{
      markedMap: Record<string, MarkedVocabRecord>;
      markedCount: number;
      markedCards: MarkedVocabCard[];
      attempts: TestAttemptRecord[];
    }>('/progress'),

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

  getComprehensiveExam: () =>
    apiFetch<{ exam: ComprehensiveExamResponse }>('/tests/comprehensive-exam'),

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
};
