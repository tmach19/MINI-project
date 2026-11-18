import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Award,
  BookOpen,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Edit3,
  ExternalLink,
  Flag,
  LogOut,
  Mail,
  PenTool,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  User as UserIcon,
  Volume2,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { speakChinese } from '../lib/audio';
import { getAvatarPreset, getCoverPreset, isImageMediaUrl } from '../lib/profileMedia';
import { LoadingCard, LoadingSpinner } from './common/LoadingState';
import { ProfileMediaModal } from './ProfileMediaModal';
import type {
  LessonAttemptDetailRecord,
  LessonSummary,
  LessonTestSummaryRecord,
  MarkedVocabCard,
  MarkedVocabRecord,
  TestAttemptRecord,
  UserProfile,
  VocabularyItem,
} from '../types';

type ProfileTab = 'overview' | 'saved_vocab' | 'test_history';
type HistorySubTab = 'comprehensive' | 'lesson';

interface ProfilePageProps {
  user: UserProfile;
  lessons: LessonSummary[];
  markedMap: Record<string, MarkedVocabRecord>;
  attempts: TestAttemptRecord[];
  onBackToStudy: () => void;
  onLogout: () => void;
  onToggleMarked?: (vocabId: string) => Promise<void> | void;
  onOpenLesson?: (lessonId: string, tab?: 'vocab' | 'test') => void;
  onOpenExam?: () => void;
  onOpenWriter?: (vocab: VocabularyItem) => void;
  onUpdateUser?: (updated: UserProfile) => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDurationSeconds(totalSeconds: number): string {
  const secs = Math.max(0, Math.round(totalSeconds || 0));
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  if (mins === 0) return `${rem}s`;
  return `${mins}p ${String(rem).padStart(2, '0')}s`;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({
  user,
  lessons,
  markedMap,
  attempts,
  onBackToStudy,
  onLogout,
  onToggleMarked,
  onOpenLesson,
  onOpenExam,
  onOpenWriter,
  onUpdateUser,
}) => {
  const [profileTab, setProfileTab] = useState<ProfileTab>('overview');
  const [editingDisplayName, setEditingDisplayName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState(user.displayName);
  const [savingDisplayName, setSavingDisplayName] = useState(false);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [displayNameSavedMsg, setDisplayNameSavedMsg] = useState<string | null>(null);
  const [mediaModalMode, setMediaModalMode] = useState<'avatar' | 'cover' | null>(null);

  useEffect(() => {
    setDisplayNameDraft(user.displayName);
  }, [user.displayName]);

  const handleSaveDisplayName = async () => {
    const clean = displayNameDraft.trim().replace(/\s+/g, ' ');
    if (!clean) {
      setDisplayNameError('Tên hiển thị không được để trống.');
      return;
    }
    if (clean.length > 60) {
      setDisplayNameError('Tên hiển thị tối đa 60 ký tự.');
      return;
    }
    setSavingDisplayName(true);
    setDisplayNameError(null);
    setDisplayNameSavedMsg(null);
    try {
      const res = await api.updateProfile({ displayName: clean });
      onUpdateUser?.(res.user);
      setEditingDisplayName(false);
      setDisplayNameSavedMsg('Đã cập nhật tên hiển thị.');
    } catch (err) {
      setDisplayNameError(err instanceof Error ? err.message : 'Không cập nhật được tên hiển thị.');
    } finally {
      setSavingDisplayName(false);
    }
  };
  const [markedCards, setMarkedCards] = useState<MarkedVocabCard[]>([]);
  const [loadingMarked, setLoadingMarked] = useState(false);
  const [markedError, setMarkedError] = useState<string | null>(null);
  const [markedSearch, setMarkedSearch] = useState('');
  const [lessonFilter, setLessonFilter] = useState<string>('all');
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [comprehensiveAttempts, setComprehensiveAttempts] = useState<LessonAttemptDetailRecord[]>(() =>
    attempts
      .filter((a) => !a.lessonId)
      .map((a) => ({
        id: a.id,
        lessonId: a.lessonId,
        examTitle: a.examTitle ?? null,
        score: a.score,
        totalQuestions: a.totalQuestions,
        correctCount: a.correctCount,
        durationSeconds: a.durationSeconds,
        submittedAt: a.submittedAt,
      }))
  );
  const [lessonTestSummaries, setLessonTestSummaries] = useState<LessonTestSummaryRecord[]>([]);
  const [expandedLessonIds, setExpandedLessonIds] = useState<Record<string, boolean>>({});
  const [lessonDetailsCache, setLessonDetailsCache] = useState<
    Record<string, LessonAttemptDetailRecord[]>
  >({});
  const [loadingDetailIds, setLoadingDetailIds] = useState<Record<string, boolean>>({});
  const [loadingAttempts, setLoadingAttempts] = useState(false);
  const [attemptsError, setAttemptsError] = useState<string | null>(null);
  const [historySubTab, setHistorySubTab] = useState<HistorySubTab>('comprehensive');
  const [historySelectedLessonIds, setHistorySelectedLessonIds] = useState<string[]>(() =>
    lessons.map((l) => l.id)
  );
  const didInitHistoryLessons = useRef(lessons.length > 0);
  const [lessonDropdownOpen, setLessonDropdownOpen] = useState(false);
  const lessonDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!didInitHistoryLessons.current && lessons.length > 0) {
      didInitHistoryLessons.current = true;
      setHistorySelectedLessonIds(lessons.map((l) => l.id));
    }
  }, [lessons]);

