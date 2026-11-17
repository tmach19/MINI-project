import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Award,
  BookOpen,
  Calendar,
  Clock,
  ExternalLink,
  Flag,
  LogOut,
  Mail,
  PenTool,
  RefreshCw,
  Search,
  Shield,
  Sliders,
  Sparkles,
  Trash2,
  TrendingUp,
  User as UserIcon,
  Volume2,
} from 'lucide-react';
import { api } from '../lib/api';
import { speakChinese } from '../lib/audio';
import type {
  LessonSummary,
  MarkedVocabCard,
  MarkedVocabRecord,
  TestAttemptRecord,
  UserProfile,
  VocabularyItem,
} from '../types';

type ProfileTab = 'overview' | 'progress' | 'saved_vocab' | 'test_history' | 'settings';

interface ProfilePageProps {
  user: UserProfile;
  dbMode: 'postgres' | 'memory' | null;
  lessons: LessonSummary[];
  markedMap: Record<string, MarkedVocabRecord>;
  attempts: TestAttemptRecord[];
  onBackToStudy: () => void;
  onLogout: () => void;
  onToggleMarked?: (vocabId: string) => Promise<void> | void;
  onOpenLesson?: (lessonId: string, tab?: 'vocab' | 'test') => void;
  onOpenExam?: () => void;
  onOpenWriter?: (vocab: VocabularyItem) => void;
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
  dbMode,
  lessons,
  markedMap,
  attempts,
  onBackToStudy,
  onLogout,
  onToggleMarked,
  onOpenLesson,
  onOpenExam,
  onOpenWriter,
}) => {
  const [profileTab, setProfileTab] = useState<ProfileTab>('overview');
  const [markedCards, setMarkedCards] = useState<MarkedVocabCard[]>([]);
  const [loadingMarked, setLoadingMarked] = useState(false);
  const [markedError, setMarkedError] = useState<string | null>(null);
  const [markedSearch, setMarkedSearch] = useState('');
  const [lessonFilter, setLessonFilter] = useState<string>('all');
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [dbAttempts, setDbAttempts] = useState<TestAttemptRecord[]>(attempts);
  const [loadingAttempts, setLoadingAttempts] = useState(false);
  const [attemptsError, setAttemptsError] = useState<string | null>(null);
  const [attemptTypeFilter, setAttemptTypeFilter] = useState<'all' | 'lesson' | 'comprehensive'>('all');
  const [attemptSearch, setAttemptSearch] = useState('');

  useEffect(() => {
    setDbAttempts(attempts);
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
      const res = await api.getTestAttempts();
      setDbAttempts(res.attempts);
    } catch (err) {
      setAttemptsError(err instanceof Error ? err.message : 'Không tải được lịch sử làm bài');
    } finally {
      setLoadingAttempts(false);
    }
  }, []);

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

  const attemptStats = useMemo(() => {
    const totalAll = dbAttempts.length;
    const comprehensiveCount = dbAttempts.filter((a) => !a.lessonId).length;
    const lessonCount = totalAll - comprehensiveCount;
    return { totalAll, comprehensiveCount, lessonCount };
  }, [dbAttempts]);

  const filteredAttempts = useMemo(() => {
    const q = attemptSearch.trim().toLowerCase();
    return dbAttempts.filter((a) => {
      const isComprehensive = !a.lessonId;
      if (attemptTypeFilter === 'comprehensive' && !isComprehensive) return false;
      if (attemptTypeFilter === 'lesson' && isComprehensive) return false;
      if (!q) return true;
      const label = isComprehensive
        ? `Kiểm tra tổng hợp ${a.examTitle || ''}`
        : a.lessonTitle || a.lessonId || '';
      const dateStr = new Date(a.submittedAt).toLocaleString('vi-VN');
      return label.toLowerCase().includes(q) || dateStr.toLowerCase().includes(q);
    });
  }, [dbAttempts, attemptTypeFilter, attemptSearch]);

  const filteredAttemptStats = useMemo(() => {
    const total = filteredAttempts.length;
    const avgScore =
      total > 0 ? Math.round(filteredAttempts.reduce((sum, a) => sum + a.score, 0) / total) : 0;
    const bestScore = total > 0 ? Math.max(...filteredAttempts.map((a) => a.score)) : 0;
    return { total, avgScore, bestScore };
  }, [filteredAttempts]);

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
    { id: 'progress', label: 'Tiến độ học tập', icon: TrendingUp },
    { id: 'saved_vocab', label: 'Từ đã đánh dấu', icon: Flag },
    { id: 'test_history', label: 'Lịch sử làm bài', icon: Award },
    { id: 'settings', label: 'Thiết lập tài khoản', icon: Sliders },
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
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="h-28 bg-gradient-to-r from-red-600 via-rose-600 to-amber-500 relative">
          <div className="absolute inset-0 opacity-15 bg-[radial-gradient(circle_at_top_right,#fff,transparent_60%)]" />
        </div>

        <div className="px-6 pb-6 -mt-12 flex flex-col sm:flex-row sm:items-end justify-between gap-4 relative">
          <div className="flex items-end gap-4">
            <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-slate-800 to-slate-950 dark:from-red-600 dark:to-amber-600 border-4 border-white dark:border-slate-900 shadow-lg flex items-center justify-center text-white text-2xl font-black tracking-wide">
              {getInitials(user.displayName)}
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
            <span className="px-3 py-1.5 rounded-xl bg-stone-100 dark:bg-slate-800 font-mono text-[11px] font-bold">
              {dbMode === 'postgres' ? 'PostgreSQL' : 'Dev Mode'}
            </span>
          </div>
        </div>
      </div>

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
                  <span className="text-gray-500 dark:text-slate-400 block mb-0.5">Tên hiển thị</span>
                  <span className="font-bold text-gray-900 dark:text-white">{user.displayName}</span>
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
                    title="Tải lại từ cơ sở dữ liệu"
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
                <div className="py-12 text-center text-xs text-gray-500 dark:text-slate-400">
                  Đang tải danh sách từ đã đánh dấu từ cơ sở dữ liệu...
                </div>
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
                  <div className="relative flex-1 sm:w-56">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={attemptSearch}
                      onChange={(e) => setAttemptSearch(e.target.value)}
                      placeholder="Tìm theo tên bài hoặc ngày..."
                      className="w-full pl-8 pr-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 text-xs text-gray-800 dark:text-slate-100 focus:outline-none focus:border-red-500"
                    />
                  </div>

                  <select
                    value={attemptTypeFilter}
                    onChange={(e) =>
                      setAttemptTypeFilter(e.target.value as 'all' | 'lesson' | 'comprehensive')
                    }
                    className="px-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 text-xs font-medium text-gray-700 dark:text-slate-200"
                  >
                    <option value="all">Tất cả ({attemptStats.totalAll})</option>
                    <option value="lesson">Theo bài học ({attemptStats.lessonCount})</option>
                    <option value="comprehensive">
                      Kiểm tra tổng hợp ({attemptStats.comprehensiveCount})
                    </option>
                  </select>
                </div>
              </div>

              {attemptStats.totalAll > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
                    <span className="text-gray-500 dark:text-slate-400 block">Tổng lượt thi</span>
                    <span className="text-lg font-black text-gray-900 dark:text-white">
                      {filteredAttemptStats.total}
                    </span>
                  </div>
                  <div className="p-3 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
                    <span className="text-gray-500 dark:text-slate-400 block">Điểm trung bình</span>
                    <span className="text-lg font-black text-blue-600 dark:text-blue-400">
                      {filteredAttemptStats.avgScore}/100
                    </span>
                  </div>
                  <div className="p-3 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
                    <span className="text-gray-500 dark:text-slate-400 block">Điểm cao nhất</span>
                    <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                      {filteredAttemptStats.bestScore}/100
                    </span>
                  </div>
                </div>
              )}

              {attemptsError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300">
                  {attemptsError}
                </div>
              )}

              {loadingAttempts && dbAttempts.length === 0 ? (
                <div className="py-12 text-center text-xs text-gray-500 dark:text-slate-400">
                  Đang tải lịch sử làm bài từ cơ sở dữ liệu...
                </div>
              ) : filteredAttempts.length === 0 ? (
                <div className="py-12 text-center space-y-2 border border-dashed border-stone-200 dark:border-slate-800 rounded-2xl">
                  <Award className="w-8 h-8 text-red-400 mx-auto opacity-80" />
                  <p className="text-sm font-bold text-gray-800 dark:text-slate-200">
                    {attemptStats.totalAll === 0
                      ? 'Bạn chưa có lượt làm bài kiểm tra nào'
                      : 'Không tìm thấy lượt làm bài khớp bộ lọc'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-slate-400 max-w-md mx-auto">
                    {attemptStats.totalAll === 0
                      ? 'Hãy làm bài kiểm tra ở từng buổi học hoặc mục Kiểm tra tổng hợp để theo dõi kết quả tại đây.'
                      : 'Thử xóa từ khóa tìm kiếm hoặc chọn lại bộ lọc Tất cả.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-stone-200 dark:border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-stone-50 dark:bg-slate-800/70 text-gray-500 dark:text-slate-400 uppercase text-[11px] border-b border-stone-200 dark:border-slate-800">
                        <th className="py-3 px-3.5 w-12 text-center">STT</th>
                        <th className="py-3 px-3.5">Thuộc bài / Loại kiểm tra</th>
                        <th className="py-3 px-3.5 text-center">Điểm số</th>
                        <th className="py-3 px-3.5 text-center">Số câu đúng</th>
                        <th className="py-3 px-3.5 text-center">Thời gian làm</th>
                        <th className="py-3 px-3.5 text-right">Ngày nộp bài</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-slate-800">
                      {filteredAttempts.map((a, idx) => {
                        const isComprehensive = !a.lessonId;
                        const fullTitle = a.lessonTitle || a.examTitle || a.lessonId || 'Kiểm tra tổng hợp (26 bài)';
                        const shortLessonTitle = fullTitle.split(' - ')[0] || fullTitle;
                        const scoreColor =
                          a.score >= 80
                            ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70'
                            : a.score >= 50
                              ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/70'
                              : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/70';

                        return (
                          <tr
                            key={a.id}
                            className="hover:bg-stone-50/80 dark:hover:bg-slate-800/40 transition"
                          >
                            <td className="py-3 px-3.5 text-center font-mono text-gray-400">
                              {idx + 1}
                            </td>
                            <td className="py-3 px-3.5">
                              {isComprehensive ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenExam?.()}
                                  disabled={!onOpenExam}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-900/50 border border-purple-200/80 dark:border-purple-800/70 text-purple-700 dark:text-purple-300 font-semibold transition text-left disabled:cursor-default"
                                  title={fullTitle}
                                >
                                  <Award className="w-3.5 h-3.5 flex-shrink-0" />
                                  <span>Kiểm tra tổng hợp</span>
                                  {onOpenExam && (
                                    <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-75" />
                                  )}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onOpenLesson?.(a.lessonId!, 'test')}
                                  disabled={!onOpenLesson}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 border border-red-200/80 dark:border-red-800/70 text-red-700 dark:text-red-300 font-semibold transition text-left disabled:cursor-default"
                                  title={fullTitle}
                                >
                                  <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
                                  <span>{shortLessonTitle}</span>
                                  {onOpenLesson && (
                                    <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-75" />
                                  )}
                                </button>
                              )}
                            </td>
                            <td className="py-3 px-3.5 text-center">
                              <span
                                className={`inline-block px-2.5 py-0.5 rounded-lg border font-mono font-bold ${scoreColor}`}
                              >
                                {a.score}/100
                              </span>
                            </td>
                            <td className="py-3 px-3.5 text-center font-semibold text-gray-800 dark:text-slate-200">
                              {a.correctCount}/{a.totalQuestions}
                            </td>
                            <td className="py-3 px-3.5 text-center font-mono text-gray-600 dark:text-slate-300">
                              <span className="inline-flex items-center gap-1">
                                <Clock className="w-3 h-3 text-gray-400" />
                                {formatDurationSeconds(a.durationSeconds)}
                              </span>
                            </td>
                            <td className="py-3 px-3.5 text-right font-mono text-gray-500 dark:text-slate-400 whitespace-nowrap">
                              {new Date(a.submittedAt).toLocaleString('vi-VN')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="py-10 text-center space-y-2">
              <div className="w-11 h-11 rounded-2xl bg-stone-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 mx-auto flex items-center justify-center">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                {tabs.find((t) => t.id === profileTab)?.label}
              </h3>
              <p className="text-xs text-gray-500 dark:text-slate-400 max-w-md mx-auto">
                Khu vực này đã dựng sẵn khung giao diện để bạn thiết kế và gắn thêm chức năng chi tiết sau.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