  useEffect(() => {
    if (!lessonDropdownOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (lessonDropdownRef.current && !lessonDropdownRef.current.contains(e.target as Node)) {
        setLessonDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLessonDropdownOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [lessonDropdownOpen]);

  useEffect(() => {
    setComprehensiveAttempts(
      attempts
        .filter((a) => !a.lessonId)
        .map((a) => ({
          id: a.id,
          lessonId: a.lessonId,
          examTitle: a.examTitle ?? null,
          score: a.score,
          totalQuestions: a.totalQuestions,
          correctCount: a.correctCount,
          durationSeconds: a.durationSeconds,
          submittedAt: a.submittedAt,
        }))
    );
    setLessonDetailsCache({});
  }, [attempts]);

  const loadMarkedFromDb = useCallback(async () => {
    setLoadingMarked(true);
    setMarkedError(null);
    try {
      const res = await api.getMarkedCards();
      setMarkedCards(res.cards);
    } catch (err) {
      setMarkedError(err instanceof Error ? err.message : 'Không tải được danh sách từ đã đánh dấu');
    } finally {
      setLoadingMarked(false);
    }
  }, []);

  const loadAttemptsFromDb = useCallback(async () => {
    setLoadingAttempts(true);
    setAttemptsError(null);
    try {
      const [summaryRes, compRes] = await Promise.all([
        api.getLessonTestSummary(),
        api.getLessonAttemptDetails('__comprehensive__'),
      ]);
      setLessonTestSummaries(summaryRes.items);
      setComprehensiveAttempts(compRes.attempts);
    } catch (err) {
      setAttemptsError(err instanceof Error ? err.message : 'Không tải được lịch sử làm bài');
    } finally {
      setLoadingAttempts(false);
    }
  }, []);

  const handleToggleLessonRow = async (lessonId: string, attemptCount: number) => {
    if (attemptCount <= 0) return;
    const nextExpanded = !expandedLessonIds[lessonId];
    setExpandedLessonIds((prev) => ({ ...prev, [lessonId]: nextExpanded }));
    if (nextExpanded && !lessonDetailsCache[lessonId] && !loadingDetailIds[lessonId]) {
      setLoadingDetailIds((prev) => ({ ...prev, [lessonId]: true }));
      try {
        const res = await api.getLessonAttemptDetails(lessonId);
        setLessonDetailsCache((prev) => ({ ...prev, [lessonId]: res.attempts }));
      } catch (err) {
        setAttemptsError(
          err instanceof Error ? err.message : 'Không tải được chi tiết lượt kiểm tra'
        );
      } finally {
        setLoadingDetailIds((prev) => ({ ...prev, [lessonId]: false }));
      }
    }
  };

  useEffect(() => {
    if (profileTab === 'saved_vocab') {
      void loadMarkedFromDb();
    } else if (profileTab === 'test_history') {
      void loadAttemptsFromDb();
    }
  }, [profileTab, user.id, loadMarkedFromDb, loadAttemptsFromDb]);

  const lessonOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    lessons.forEach((l, idx) => map.set(l.id, idx));
    return map;
  }, [lessons]);

  const orderedMarkedCards = useMemo(() => {
    return [...markedCards].sort((a, b) => {
      const idxA = lessonOrderMap.get(a.lessonId) ?? Number.MAX_SAFE_INTEGER;
      const idxB = lessonOrderMap.get(b.lessonId) ?? Number.MAX_SAFE_INTEGER;
      return idxA - idxB;
    });
  }, [markedCards, lessonOrderMap]);

  const markedLessonOptions = useMemo(() => {
    const seen = new Map<string, string>();
    orderedMarkedCards.forEach((c) => {
      if (!seen.has(c.lessonId)) seen.set(c.lessonId, c.lessonTitle);
    });
    return Array.from(seen.entries()).map(([id, title]) => ({ id, title }));
  }, [orderedMarkedCards]);

  const filteredMarkedCards = useMemo(() => {
    const q = markedSearch.trim().toLowerCase();
    return orderedMarkedCards.filter((card) => {
      if (lessonFilter !== 'all' && card.lessonId !== lessonFilter) return false;
      if (!q) return true;
      return [card.hanzi, card.pinyin, card.sinoVietnamese, card.meaning, card.lessonTitle]
        .filter(Boolean)
        .some((val) => val!.toLowerCase().includes(q));
    });
  }, [orderedMarkedCards, lessonFilter, markedSearch]);

  const handleUnmarkCard = async (vocabId: string) => {
    if (!onToggleMarked) return;
    setRemovingId(vocabId);
    try {
      await onToggleMarked(vocabId);
      setMarkedCards((prev) => prev.filter((c) => c.id !== vocabId));
    } finally {
      setRemovingId(null);
    }
  };

  const allLessonsSelected =
    lessons.length > 0 && lessons.every((l) => historySelectedLessonIds.includes(l.id));

  const totalLessonAttemptCount = useMemo(
    () => lessonTestSummaries.reduce((sum, item) => sum + item.attemptCount, 0),
    [lessonTestSummaries]
  );

  const filteredLessonSummaries = useMemo(() => {
    if (allLessonsSelected || historySelectedLessonIds.length === 0) return lessonTestSummaries;
    const selectedSet = new Set(historySelectedLessonIds);
    return lessonTestSummaries.filter((item) => selectedSet.has(item.lessonId));
  }, [allLessonsSelected, historySelectedLessonIds, lessonTestSummaries]);

  const historyStats = useMemo(() => {
    if (historySubTab === 'comprehensive') {
      const total = comprehensiveAttempts.length;
      const avgScore =
        total > 0
          ? Math.round(comprehensiveAttempts.reduce((sum, a) => sum + a.score, 0) / total)
          : 0;
      const bestScore = total > 0 ? Math.max(...comprehensiveAttempts.map((a) => a.score)) : 0;
      return { total, avgScore, bestScore };
    }

    const total = filteredLessonSummaries.reduce((sum, item) => sum + item.attemptCount, 0);
    const totalScoreSum = filteredLessonSummaries.reduce((sum, item) => sum + item.scoreSum, 0);
    const avgScore = total > 0 ? Math.round(totalScoreSum / total) : 0;
    const bestScores = filteredLessonSummaries
      .map((item) => item.bestScore)
      .filter((s): s is number => s !== null);
    const bestScore = bestScores.length > 0 ? Math.max(...bestScores) : 0;
    return { total, avgScore, bestScore };
  }, [historySubTab, comprehensiveAttempts, filteredLessonSummaries]);

  const lessonFilterLabel = useMemo(() => {
    if (allLessonsSelected) return 'Tất cả bài học';
    if (historySelectedLessonIds.length === 0) return 'Chưa chọn (hiện tất cả)';
    if (historySelectedLessonIds.length === 1) {
      const found = lessons.find((l) => l.id === historySelectedLessonIds[0]);
      return found ? found.title.split(' - ')[0] : '1 bài học';
    }
    return `Đã chọn ${historySelectedLessonIds.length} bài học`;
  }, [allLessonsSelected, historySelectedLessonIds, lessons]);

  const toggleHistoryLesson = (lessonId: string) => {
    setHistorySelectedLessonIds((prev) =>
      prev.includes(lessonId) ? prev.filter((id) => id !== lessonId) : [...prev, lessonId]
    );
  };

  const toggleAllHistoryLessons = () => {
    setHistorySelectedLessonIds(allLessonsSelected ? [] : lessons.map((l) => l.id));
  };

  const markedCount = Object.keys(markedMap).length;
  const customLessonCount = lessons.filter((l) => !l.isSystem).length;
  const joinedDate = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '—';

  const tabs: ReadonlyArray<{ id: ProfileTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'overview', label: 'Thông tin chung', icon: UserIcon },
    { id: 'saved_vocab', label: 'Từ đã đánh dấu', icon: Flag },
    { id: 'test_history', label: 'Lịch sử làm bài', icon: Award },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6 pop-in">
      {/* Thanh điều hướng quay lại */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackToStudy}
          className="px-3.5 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-stone-100 dark:hover:bg-slate-800 text-xs font-bold text-gray-700 dark:text-slate-200 inline-flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-4 h-4" /> Quay lại buổi học
        </button>

        <button
          type="button"
          onClick={onLogout}
          className="px-3.5 py-2 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 text-xs font-bold text-red-600 dark:text-red-300 inline-flex items-center gap-1.5 transition"
        >
          <LogOut className="w-3.5 h-3.5" /> Đăng xuất
        </button>
      </div>

      {/* Header Profile Card */}
      {(() => {
        const avatarPreset = getAvatarPreset(user.avatarUrl);
        const coverPreset = getCoverPreset(user.coverUrl);
        return (
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className={`h-32 sm:h-36 relative overflow-hidden ${isImageMediaUrl(user.coverUrl) ? 'bg-slate-900' : coverPreset.gradientClass}`}>
              {isImageMediaUrl(user.coverUrl) ? (
                <img
                  src={user.coverUrl!}
                  alt="Ảnh nền hồ sơ"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 opacity-15 bg-[radial-gradient(circle_at_top_right,#fff,transparent_60%)]" />
              )}
              <button
                type="button"
                onClick={() => setMediaModalMode('cover')}
                className="absolute top-3 right-3 px-3 py-1.5 rounded-xl bg-black/45 hover:bg-black/65 text-white text-[11px] font-bold backdrop-blur-md border border-white/20 inline-flex items-center gap-1.5 transition shadow-sm"
                title="Chọn ảnh nền hồ sơ"
              >
                <Camera className="w-3.5 h-3.5" /> Đổi ảnh nền
              </button>
            </div>

            <div className="px-6 pb-6 -mt-12 flex flex-col sm:flex-row sm:items-end justify-between gap-4 relative">
              <div className="flex items-end gap-4">
                <div className="relative flex-shrink-0">
                  <div className="w-24 h-24 rounded-3xl overflow-hidden bg-gradient-to-br from-slate-800 to-slate-950 dark:from-red-600 dark:to-amber-600 border-4 border-white dark:border-slate-900 shadow-lg flex items-center justify-center text-white text-2xl font-black tracking-wide">
                    {isImageMediaUrl(user.avatarUrl) ? (
                      <img
                        src={user.avatarUrl!}
                        alt={user.displayName}
                        className="w-full h-full object-cover"
                      />
                    ) : avatarPreset ? (
                      <div
                        className={`w-full h-full ${avatarPreset.gradientClass} flex items-center justify-center chinese-serif text-4xl font-black text-white`}
                      >
                        {avatarPreset.symbol}
                      </div>
                    ) : (
                      <span>{getInitials(user.displayName)}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setMediaModalMode('avatar')}
                    className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-white dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-slate-700 border border-stone-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:text-red-600 dark:hover:text-red-300 shadow-md flex items-center justify-center transition"
                    title="Đổi ảnh đại diện"
                    aria-label="Đổi ảnh đại diện"
                  >
                    <Camera className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="pb-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white">
                      {user.displayName}
                    </h1>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      {user.role === 'admin' ? 'Quản trị viên' : 'Học viên'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" /> {user.email}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
                <span className="px-3 py-1.5 rounded-xl bg-stone-100 dark:bg-slate-800 font-medium inline-flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-red-500" /> Tham gia: {joinedDate}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Thống kê tổng quan từ state sẵn có */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-2xl bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
            <Flag className="w-5 h-5" />
          </div>
          <div>
            <p className="text-2xl font-black text-gray-900 dark:text-white">{markedCount}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400">Từ đang đánh dấu</p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-2xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center flex-shrink-0">
            <Award className="w-5 h-5" />
          </div>
          <div>
            <p className="text-2xl font-black text-gray-900 dark:text-white">{attempts.length}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400">Lượt làm bài kiểm tra</p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-2xl bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <p className="text-2xl font-black text-gray-900 dark:text-white">{customLessonCount}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400">Buổi học tự tạo</p>
          </div>
        </div>
      </div>

      {/* Khung tab sẵn sàng để mở rộng chức năng sau */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-200 dark:border-slate-800 bg-stone-50/70 dark:bg-slate-800/40 flex items-center gap-2 overflow-x-auto">
          {tabs.map(({ id, label, icon: Icon }) => {
            const active = profileTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setProfileTab(id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap inline-flex items-center gap-1.5 transition ${
                  active
                    ? 'bg-red-600 text-white shadow-sm'
                    : 'text-gray-600 dark:text-slate-300 hover:bg-stone-200/70 dark:hover:bg-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            );
          })}
        </div>

        <div className="p-6">
          {profileTab === 'overview' ? (
            <div className="space-y-4">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Thông tin tài khoản</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-gray-500 dark:text-slate-400">Tên hiển thị</span>
                    {!editingDisplayName && (
                      <button
                        type="button"
                        onClick={() => {
                          setDisplayNameDraft(user.displayName);
                          setDisplayNameError(null);
                          setDisplayNameSavedMsg(null);
                          setEditingDisplayName(true);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 text-[11px] font-semibold text-gray-700 dark:text-slate-200 hover:border-red-400 hover:text-red-600 dark:hover:text-red-300 transition"
                      >
                        <Edit3 className="w-3 h-3" /> Sửa
                      </button>
                    )}
                  </div>
                  {editingDisplayName ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <input
                          type="text"
                          value={displayNameDraft}
                          maxLength={60}
                          autoFocus
                          disabled={savingDisplayName}
                          onChange={(e) => setDisplayNameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleSaveDisplayName();
                            } else if (e.key === 'Escape') {
                              setEditingDisplayName(false);
                              setDisplayNameDraft(user.displayName);
                              setDisplayNameError(null);
                            }
                          }}
                          placeholder="Nhập tên hiển thị mới..."
                          className="flex-1 min-w-[140px] px-2.5 py-1.5 rounded-xl border border-stone-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-semibold text-gray-900 dark:text-white focus:outline-none focus:border-red-500"
                        />
                        <button
                          type="button"
                          disabled={savingDisplayName}
                          onClick={() => void handleSaveDisplayName()}
                          className="px-2.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-[11px] font-bold inline-flex items-center gap-1 transition"
                        >
                          {savingDisplayName ? (
                            <LoadingSpinner size="sm" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          Lưu
                        </button>
                        <button
                          type="button"
                          disabled={savingDisplayName}
                          onClick={() => {
                            setEditingDisplayName(false);
                            setDisplayNameDraft(user.displayName);
                            setDisplayNameError(null);
                          }}
                          className="p-1.5 rounded-xl border border-stone-200 dark:border-slate-700 text-gray-500 hover:bg-stone-100 dark:hover:bg-slate-800 transition"
                          title="Huỷ"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {displayNameError && (
                        <p className="text-[11px] text-red-600 dark:text-red-400 font-medium">
                          {displayNameError}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <span className="font-bold text-gray-900 dark:text-white block">
                        {user.displayName}
                      </span>
                      {displayNameSavedMsg && (
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium block">
                          {displayNameSavedMsg}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-slate-400 block mb-0.5">Email đăng nhập</span>
                  <span className="font-bold text-gray-900 dark:text-white">{user.email}</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-slate-400 block mb-0.5">Vai trò</span>
                  <span className="font-bold text-gray-900 dark:text-white uppercase font-mono">{user.role}</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-slate-400 block mb-0.5">ID tài khoản</span>
                  <span className="font-mono text-[11px] text-gray-700 dark:text-slate-300 break-all">{user.id}</span>
                </div>
              </div>
            </div>
          ) : profileTab === 'saved_vocab' ? (
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Flag className="w-4 h-4 text-amber-500" />
                  Danh sách từ đã đánh dấu
                </h2>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 sm:w-56">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={markedSearch}
                      onChange={(e) => setMarkedSearch(e.target.value)}
                      placeholder="Tìm chữ Hán, Pinyin, nghĩa..."
                      className="w-full pl-8 pr-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 text-xs text-gray-800 dark:text-slate-100 focus:outline-none focus:border-red-500"
                    />
                  </div>

                  {markedLessonOptions.length > 1 && (
                    <select
                      value={lessonFilter}
                      onChange={(e) => setLessonFilter(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 text-xs font-medium text-gray-700 dark:text-slate-200 max-w-[180px] truncate"
                    >
                      <option value="all">Tất cả bài ({orderedMarkedCards.length})</option>
                      {markedLessonOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.title.split(' - ')[0]}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    disabled={loadingMarked}
                    onClick={() => void loadMarkedFromDb()}
                    className="px-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 hover:bg-stone-100 dark:hover:bg-slate-800 text-xs font-semibold text-gray-700 dark:text-slate-200 inline-flex items-center gap-1.5 disabled:opacity-50 transition"
                    title="Tải lại"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingMarked ? 'animate-spin' : ''}`} />
                    Làm mới
                  </button>
                </div>
              </div>

              {markedError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300">
                  {markedError}
                </div>
              )}

              {loadingMarked && markedCards.length === 0 ? (
                <LoadingCard
                  compact
                  message="Đang tải danh sách từ đã đánh dấu..."
                />
              ) : filteredMarkedCards.length === 0 ? (
                <div className="py-12 text-center space-y-2 border border-dashed border-stone-200 dark:border-slate-800 rounded-2xl">
                  <Flag className="w-8 h-8 text-amber-400 mx-auto opacity-80" />
                  <p className="text-sm font-bold text-gray-800 dark:text-slate-200">
                    {orderedMarkedCards.length === 0
                      ? 'Bạn chưa đánh dấu từ vựng nào'
                      : 'Không tìm thấy từ nào khớp bộ lọc'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-slate-400 max-w-md mx-auto">
                    {orderedMarkedCards.length === 0
                      ? 'Hãy bấm biểu tượng lá cờ ở thẻ hoặc bảng từ vựng trong mỗi buổi học để lưu từ cần ôn lại tại đây.'
                      : 'Thử xóa từ khóa tìm kiếm hoặc chọn lại tất cả bài học.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-stone-200 dark:border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-stone-50 dark:bg-slate-800/70 text-gray-500 dark:text-slate-400 uppercase text-[11px] border-b border-stone-200 dark:border-slate-800">
                        <th className="py-3 px-3.5 w-12 text-center">STT</th>
                        <th className="py-3 px-3.5">Chữ Hán</th>
                        <th className="py-3 px-3.5">Pinyin & Hán Việt</th>
                        <th className="py-3 px-3.5">Nghĩa tiếng Việt</th>
                        <th className="py-3 px-3.5">Thuộc bài</th>
                        <th className="py-3 px-3.5 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-slate-800">
                      {filteredMarkedCards.map((card, idx) => {
                        const shortLesson = card.lessonTitle.split(':')[0] || card.lessonTitle;
                        return (
                          <tr
                            key={card.id}
                            className="hover:bg-stone-50/80 dark:hover:bg-slate-800/40 transition"
                          >
                            <td className="py-3 px-3.5 text-center font-mono text-gray-400">
                              {idx + 1}
                            </td>
                            <td className="py-3 px-3.5">
                              <div className="flex items-center gap-2">
                                <span className="chinese-font text-lg font-bold text-gray-900 dark:text-white">
                                  {card.hanzi}
                                </span>
                                {card.type && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 hidden sm:inline">
                                    {card.type}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-3.5">
                              <span className="block font-mono text-amber-700 dark:text-amber-400 font-semibold">
                                {card.pinyin}
                              </span>
                              {card.sinoVietnamese && (
                                <span className="block text-[11px] text-gray-500 dark:text-slate-400">
                                  {card.sinoVietnamese}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3.5 text-gray-800 dark:text-slate-200 font-medium max-w-xs">
                              {card.meaning}
                            </td>
                            <td className="py-3 px-3.5">
                              {onOpenLesson ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenLesson(card.lessonId, 'vocab')}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 border border-red-200/80 dark:border-red-800/70 text-red-700 dark:text-red-300 font-semibold transition text-left"
                                  title={`Mở ${card.lessonTitle}`}
                                >
                                  <span>{shortLesson}</span>
                                  <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-75" />
                                </button>
                              ) : (
                                <span className="inline-block px-2.5 py-1 rounded-lg bg-stone-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 font-semibold">
                                  {card.lessonTitle}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3.5">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => speakChinese(card.hanzi)}
                                  className="p-1.5 rounded-lg border border-stone-200 dark:border-slate-700 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition"
                                  title="Nghe phát âm"
                                >
                                  <Volume2 className="w-3.5 h-3.5" />
                                </button>
                                {onOpenWriter && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenWriter(card)}
                                    className="p-1.5 rounded-lg border border-stone-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition"
                                    title="Luyện viết chữ Hán"
                                  >
                                    <PenTool className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {onToggleMarked && (
                                  <button
                                    type="button"
                                    disabled={removingId === card.id}
                                    onClick={() => void handleUnmarkCard(card.id)}
                                    className="p-1.5 rounded-lg border border-stone-200 dark:border-slate-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40 transition"
                                    title="Bỏ đánh dấu từ này"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : profileTab === 'test_history' ? (
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Award className="w-4 h-4 text-red-500" />
                  Tổng hợp lịch sử làm bài
                </h2>

                <div className="flex flex-wrap items-center gap-2">
                  {historySubTab === 'lesson' && (
                    <div ref={lessonDropdownRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setLessonDropdownOpen((prev) => !prev)}
                        aria-expanded={lessonDropdownOpen}
                        className={`px-3 py-2 rounded-xl border text-xs font-medium inline-flex items-center justify-between gap-2 min-w-[180px] max-w-[230px] transition ${
                          lessonDropdownOpen
                            ? 'border-red-500 bg-red-50/70 dark:bg-red-950/30 text-gray-900 dark:text-white'
                            : 'border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-700/70'
                        }`}
                      >
                        <span className="truncate">{lessonFilterLabel}</span>
                        <ChevronDown
                          className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${
                            lessonDropdownOpen ? 'rotate-180' : ''
                          }`}
                        />
                      </button>

                      {lessonDropdownOpen && (
                        <div className="absolute left-0 sm:left-auto sm:right-0 mt-1.5 w-72 rounded-2xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl z-40 overflow-hidden pop-in">
                          <div className="p-1.5 border-b border-stone-100 dark:border-slate-800 bg-stone-50/70 dark:bg-slate-800/40">
                            <button
                              type="button"
                              onClick={toggleAllHistoryLessons}
                              className={`w-full text-left px-2.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                                allLessonsSelected
                                  ? 'bg-red-50 dark:bg-red-900/35 text-red-700 dark:text-red-200'
                                  : 'text-gray-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              <span
                                className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                                  allLessonsSelected
                                    ? 'bg-red-600 border-red-600 text-white'
                                    : 'border-stone-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                                }`}
                              >
                                {allLessonsSelected && <Check className="w-3 h-3" />}
                              </span>
                              <span>Tất cả bài học</span>
                            </button>
                          </div>

                          <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
                            {lessons.map((l) => {
                              const checked = historySelectedLessonIds.includes(l.id);
                              const shortTitle = l.title.split(' - ')[0];
                              return (
                                <button
                                  key={l.id}
                                  type="button"
                                  onClick={() => toggleHistoryLesson(l.id)}
                                  className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs flex items-center gap-2.5 transition ${
                                    checked
                                      ? 'bg-red-50/80 dark:bg-red-900/25 text-red-700 dark:text-red-200 font-semibold'
                                      : 'text-gray-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  <span
                                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                                      checked
                                        ? 'bg-red-600 border-red-600 text-white'
                                        : 'border-stone-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                                    }`}
                                  >
                                    {checked && <Check className="w-3 h-3" />}
                                  </span>
                                  <span className="truncate">{shortTitle}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="inline-flex bg-stone-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => {
                        setLessonDropdownOpen(false);
                        setHistorySubTab('comprehensive');
                      }}
                      className={`px-3 py-1.5 rounded-lg transition ${
                        historySubTab === 'comprehensive'
                          ? 'bg-red-600 text-white shadow-sm'
                          : 'text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white'
                      }`}
                    >
                      Kiểm tra tổng hợp ({comprehensiveAttempts.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistorySubTab('lesson')}
                      className={`px-3 py-1.5 rounded-lg transition ${
                        historySubTab === 'lesson'
                          ? 'bg-red-600 text-white shadow-sm'
                          : 'text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white'
                      }`}
                    >
                      Kiểm tra theo bài học ({totalLessonAttemptCount})
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-slate-400 block">Tổng lượt thi</span>
                  <span className="text-lg font-black text-gray-900 dark:text-white">
                    {historyStats.total}
                  </span>
                </div>
                <div className="p-3 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-slate-400 block">Điểm trung bình</span>
                  <span className="text-lg font-black text-blue-600 dark:text-blue-400">
                    {historyStats.avgScore}/100
                  </span>
                </div>
                <div className="p-3 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-slate-400 block">Điểm cao nhất</span>
                  <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                    {historyStats.bestScore}/100
                  </span>
                </div>
              </div>

              {attemptsError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300">
                  {attemptsError}
                </div>
              )}

              {loadingAttempts && lessonTestSummaries.length === 0 && comprehensiveAttempts.length === 0 ? (
                <LoadingCard
                  compact
                  message="Đang tải lịch sử làm bài..."
                />
              ) : historySubTab === 'comprehensive' ? (
                <div className="overflow-x-auto rounded-2xl border border-stone-200 dark:border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-stone-50 dark:bg-slate-800/70 text-gray-500 dark:text-slate-400 uppercase text-[11px] border-b border-stone-200 dark:border-slate-800">
                        <th className="py-3 px-3.5 w-12 text-center">STT</th>
                        <th className="py-3 px-3.5">Loại kiểm tra</th>
                        <th className="py-3 px-3.5 text-center">Điểm số</th>
                        <th className="py-3 px-3.5 text-center">Số câu đúng</th>
                        <th className="py-3 px-3.5 text-center">Thời gian làm</th>
                        <th className="py-3 px-3.5 text-center">Ngày nộp bài</th>
                        <th className="py-3 px-3.5 text-right">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-slate-800">
                      {(comprehensiveAttempts.length === 0 ? [null] : comprehensiveAttempts).map(
                        (a, idx) => {
                          const scoreColor = a
                            ? a.score >= 80
                              ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70'
                              : a.score >= 60
                                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/70'
                                : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/70'
                            : '';

                          const rawTitle = a?.examTitle?.trim() || 'Kiểm tra tổng hợp (26 bài)';
                          const scopeMatch = rawTitle.match(/^(.*?)\s*\((\d+\s*bài[^()]*)\)$/i);
                          const displayTitle = scopeMatch ? scopeMatch[1].trim() : rawTitle;
                          const lessonCountNote = scopeMatch
                            ? `Tổng hợp ${scopeMatch[2].trim()}`
                            : rawTitle === 'Kiểm tra tổng hợp'
                              ? 'Tổng hợp 26 bài'
                              : null;

                          return (
                            <tr
                              key={a ? a.id : 'comprehensive-empty'}
                              className="hover:bg-stone-50/80 dark:hover:bg-slate-800/40 transition"
                            >
                              <td className="py-3 px-3.5 text-center font-mono text-gray-400">
                                {idx + 1}
                              </td>
                              <td className="py-3 px-3.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <button
                                    type="button"
                                    onClick={() => onOpenExam?.()}
                                    disabled={!onOpenExam}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-900/50 border border-purple-200/80 dark:border-purple-800/70 text-purple-700 dark:text-purple-300 font-semibold transition text-left disabled:cursor-default"
                                    title={rawTitle}
                                  >
                                    <Award className="w-3.5 h-3.5 flex-shrink-0" />
                                    <span>{displayTitle}</span>
                                    {onOpenExam && (
                                      <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-75" />
                                    )}
                                  </button>
                                  {a && lessonCountNote && (
                                    <span className="px-2 py-0.5 rounded-md bg-stone-100 dark:bg-slate-800 border border-stone-200/80 dark:border-slate-700 text-[11px] font-medium text-gray-600 dark:text-slate-300">
                                      {lessonCountNote}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-3.5 text-center">
                                {a ? (
                                  <span
                                    className={`inline-block px-2.5 py-0.5 rounded-lg border font-mono font-bold ${scoreColor}`}
                                  >
                                    {a.score}/100
                                  </span>
                                ) : (
                                  <span className="text-gray-400 font-mono">-</span>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-center font-semibold text-gray-800 dark:text-slate-200">
                                {a ? (
                                  `${a.correctCount}/${a.totalQuestions}`
                                ) : (
                                  <span className="text-gray-400 font-mono">-</span>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-center font-mono text-gray-600 dark:text-slate-300">
                                {a ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Clock className="w-3 h-3 text-gray-400" />
                                    {formatDurationSeconds(a.durationSeconds)}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-center font-mono text-gray-500 dark:text-slate-400 whitespace-nowrap">
                                {a ? new Date(a.submittedAt).toLocaleString('vi-VN') : '-'}
                              </td>
                              <td className="py-3 px-3.5 text-right whitespace-nowrap">
                                {!a ? (
                                  <span className="text-gray-400 font-mono">-</span>
                                ) : a.score >= 60 ? (
                                  <span className="inline-block px-2.5 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300 font-bold">
                                    Đạt
                                  </span>
                                ) : (
                                  <span className="inline-block px-2.5 py-0.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/70 text-red-600 dark:text-red-400 font-bold">
                                    Chưa đạt
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        }
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-stone-200 dark:border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-stone-50 dark:bg-slate-800/70 text-gray-500 dark:text-slate-400 uppercase text-[11px] border-b border-stone-200 dark:border-slate-800">
                        <th className="py-3 px-3.5 w-12 text-center">STT</th>
                        <th className="py-3 px-3.5">Thuộc bài</th>
                        <th className="py-3 px-3.5 text-center">Điểm TB</th>
                        <th className="py-3 px-3.5 text-center">Câu đúng TB</th>
                        <th className="py-3 px-3.5 text-center">Thời gian TB</th>
                        <th className="py-3 px-3.5 text-center">Gần nhất</th>
                        <th className="py-3 px-3.5 text-right">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-slate-800">
                      {filteredLessonSummaries.map((item, idx) => {
                        const hasAttempts = item.attemptCount > 0;
                        const isExpanded = Boolean(expandedLessonIds[item.lessonId]);
                        const isLoadingDetails = Boolean(loadingDetailIds[item.lessonId]);
                        const details = lessonDetailsCache[item.lessonId] || [];
                        const shortLessonTitle =
                          item.lessonTitle.split(' - ')[0] || item.lessonTitle;
                        const avgScoreColor =
                          item.avgScore !== null
                            ? item.avgScore >= 80
                              ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70'
                              : item.avgScore >= 60
                                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/70'
                                : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/70'
                            : '';

                        return (
                          <React.Fragment key={item.lessonId}>
                            <tr
                              onClick={() => void handleToggleLessonRow(item.lessonId, item.attemptCount)}
                              className={`transition ${
                                hasAttempts
                                  ? 'cursor-pointer hover:bg-stone-50/90 dark:hover:bg-slate-800/50'
                                  : 'hover:bg-stone-50/50 dark:hover:bg-slate-800/20'
                              } ${isExpanded ? 'bg-stone-50/70 dark:bg-slate-800/35' : ''}`}
                            >
                              <td className="py-3 px-3.5 text-center font-mono text-gray-400">
                                {idx + 1}
                              </td>
                              <td className="py-3 px-3.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {hasAttempts ? (
                                    <ChevronRight
                                      className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${
                                        isExpanded ? 'rotate-90 text-red-500' : ''
                                      }`}
                                    />
                                  ) : (
                                    <span className="w-4 h-4 inline-block flex-shrink-0" />
                                  )}

                                  <span
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200/80 dark:border-red-800/70 text-red-700 dark:text-red-300 font-semibold"
                                    title={item.lessonTitle}
                                  >
                                    <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
                                    <span>{shortLessonTitle}</span>
                                  </span>

                                  {hasAttempts && (
                                    <span className="px-2 py-0.5 rounded-full bg-stone-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 text-[11px] font-mono font-bold">
                                      {item.attemptCount} lượt
                                    </span>
                                  )}

                                  {onOpenLesson && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenLesson(item.lessonId, 'test');
                                      }}
                                      className="p-1 rounded-md text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
                                      title={`Mở bài kiểm tra ${shortLessonTitle}`}
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-3.5 text-center">
                                {item.avgScore !== null ? (
                                  <span
                                    className={`inline-block px-2.5 py-0.5 rounded-lg border font-mono font-bold ${avgScoreColor}`}
                                  >
                                    {item.avgScore}/100
                                  </span>
                                ) : (
                                  <span className="text-gray-400 font-mono">-</span>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-center font-semibold text-gray-800 dark:text-slate-200">
                                {item.avgCorrect !== null && item.totalQuestions ? (
                                  `${item.avgCorrect}/${item.totalQuestions}`
                                ) : (
                                  <span className="text-gray-400 font-mono">-</span>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-center font-mono text-gray-600 dark:text-slate-300">
                                {item.avgDurationSeconds !== null ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Clock className="w-3 h-3 text-gray-400" />
                                    {formatDurationSeconds(item.avgDurationSeconds)}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-center font-mono text-gray-500 dark:text-slate-400 whitespace-nowrap">
                                {item.lastSubmittedAt
                                  ? new Date(item.lastSubmittedAt).toLocaleString('vi-VN')
                                  : '-'}
                              </td>
                              <td className="py-3 px-3.5 text-right whitespace-nowrap">
                                {item.status === 'unattempted' ? (
                                  <span className="text-gray-400 font-mono">-</span>
                                ) : item.status === 'passed' ? (
                                  <span className="inline-block px-2.5 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300 font-bold">
                                    Đạt
                                  </span>
                                ) : (
                                  <span className="inline-block px-2.5 py-0.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/70 text-red-600 dark:text-red-400 font-bold">
                                    Chưa đạt
                                  </span>
                                )}
                              </td>
                            </tr>

                            {isExpanded && hasAttempts && (
                              <tr className="bg-stone-50/60 dark:bg-slate-900/80">
                                <td colSpan={7} className="px-6 py-3">
                                  {isLoadingDetails ? (
                                    <div className="py-4 flex items-center justify-center gap-2.5 text-xs text-gray-500 dark:text-slate-400">
                                      <LoadingSpinner size="sm" />
                                      <span>Đang tải chi tiết từng lần kiểm tra...</span>
                                    </div>
                                  ) : details.length === 0 ? (
                                    <div className="py-2 text-center text-xs text-gray-500 dark:text-slate-400">
                                      Không có dữ liệu chi tiết.
                                    </div>
                                  ) : (
                                    <div className="rounded-xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 overflow-hidden">
                                      <table className="w-full text-left border-collapse text-[11px]">
                                        <thead>
                                          <tr className="bg-stone-100/80 dark:bg-slate-800/60 text-gray-500 dark:text-slate-400 uppercase border-b border-stone-200 dark:border-slate-800">
                                            <th className="py-2 px-3 w-20 text-center">Lần thi</th>
                                            <th className="py-2 px-3 text-center">Điểm số</th>
                                            <th className="py-2 px-3 text-center">Số câu đúng</th>
                                            <th className="py-2 px-3 text-center">Thời gian làm</th>
                                            <th className="py-2 px-3 text-center">Ngày nộp bài</th>
                                            <th className="py-2 px-3 text-right">Trạng thái</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-stone-100 dark:divide-slate-800/70">
                                          {details.map((d, dIdx) => {
                                            const attemptNum = details.length - dIdx;
                                            const dColor =
                                              d.score >= 80
                                                ? 'text-emerald-600 dark:text-emerald-400'
                                                : d.score >= 60
                                                  ? 'text-blue-600 dark:text-blue-400'
                                                  : 'text-red-600 dark:text-red-400';
                                            return (
                                              <tr
                                                key={d.id}
                                                className="hover:bg-stone-50 dark:hover:bg-slate-800/30"
                                              >
                                                <td className="py-2 px-3 text-center font-mono text-gray-500 dark:text-slate-400">
                                                  Lần {attemptNum}
                                                </td>
                                                <td
                                                  className={`py-2 px-3 text-center font-mono font-bold ${dColor}`}
                                                >
                                                  {d.score}/100
                                                </td>
                                                <td className="py-2 px-3 text-center font-semibold text-gray-700 dark:text-slate-200">
                                                  {d.correctCount}/{d.totalQuestions}
                                                </td>
                                                <td className="py-2 px-3 text-center font-mono text-gray-600 dark:text-slate-300">
                                                  {formatDurationSeconds(d.durationSeconds)}
                                                </td>
                                                <td className="py-2 px-3 text-center font-mono text-gray-500 dark:text-slate-400">
                                                  {new Date(d.submittedAt).toLocaleString('vi-VN')}
                                                </td>
                                                <td className="py-2 px-3 text-right">
                                                  {d.score >= 60 ? (
                                                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                                      Đạt
                                                    </span>
                                                  ) : (
                                                    <span className="text-red-600 dark:text-red-400 font-bold">
                                                      Chưa đạt
                                                    </span>
                                                  )}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {mediaModalMode && (
        <ProfileMediaModal
          mode={mediaModalMode}
          currentValue={mediaModalMode === 'avatar' ? user.avatarUrl : user.coverUrl}
          initials={getInitials(user.displayName)}
          onClose={() => setMediaModalMode(null)}
          onSave={async (nextValue) => {
            const payload =
              mediaModalMode === 'avatar'
                ? { avatarUrl: nextValue }
                : { coverUrl: nextValue };
            const res = await api.updateProfile(payload);
            onUpdateUser?.(res.user);
          }}
        />
      )}
    </div>
  );
};
