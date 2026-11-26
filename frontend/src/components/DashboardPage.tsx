import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  BarChart3,
  Bell,
  Bookmark,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Compass,
  Flame,
  GitBranch,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  Moon,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  User as UserIcon,
} from 'lucide-react';
import { getLanguagePack } from '../languages/config';
import { api } from '../lib/api';
import { getAvatarPreset, isImageMediaUrl } from '../lib/profileMedia';
import { SavedVocabPanel } from './SavedVocabPanel';
import { TestHistoryPanel } from './TestHistoryPanel';
import { LoadingSpinner } from './common/LoadingState';
import { ModalCloseButton } from './common/ModalShell';
import type {
  DashboardActivityDay,
  DashboardSummary,
  LanguageCode,
  LessonSummary,
  TabId,
  TestAttemptRecord,
  UserProfile,
  VocabularyItem,
} from '../types';

export type DashboardSection = 'overview' | 'saved_vocab' | 'history';

interface DashboardPageProps {
  lang?: LanguageCode;
  user: UserProfile | null;
  lessons: LessonSummary[];
  attempts: TestAttemptRecord[];
  currentLessonId: string;
  activeSection: DashboardSection;
  darkMode: boolean;
  canAccessAdmin: boolean;
  canUseAiAssistant: boolean;
  onChangeSection: (section: DashboardSection) => void;
  onSelectLesson?: (lessonId: string) => void;
  onToggleDarkMode: () => void;
  onOpenLesson: (lessonId: string, tab?: TabId) => void;
  onOpenExam: () => void;
  onOpenProfile: () => void;
  onOpenAdmin: () => void;
  onOpenSearch: () => void;
  onOpenAiDictionary: (query?: string) => void;
  onToggleMarked?: (vocabId: string) => Promise<void> | void;
  onOpenWriter?: (vocab: VocabularyItem) => void;
  onRequireAuth: () => void;
  onLogout: () => void;
}

const DAILY_GOAL_OPTIONS = [15, 30, 45, 60] as const;

function getGreetingByHour(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Chào buổi sáng';
  if (hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

function formatVietnameseDate(date: Date): string {
  const raw = date.toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatShortWeekday(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  return day === 0 ? 'CN' : `T${day + 1}`;
}

function formatDayMonth(isoDate: string): string {
  const [, m, d] = isoDate.split('-');
  return `${d}/${m}`;
}

function getInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return 'H';
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

function buildGuestDashboard(
  lessons: LessonSummary[],
  currentLessonId: string,
  lang: LanguageCode = 'zh'
): DashboardSummary {
  const pack = getLanguagePack(lang);
  const totalVocab = lessons.reduce((sum, l) => sum + (l.vocabCount || 0), 0);
  const chosen = lessons.find((l) => l.id === currentLessonId) || lessons[0] || null;

  const activityLast28Days: DashboardActivityDay[] = [];
  const baseDate = new Date();
  for (let i = 27; i >= 0; i -= 1) {
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
    activityLast28Days.push({ date: key, count: 0, minutes: 0, level: 0 });
  }

  const fallbackLessonId = chosen?.id || pack.defaultLessonId;
  return {
    streakDays: 0,
    bestStreakDays: 0,
    studiedToday: false,
    today: {
      minutesStudied: 0,
      dailyGoalMinutes: 30,
      testsCompleted: 0,
      gamesCompleted: 0,
      vocabMarkedToday: 0,
    },
    vocabReview: {
      totalVocab,
      dueCount: 0,
      newCount: totalVocab,
      learningCount: 0,
      masteredCount: 0,
    },
    skills: [
      {
        id: 'vocab',
        label: 'Từ vựng',
        score: 0,
        correctCount: 0,
        totalCount: 0,
        passed: false,
        detail: 'Chưa làm kiểm tra',
        targetTab: 'vocab',
        targetLessonId: fallbackLessonId,
      },
      {
        id: 'grammar',
        label: 'Ngữ pháp',
        score: 0,
        correctCount: 0,
        totalCount: 0,
        passed: false,
        detail: 'Chưa làm kiểm tra',
        targetTab: 'grammar',
        targetLessonId: fallbackLessonId,
      },
      {
        id: 'listening',
        label: 'Nghe',
        score: 0,
        correctCount: 0,
        totalCount: 0,
        passed: false,
        detail: 'Chưa làm kiểm tra',
        targetTab: 'texts',
        targetLessonId: fallbackLessonId,
      },
      {
        id: 'reading',
        label: 'Đọc hiểu',
        score: 0,
        correctCount: 0,
        totalCount: 0,
        passed: false,
        detail: 'Chưa làm kiểm tra',
        targetTab: 'games',
        targetLessonId: fallbackLessonId,
      },
    ],
    activityLast28Days,
    continueLesson: chosen
      ? {
          lessonId: chosen.id,
          title: chosen.title,
          hskLevel: chosen.hskLevel || pack.defaultLevel,
          unit: chosen.unit ?? null,
          progressPercent: 0,
          passed: false,
          passThreshold: 70,
          vocabCount: chosen.vocabCount,
          grammarCount: chosen.grammarCount,
          textCount: chosen.textCount,
          estimatedMinutesLeft: Math.max(
            10,
            Math.round(chosen.vocabCount * 0.8 + chosen.textCount * 4)
          ),
          bestScore: null,
          attemptCount: 0,
        }
      : null,
    overallProgress: {
      completedLessons: 0,
      totalLessons: lessons.length,
      averageTestScore: null,
      totalTests: 0,
      totalGames: 0,
    },
  };
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  lang = 'zh',
  user,
  lessons,
  attempts,
  currentLessonId,
  activeSection,
  darkMode,
  canAccessAdmin,
  canUseAiAssistant,
  onChangeSection,
  onSelectLesson,
  onToggleDarkMode,
  onOpenLesson,
  onOpenExam,
  onOpenProfile,
  onOpenAdmin,
  onOpenSearch,
  onOpenAiDictionary,
  onToggleMarked,
  onOpenWriter,
  onRequireAuth,
  onLogout,
}) => {
  const langPack = useMemo(() => getLanguagePack(lang), [lang]);
  const isEnglish = lang === 'en';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showRoadmapModal, setShowRoadmapModal] = useState(false);
  const [showNotifPopover, setShowNotifPopover] = useState(false);
  const [activityView, setActivityView] = useState<'week' | 'heatmap'>('week');
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState<number>(() => {
    const saved = Number(localStorage.getItem('cs_daily_goal_minutes'));
    return DAILY_GOAL_OPTIONS.includes(saved as (typeof DAILY_GOAL_OPTIONS)[number]) ? saved : 30;
  });

  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(user));
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showNotifPopover) return;
    const onDocClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifPopover(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showNotifPopover]);

  useEffect(() => {
    if (!user) {
      setDashboard(buildGuestDashboard(lessons, currentLessonId, lang));
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    api
      .getDashboard(currentLessonId, lang)
      .then((res) => {
        if (!cancelled) setDashboard(res.dashboard);
      })
      .catch(() => {
        if (!cancelled) setDashboard(buildGuestDashboard(lessons, currentLessonId, lang));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, currentLessonId, lessons, lang]);

  const data = useMemo(
    () => dashboard || buildGuestDashboard(lessons, currentLessonId, lang),
    [dashboard, lessons, currentLessonId, lang]
  );


  const heroLesson = data.continueLesson;

  const isBrandNewUser =
    !user ||
    (data.overallProgress.totalTests === 0 &&
      data.overallProgress.totalGames === 0 &&
      data.vocabReview.dueCount === 0);

  const now = new Date();
  const greeting = getGreetingByHour(now);
  const formattedDate = formatVietnameseDate(now);

  // Progress ring calculations
  const goalPct = Math.min(100, Math.round((data.today.minutesStudied / dailyGoalMinutes) * 100));
  const ringRadius = 46;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDashOffset = ringCircumference * (1 - goalPct / 100);

  // Weakest skill identification among skills with questions & not yet passed (> 70%)
  const weakestSkillId = useMemo(() => {
    const scored = data.skills.filter((s) => s.score !== null && !s.passed);
    if (scored.length === 0) return null;
    const sorted = [...scored].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
    return sorted[0].id;
  }, [data.skills]);

  // Last 7 days bar chart data
  const last7Days = useMemo(() => data.activityLast28Days.slice(-7), [data.activityLast28Days]);
  const maxWeekMinutes = useMemo(
    () => Math.max(15, ...last7Days.map((d) => d.minutes)),
    [last7Days]
  );

  // Notifications list
  const notifications = useMemo(() => {
    const items: Array<{ id: string; title: string; desc: string; tone: 'amber' | 'red' | 'emerald'; action?: () => void }> = [];
    if (!user) {
      items.push({
        id: 'guest_login',
        title: 'Đăng nhập để lưu chuỗi học & bảng xếp hạng',
        desc: 'Đồng bộ từ đã đánh dấu, lịch sử kiểm tra và streak mỗi ngày.',
        tone: 'amber',
        action: onRequireAuth,
      });
    } else {
      if (data.vocabReview.dueCount > 0) {
        items.push({
          id: 'due_vocab',
          title: `${data.vocabReview.dueCount} từ vựng đang chờ ôn tập`,
          desc: 'Ôn lại nhanh để giữ trí nhớ dài hạn trước khi quên.',
          tone: 'red',
          action: () => onChangeSection('saved_vocab'),
        });
      }
      if (!data.studiedToday) {
        items.push({
          id: 'keep_streak',
          title:
            data.streakDays > 0
              ? `Giữ vững chuỗi ${data.streakDays} ngày hôm nay`
              : 'Bắt đầu chuỗi học ngày đầu tiên hôm nay',
          desc: 'Chỉ cần 1 ván trò chơi hoặc 1 lượt ôn từ để ghi nhận chuyên cần.',
          tone: 'amber',
          action: () => heroLesson && onOpenLesson(heroLesson.lessonId, 'vocab'),
        });
      } else {
        items.push({
          id: 'studied_ok',
          title: `Tuyệt vời! Bạn đã học ${data.today.minutesStudied} phút hôm nay`,
          desc:
            goalPct >= 100
              ? 'Bạn đã hoàn thành mục tiêu ngày hôm nay!'
              : `Còn ${Math.max(1, dailyGoalMinutes - data.today.minutesStudied)} phút nữa đạt mục tiêu ngày.`,
          tone: 'emerald',
        });
      }
    }
    return items;
  }, [user, data, goalPct, dailyGoalMinutes, heroLesson, onOpenLesson, onOpenProfile, onRequireAuth]);

  const handleCycleDailyGoal = () => {
    const idx = DAILY_GOAL_OPTIONS.indexOf(
      dailyGoalMinutes as (typeof DAILY_GOAL_OPTIONS)[number]
    );
    const next = DAILY_GOAL_OPTIONS[(idx + 1) % DAILY_GOAL_OPTIONS.length];
    setDailyGoalMinutes(next);
    localStorage.setItem('cs_daily_goal_minutes', String(next));
  };

  const dailyChecklist = [
    {
      id: 'vocab_today',
      label: 'Ôn / đánh dấu từ vựng hôm nay',
      meta: `${data.today.vocabMarkedToday} từ`,
      done: data.today.vocabMarkedToday > 0,
      onClick: () => heroLesson && onOpenLesson(heroLesson.lessonId, 'vocab'),
    },
    {
      id: 'game_today',
      label: 'Hoàn thành 1 ván trò chơi phản xạ',
      meta: `${data.today.gamesCompleted}/1`,
      done: data.today.gamesCompleted > 0,
      onClick: () => heroLesson && onOpenLesson(heroLesson.lessonId, 'games'),
    },
    {
      id: 'test_today',
      label: 'Hoàn thành 1 bài kiểm tra',
      meta: `${data.today.testsCompleted}/1`,
      done: data.today.testsCompleted > 0,
      onClick: () => heroLesson && onOpenLesson(heroLesson.lessonId, 'test'),
    },
  ];

  const sidebarNavItems = [
    {
      id: 'overview',
      label: 'Tổng quan',
      icon: LayoutDashboard,
      active: activeSection === 'overview',
      onClick: () => onChangeSection('overview'),
    },
    {
      id: 'roadmap',
      label: 'Lộ trình học',
      icon: Compass,
      active: false,
      badge: `${lessons.length}`,
      onClick: () => setShowRoadmapModal(true),
    },
    {
      id: 'practice',
      label: 'Luyện tập / Đề thi',
      icon: Award,
      active: false,
      onClick: onOpenExam,
    },
    {
      id: 'saved',
      label: 'Từ đã đánh dấu',
      icon: Bookmark,
      active: activeSection === 'saved_vocab',
      badge: data.vocabReview.dueCount > 0 ? String(data.vocabReview.dueCount) : undefined,
      onClick: () => (user ? onChangeSection('saved_vocab') : onRequireAuth()),
    },
    {
      id: 'history',
      label: 'Lịch sử làm bài',
      icon: BarChart3,
      active: activeSection === 'history',
      badge: attempts.length > 0 ? String(attempts.length) : undefined,
      onClick: () => (user ? onChangeSection('history') : onRequireAuth()),
    },
  ];

  const renderUserAvatar = (sizeClass = 'w-9 h-9') => {
    if (!user) {
      return (
        <div
          className={`${sizeClass} rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 flex items-center justify-center shrink-0`}
        >
          <UserIcon className="w-4 h-4" />
        </div>
      );
    }
    const preset = getAvatarPreset(user.avatarUrl);
    if (isImageMediaUrl(user.avatarUrl)) {
      return (
        <img
          src={user.avatarUrl!}
          alt={user.displayName}
          className={`${sizeClass} rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0`}
        />
      );
    }
    if (preset) {
      return (
        <div
          className={`${sizeClass} rounded-xl ${preset.gradientClass} text-white chinese-serif font-black text-base flex items-center justify-center shrink-0`}
        >
          {preset.symbol}
        </div>
      );
    }
    return (
      <div
        className={`${sizeClass} rounded-xl bg-gradient-to-br from-red-600 to-amber-500 text-white font-bold text-xs flex items-center justify-center shrink-0`}
      >
        {getInitials(user.displayName)}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#EAEFF5] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* DESKTOP FIXED COLLAPSIBLE SIDEBAR */}
      <aside
        className={`hidden lg:flex flex-col sticky top-0 h-screen bg-[#F8FAFC] dark:bg-slate-900 border-r border-slate-200/90 dark:border-slate-800 transition-[width] duration-200 ease-out shrink-0 z-30 ${
          sidebarCollapsed ? 'w-[76px]' : 'w-[252px]'
        }`}
      >
        <button
          type="button"
          onClick={() => setSidebarCollapsed((c) => !c)}
          className="absolute -right-3.5 top-1/2 -translate-y-1/2 z-40 w-7 h-7 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-md text-slate-500 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-700 flex items-center justify-center transition-colors"
          title={sidebarCollapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
          aria-label={sidebarCollapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>

        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Top Brand */}
          <div className="h-16 px-3 flex items-center border-b border-slate-100 dark:border-slate-800/80 shrink-0">
            <button
              type="button"
              onClick={() => onOpenLesson(heroLesson?.lessonId || currentLessonId, 'vocab')}
              className="w-full flex items-center text-left group"
              title="Đi tới giao diện học chi tiết"
            >
              <span className="w-[51px] shrink-0 flex items-center justify-center">
                <span
                  className={`w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-sm group-hover:scale-105 transition-transform ${
                    isEnglish
                      ? 'bg-gradient-to-br from-indigo-600 to-blue-600'
                      : 'bg-gradient-to-br from-red-600 to-amber-600'
                  }`}
                >
                  <span className={langPack.brandGlyphClass}>{langPack.brandGlyph}</span>
                </span>
              </span>
              <span
                className={`min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-opacity duration-150 ${
                  sidebarCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
                }`}
              >
                <span className="block text-sm font-bold text-slate-900 dark:text-white leading-tight truncate">
                  {langPack.brandTitle}
                </span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {langPack.dashboardBrandSubtitle}
                </span>
              </span>
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto overflow-x-hidden">
            {sidebarNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.onClick}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={`w-full h-10 flex items-center rounded-xl text-xs font-semibold transition-colors ${
                    item.active
                      ? 'bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 shadow-[inset_0_0_0_1px_rgba(220,38,38,0.16)]'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span className="w-[51px] shrink-0 flex items-center justify-center">
                    <Icon className="w-4 h-4" />
                  </span>
                  <span
                    className={`min-w-0 flex-1 flex items-center justify-between gap-2 pr-3 overflow-hidden whitespace-nowrap transition-opacity duration-150 ${
                      sidebarCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
                    }`}
                  >
                    <span className="truncate">{item.label}</span>
                    {item.badge && (
                      <span
                        className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums shrink-0 ${
                          item.id === 'saved'
                            ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}

            {canUseAiAssistant && (
              <button
                type="button"
                onClick={() => onOpenAiDictionary()}
                title={sidebarCollapsed ? 'Từ điển & Trợ lý AI' : undefined}
                className="w-full h-10 flex items-center rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-amber-50/70 dark:hover:bg-amber-950/30 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
              >
                <span className="w-[51px] shrink-0 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                </span>
                <span
                  className={`min-w-0 flex-1 text-left pr-3 overflow-hidden whitespace-nowrap transition-opacity duration-150 ${
                    sidebarCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
                  }`}
                >
                  <span className="truncate block">Từ điển & Trợ lý AI</span>
                </span>
              </button>
            )}

            {canAccessAdmin && (
              <button
                type="button"
                onClick={onOpenAdmin}
                title={sidebarCollapsed ? 'Quản trị hệ thống' : undefined}
                className="w-full h-10 flex items-center rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <span className="w-[51px] shrink-0 flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                </span>
                <span
                  className={`min-w-0 flex-1 text-left pr-3 overflow-hidden whitespace-nowrap transition-opacity duration-150 ${
                    sidebarCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
                  }`}
                >
                  <span className="truncate block">Quản trị hệ thống</span>
                </span>
              </button>
            )}
          </nav>

          {/* Bottom User Profile */}
          <div className="p-3 border-t border-slate-100 dark:border-slate-800 shrink-0">
            {user ? (
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={onOpenProfile}
                  className="min-w-0 flex-1 h-12 flex items-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
                  title="Mở trang cá nhân"
                >
                  <span className="w-[51px] shrink-0 flex items-center justify-center">
                    {renderUserAvatar('w-8 h-8')}
                  </span>
                  <span
                    className={`min-w-0 flex-1 pr-2 overflow-hidden whitespace-nowrap transition-opacity duration-150 ${
                      sidebarCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
                    }`}
                  >
                    <span className="block text-xs font-bold text-slate-900 dark:text-white truncate">
                      {user.displayName}
                    </span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {user.role === 'admin' ? 'Quản trị viên' : 'Học viên'}
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={onLogout}
                  title="Đăng xuất"
                  aria-label="Đăng xuất"
                  className={`shrink-0 h-9 flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-all duration-150 ${
                    sidebarCollapsed
                      ? 'w-0 ml-0 border-0 opacity-0 pointer-events-none overflow-hidden'
                      : 'w-9 ml-1.5 border border-slate-200 dark:border-slate-700 hover:border-red-200 dark:hover:border-red-800 opacity-100'
                  }`}
                >
                  <LogOut className="w-4 h-4 shrink-0" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onRequireAuth}
                className="w-full h-10 flex items-center rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-sm transition-colors"
                title="Đăng nhập"
              >
                <span className="w-[51px] shrink-0 flex items-center justify-center">
                  <LogIn className="w-4 h-4" />
                </span>
                <span
                  className={`min-w-0 flex-1 pr-3 text-left overflow-hidden whitespace-nowrap transition-opacity duration-150 ${
                    sidebarCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
                  }`}
                >
                  Đăng nhập ngay
                </span>
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* MAIN SHELL */}
      <div className="flex-1 min-w-0 flex flex-col pb-20 lg:pb-8">
        {/* TOP HEADER */}
        <header className="sticky top-0 z-20 bg-white/95 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/90 dark:border-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
            {/* Greeting + Date */}
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`lg:hidden w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-sm shrink-0 ${
                  isEnglish
                    ? 'bg-gradient-to-br from-indigo-600 to-blue-600'
                    : 'bg-gradient-to-br from-red-600 to-amber-600'
                }`}
              >
                <span className={langPack.brandGlyphClass}>{langPack.brandGlyph}</span>
              </div>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                  {activeSection === 'saved_vocab'
                    ? 'Từ đã đánh dấu'
                    : activeSection === 'history'
                      ? 'Lịch sử làm bài'
                      : `${greeting}${user ? `, ${user.displayName}` : ''}! Tiếp tục chuỗi học hôm nay nhé`}
                </h1>
                <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">
                  {activeSection === 'saved_vocab'
                    ? 'Sổ tay từ vựng cần ôn tập lại theo từng buổi học'
                    : activeSection === 'history'
                      ? 'Theo dõi kết quả bài kiểm tra tổng hợp và từng buổi học'
                      : formattedDate}
                </p>
              </div>
            </div>

            {/* Right Quick Metrics Cluster */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Streak Pill */}
              <div
                className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 text-amber-700 dark:text-amber-300 text-xs font-bold tabular-nums"
                title={
                  data.studiedToday
                    ? 'Bạn đã hoàn thành hoạt động học hôm nay!'
                    : 'Học ít nhất 1 hoạt động hôm nay để nối tiếp chuỗi'
                }
              >
                <Flame
                  className={`w-4 h-4 ${
                    data.streakDays > 0 ? 'text-amber-500 fill-amber-500/20' : 'text-amber-400'
                  }`}
                />
                <span>{data.streakDays}</span>
                <span className="hidden sm:inline font-semibold">ngày</span>
              </div>

              {/* Daily Goal Pill */}
              <button
                type="button"
                onClick={handleCycleDailyGoal}
                className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold tabular-nums transition"
                title="Bấm để đổi mục tiêu học mỗi ngày (15 / 30 / 45 / 60 phút)"
              >
                <Target className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                <span>
                  {data.today.minutesStudied}/{dailyGoalMinutes} phút
                </span>
              </button>

              {/* Quick Search */}
              <button
                type="button"
                onClick={onOpenSearch}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition"
                title="Tìm từ vựng nhanh (Ctrl+K)"
              >
                <Search className="w-4 h-4" />
              </button>

              {/* Dark mode toggle */}
              <button
                type="button"
                onClick={onToggleDarkMode}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition"
                title="Chuyển giao diện Sáng / Tối"
              >
                {darkMode ? (
                  <Sun className="w-4 h-4 text-amber-400" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </button>

              {/* Notifications Popover */}
              <div className="relative" ref={notifRef}>
                <button
                  type="button"
                  onClick={() => setShowNotifPopover((v) => !v)}
                  className="relative p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition"
                  title="Thông báo & nhắc ôn tập"
                >
                  <Bell className="w-4 h-4" />
                  {notifications.some((n) => n.tone !== 'emerald') && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-600 ring-2 ring-white dark:ring-slate-900" />
                  )}
                </button>

                {showNotifPopover && (
                  <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl p-3 space-y-2 z-40">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        Nhắc nhở học tập
                      </span>
                      <span className="text-[11px] text-slate-400">Hôm nay</span>
                    </div>
                    <div className="space-y-1.5">
                      {notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            setShowNotifPopover(false);
                            n.action?.();
                          }}
                          className="w-full text-left p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 transition flex items-start gap-2.5"
                        >
                          <span
                            className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                              n.tone === 'red'
                                ? 'bg-red-500'
                                : n.tone === 'amber'
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 dark:text-white">
                              {n.title}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {n.desc}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* BENTO GRID / DEDICATED SECTION MAIN CONTENT */}
        <main className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          {activeSection === 'saved_vocab' ? (
            user ? (
              <SavedVocabPanel
                lang={lang}
                userId={user.id}
                lessons={lessons}
                onToggleMarked={onToggleMarked}
                onOpenLesson={(lessonId, tab) => onOpenLesson(lessonId, tab)}
                onOpenWriter={isEnglish ? undefined : onOpenWriter}
                onOpenAiDictionary={canUseAiAssistant ? onOpenAiDictionary : undefined}
              />
            ) : (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-3">
                <Bookmark className="w-8 h-8 text-amber-500 mx-auto" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Đăng nhập để xem Từ đã đánh dấu
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Danh sách từ đánh dấu được lưu đồng bộ theo tài khoản của bạn.
                </p>
                <button
                  type="button"
                  onClick={onRequireAuth}
                  className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-sm transition"
                >
                  Đăng nhập ngay
                </button>
              </div>
            )
          ) : activeSection === 'history' ? (
            user ? (
              <TestHistoryPanel
                lang={lang}
                userId={user.id}
                lessons={lessons}
                attempts={attempts}
                onOpenLesson={(lessonId, tab) => onOpenLesson(lessonId, tab)}
                onOpenExam={onOpenExam}
              />
            ) : (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-3">
                <BarChart3 className="w-8 h-8 text-red-500 mx-auto" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Đăng nhập để xem Lịch sử làm bài
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Điểm số và chi tiết các lượt kiểm tra được lưu theo tài khoản của bạn.
                </p>
                <button
                  type="button"
                  onClick={onRequireAuth}
                  className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-sm transition"
                >
                  Đăng nhập ngay
                </button>
              </div>
            )
          ) : (
          <>
          {/* Friendly New-User / Guest Onboarding Banner */}
          {isBrandNewUser && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-red-200/80 dark:border-red-900/50 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex items-start gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    isEnglish
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
                      : 'bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400'
                  }`}
                >
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    {user
                      ? isEnglish
                        ? 'Chào mừng bạn bắt đầu hành trình chinh phục tiếng Anh!'
                        : 'Chào mừng bạn bắt đầu hành trình chinh phục tiếng Trung!'
                      : isEnglish
                        ? 'Khám phá lộ trình CEFR A1 cùng English Studio'
                        : 'Khám phá lộ trình HSK cùng 汉语学堂'}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {user
                      ? 'Bạn chưa có lịch sử học tập nào. Hãy hoàn thành 5 phút đầu tiên với Bài 1 để mở khóa chuỗi streak và biểu đồ tiến độ.'
                      : 'Bạn đang xem ở chế độ khách. Đăng nhập để lưu từ vựng đánh dấu, theo dõi chuỗi ngày học và lên bảng xếp hạng.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!user && (
                  <button
                    type="button"
                    onClick={onRequireAuth}
                    className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-sm transition"
                  >
                    Đăng nhập ngay
                  </button>
                )}
                {heroLesson && (
                  <button
                    type="button"
                    onClick={() => onOpenLesson(heroLesson.lessonId, 'vocab')}
                    className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 transition"
                  >
                    Bắt đầu Bài 1
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ROW 1: HERO CARD (2/3) + TODAY GOAL (1/3) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* 1. HERO CARD — TIẾP TỤC BÀI ĐANG HỌC */}
            <section className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-[0_2px_8px_rgba(15,23,42,0.04)] p-6 flex flex-col justify-between gap-6 relative overflow-hidden group hover:border-red-300 dark:hover:border-red-800/80 transition">
              <div className="pointer-events-none absolute -top-20 -right-20 w-64 h-64 rounded-full bg-gradient-to-br from-red-500/10 via-amber-500/5 to-transparent blur-2xl" />

              {loading && (
                <div className="absolute inset-0 z-20 bg-white/80 dark:bg-slate-900/80 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2.5 pop-in">
                  <LoadingSpinner size="md" />
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Đang tải tiến độ bài học...
                  </p>
                </div>
              )}

              <div className="space-y-4 relative">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    {heroLesson &&
                      (heroLesson.attemptCount > 0 ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 text-[11px] font-bold uppercase tracking-wider">
                          <BookOpen className="w-3.5 h-3.5" />
                          Tiếp tục bài đang học
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[11px] font-bold uppercase tracking-wider">
                          <BookOpen className="w-3.5 h-3.5" />
                          Chưa kiểm tra
                        </span>
                      ))}
                  </div>

                  <div className="flex items-center gap-2">
                    {loading && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500 flex-shrink-0" />
                    )}
                    <select
                      value={currentLessonId || heroLesson?.lessonId || ''}
                      disabled={loading}
                      onChange={(e) => onSelectLesson?.(e.target.value)}
                      aria-label="Chọn bài học để xem tiến độ kiểm tra"
                      className="max-w-[220px] sm:max-w-[270px] truncate px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-red-500 cursor-pointer disabled:opacity-60 transition"
                      title="Đổi bài học để xem tiến độ kiểm tra & kỹ năng"
                    >
                      {lessons.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {loading && !dashboard ? (
                  <div className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
                ) : heroLesson ? (
                  <>
                    <div>
                      <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                        {heroLesson.title}
                      </h2>
                      <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500 dark:text-slate-400 mt-2 tabular-nums">
                        <span>{heroLesson.vocabCount} từ vựng</span>
                        <span>•</span>
                        <span>{heroLesson.grammarCount} điểm ngữ pháp</span>
                        <span>•</span>
                        <span>{heroLesson.textCount} bài hội thoại</span>
                      </div>
                    </div>

                    {/* Progress bar + Mốc >70% Đạt */}
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-600 dark:text-slate-300">
                            Tiến độ kiểm tra bài học
                          </span>
                          {heroLesson.passed ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[10px] font-bold">
                              <Check className="w-3 h-3 stroke-[3]" /> Đạt (&gt;{heroLesson.passThreshold}%)
                            </span>
                          ) : heroLesson.attemptCount > 0 ? (
                            <span className="px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-800/80 text-[10px] font-bold">
                              Chưa đạt • Cần &gt;{heroLesson.passThreshold}%
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-semibold">
                              Chưa kiểm tra • Mốc đạt &gt;{heroLesson.passThreshold}%
                            </span>
                          )}
                        </div>
                        <span
                          className={`font-extrabold tabular-nums ${
                            heroLesson.passed
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-slate-900 dark:text-white'
                          }`}
                        >
                          {heroLesson.progressPercent}%
                        </span>
                      </div>

                      <div className="relative h-2.5 w-full rounded-full bg-slate-200/85 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            heroLesson.passed
                              ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                              : heroLesson.progressPercent >= 45
                                ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                                : 'bg-gradient-to-r from-red-600 to-rose-500'
                          }`}
                          style={{
                            width: `${
                              heroLesson.progressPercent > 0
                                ? Math.max(heroLesson.progressPercent, 3)
                                : 0
                            }%`,
                          }}
                        />
                        {/* Vạch mốc đạt 70% */}
                        <div
                          className="absolute top-0 bottom-0 w-0.5 bg-slate-400/80 dark:bg-slate-400/70"
                          style={{ left: `${heroLesson.passThreshold}%` }}
                          title={`Mốc đạt: > ${heroLesson.passThreshold}%`}
                        />
                      </div>
                    </div>

                    {/* Gộp 4 kỹ năng của bài kiểm tra bài học này */}
                    <div className="pt-1 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="font-semibold">
                          Tỷ lệ điểm theo kỹ năng (bấm vào kỹ năng yếu để ôn bổ trợ)
                        </span>
                        {heroLesson.attemptCount > 0 && (
                          <span className="tabular-nums">
                            {heroLesson.attemptCount} lượt thi
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {data.skills.map((skill) => {
                          const scoreVal = skill.score ?? 0;
                          const isWeakest =
                            heroLesson.attemptCount > 0 &&
                            weakestSkillId === skill.id &&
                            !skill.passed;
                          const barColor =
                            skill.score === null
                              ? 'bg-slate-300 dark:bg-slate-700'
                              : skill.passed
                                ? 'bg-emerald-500'
                                : scoreVal >= 45
                                  ? 'bg-amber-500'
                                  : 'bg-rose-500';
                          return (
                            <button
                              key={skill.id}
                              type="button"
                              onClick={() => onOpenLesson(skill.targetLessonId, skill.targetTab)}
                              className={`w-full text-left p-3 rounded-xl border transition group/skill ${
                                isWeakest
                                  ? 'bg-rose-50/80 dark:bg-rose-950/25 border-rose-200/90 dark:border-rose-900/60 hover:border-rose-400'
                                  : skill.passed
                                    ? 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200/90 dark:border-emerald-900/50 hover:border-emerald-400'
                                    : 'bg-slate-50/90 dark:bg-slate-800/40 border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-600'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                    {skill.label}
                                  </span>
                                  {skill.passed ? (
                                    <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold shrink-0">
                                      Đạt
                                    </span>
                                  ) : isWeakest ? (
                                    <span className="px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 text-[10px] font-bold shrink-0">
                                      Cần củng cố
                                    </span>
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100 tabular-nums">
                                    {skill.score !== null ? `${skill.score}%` : '—'}
                                  </span>
                                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover/skill:text-red-600 group-hover/skill:translate-x-0.5 transition" />
                                </div>
                              </div>
                              <div className="relative h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-slate-700/70 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                                  style={{
                                    width: `${
                                      skill.score !== null && skill.score > 0
                                        ? Math.max(skill.score, 4)
                                        : 0
                                    }%`,
                                  }}
                                />
                                <div
                                  className="absolute top-0 bottom-0 w-px bg-slate-400/80"
                                  style={{ left: '70%' }}
                                />
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                                {skill.detail}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">Chưa có bài học nào trong giáo trình.</p>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-slate-100 dark:border-slate-800/80 relative">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <button
                    type="button"
                    disabled={!heroLesson}
                    onClick={() => heroLesson && onOpenLesson(heroLesson.lessonId, 'vocab')}
                    className={`px-5 py-2.5 rounded-xl disabled:opacity-50 text-white text-sm font-bold shadow-sm hover:shadow-md inline-flex items-center gap-2 transition active:scale-[0.98] ${
                      isEnglish
                        ? 'bg-indigo-600 hover:bg-indigo-700'
                        : 'bg-red-600 hover:bg-red-700'
                    }`}
                  >
                    <Play className="w-4 h-4 fill-current" />
                    {heroLesson && heroLesson.attemptCount > 0 ? 'Học tiếp ngay' : 'Bắt đầu học ngay'}
                  </button>
                  {heroLesson && (
                    <button
                      type="button"
                      onClick={() => onOpenLesson(heroLesson.lessonId, 'test')}
                      className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition"
                    >
                      Kiểm tra bài này
                    </button>
                  )}
                </div>

                <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  Lộ trình:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {data.overallProgress.completedLessons}/{data.overallProgress.totalLessons}
                  </strong>{' '}
                  bài đạt
                </div>
              </div>
            </section>

            {/* 2. THẺ "MỤC TIÊU HÔM NAY" (PROGRESS RING + CHECKLIST) */}
            <section className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-[0_2px_8px_rgba(15,23,42,0.04)] p-6 flex flex-col justify-between gap-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Target className="w-4 h-4 text-red-600" />
                  Mục tiêu hôm nay
                </h3>
                <button
                  type="button"
                  onClick={handleCycleDailyGoal}
                  className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 tabular-nums transition"
                  title="Đổi mục tiêu ngày"
                >
                  {dailyGoalMinutes} phút/ngày
                </button>
              </div>

              {/* Ring + Summary */}
              <div className="flex items-center gap-4">
                <div className="relative w-28 h-28 shrink-0">
                  <svg className="w-28 h-28 -rotate-90" viewBox="0 0 112 112">
                    <circle
                      cx="56"
                      cy="56"
                      r={ringRadius}
                      fill="none"
                      strokeWidth="9"
                      className="stroke-slate-200/90 dark:stroke-slate-800"
                    />
                    <circle
                      cx="56"
                      cy="56"
                      r={ringRadius}
                      fill="none"
                      strokeWidth="9"
                      strokeLinecap="round"
                      strokeDasharray={ringCircumference}
                      strokeDashoffset={ringDashOffset}
                      className={`transition-all duration-700 ${
                        goalPct >= 100 ? 'stroke-emerald-500' : 'stroke-red-600'
                      }`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center tabular-nums">
                    <span className="text-xl font-extrabold text-slate-900 dark:text-white leading-none">
                      {data.today.minutesStudied}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-400 mt-1">
                      / {dailyGoalMinutes} phút
                    </span>
                  </div>
                </div>

                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-bold text-slate-900 dark:text-white tabular-nums">
                    {goalPct >= 100 ? 'Hoàn thành xuất sắc!' : `Đạt ${goalPct}% mục tiêu`}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    {goalPct >= 100
                      ? 'Bạn đã hoàn tất thời lượng học hôm nay.'
                      : `Thêm ${Math.max(
                          1,
                          dailyGoalMinutes - data.today.minutesStudied
                        )} phút nữa để hoàn thành vòng tròn hôm nay.`}
                  </p>
                </div>
              </div>

              {/* Mini Daily Checklists */}
              <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                {dailyChecklist.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={task.onClick}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/70 transition text-left"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                          task.done
                            ? 'bg-emerald-500 text-white'
                            : 'border border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {task.done && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </span>
                      <span
                        className={`text-xs truncate ${
                          task.done
                            ? 'line-through text-slate-400 dark:text-slate-500'
                            : 'text-slate-700 dark:text-slate-200 font-medium'
                        }`}
                      >
                        {task.label}
                      </span>
                    </span>
                    <span className="text-[11px] font-semibold text-slate-400 tabular-nums shrink-0">
                      {task.meta}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          {/* ROW 2: ACTIVITY HEATMAP / WEEKLY CHART (FULL WIDTH) */}
          <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-[0_2px_8px_rgba(15,23,42,0.04)] p-6 space-y-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Lịch sử chuyên cần
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                    Chuỗi hiện tại:{' '}
                    <strong className="text-amber-600 dark:text-amber-400">
                      {data.streakDays} ngày
                    </strong>{' '}
                    • Kỷ lục:{' '}
                    <strong className="text-slate-800 dark:text-slate-200">
                      {data.bestStreakDays} ngày
                    </strong>
                  </p>
                </div>

                <div className="inline-flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-[11px] font-semibold">
                  <button
                    type="button"
                    onClick={() => setActivityView('week')}
                    className={`px-2.5 py-1 rounded-lg transition ${
                      activityView === 'week'
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    7 ngày gần nhất
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivityView('heatmap')}
                    className={`px-2.5 py-1 rounded-lg transition ${
                      activityView === 'heatmap'
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    Heatmap 28 ngày
                  </button>
                </div>
              </div>

              {activityView === 'week' ? (
                <div className="grid grid-cols-7 gap-2 sm:gap-4 items-end pt-2">
                  {last7Days.map((day, idx) => {
                    const isToday = idx === last7Days.length - 1;
                    const barHeightPct =
                      day.minutes > 0
                        ? Math.max(16, Math.round((day.minutes / maxWeekMinutes) * 100))
                        : 8;
                    return (
                      <div key={day.date} className="flex flex-col items-center gap-2 justify-end">
                        <span className="h-4 text-[11px] font-bold text-slate-600 dark:text-slate-300 tabular-nums">
                          {day.minutes > 0 ? `${day.minutes}p` : ''}
                        </span>
                        <div className="w-full max-w-[44px] h-28 flex items-end rounded-t-xl bg-slate-100/80 dark:bg-slate-800/40 p-0.5">
                          <div
                            title={`${formatDayMonth(day.date)}: ${day.minutes} phút (${day.count} hoạt động)`}
                            className={`w-full rounded-t-lg rounded-b-sm transition-all duration-500 ${
                              day.minutes > 0
                                ? isToday
                                  ? 'bg-gradient-to-t from-red-600 to-amber-500 shadow-sm'
                                  : 'bg-red-500/85 dark:bg-red-500/75 hover:bg-red-600'
                                : 'bg-slate-200/80 dark:bg-slate-700/60'
                            }`}
                            style={{ height: `${barHeightPct}%` }}
                          />
                        </div>
                        <div className="text-center leading-tight">
                          <div
                            className={`text-[11px] font-bold ${
                              isToday
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            {formatShortWeekday(day.date)}
                          </div>
                          <div className="text-[10px] text-slate-400 tabular-nums">
                            {formatDayMonth(day.date)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-7 sm:grid-cols-[repeat(14,minmax(0,1fr))] gap-2">
                    {data.activityLast28Days.map((day) => {
                      const levelClass =
                        day.level === 0
                          ? 'bg-slate-100 dark:bg-slate-800 border-slate-200/70 dark:border-slate-700/60'
                          : day.level === 1
                            ? 'bg-emerald-200 dark:bg-emerald-900/60 border-emerald-300 dark:border-emerald-800'
                            : day.level === 2
                              ? 'bg-emerald-400 dark:bg-emerald-700 border-emerald-500 dark:border-emerald-600'
                              : day.level === 3
                                ? 'bg-emerald-500 dark:bg-emerald-500 border-emerald-600'
                                : 'bg-emerald-600 dark:bg-emerald-400 border-emerald-700';
                      return (
                        <div
                          key={day.date}
                          title={`${formatDayMonth(day.date)}: ${day.count} hoạt động (${day.minutes} phút)`}
                          className={`h-9 sm:h-10 rounded-lg border flex items-center justify-center text-[10px] font-semibold tabular-nums transition hover:scale-105 ${levelClass} ${
                            day.level >= 2 ? 'text-white dark:text-slate-950' : 'text-slate-400'
                          }`}
                        >
                          {day.date.slice(-2)}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                    <span>4 tuần gần đây</span>
                    <div className="flex items-center gap-1.5">
                      <span>Ít</span>
                      <span className="w-3 h-3 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700" />
                      <span className="w-3 h-3 rounded bg-emerald-200 dark:bg-emerald-900/60" />
                      <span className="w-3 h-3 rounded bg-emerald-400 dark:bg-emerald-700" />
                      <span className="w-3 h-3 rounded bg-emerald-600 dark:bg-emerald-400" />
                      <span>Nhiều</span>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </>
          )}
          {langPack.attribution && (
            <p className="text-center text-[11px] text-slate-400 dark:text-slate-500 pt-2">
              {langPack.attribution}
            </p>
          )}
        </main>
      </div>

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 px-2 py-1.5">
        <div className="grid grid-cols-5 gap-1">
          {[
            {
              id: 'm-overview',
              label: 'Tổng quan',
              icon: LayoutDashboard,
              active: activeSection === 'overview',
              onClick: () => onChangeSection('overview'),
            },
            {
              id: 'm-roadmap',
              label: 'Lộ trình',
              icon: Compass,
              active: false,
              onClick: () => setShowRoadmapModal(true),
            },
            {
              id: 'm-saved',
              label: 'Từ đã lưu',
              icon: Bookmark,
              active: activeSection === 'saved_vocab',
              onClick: () => (user ? onChangeSection('saved_vocab') : onRequireAuth()),
            },
            {
              id: 'm-history',
              label: 'Lịch sử',
              icon: BarChart3,
              active: activeSection === 'history',
              onClick: () => (user ? onChangeSection('history') : onRequireAuth()),
            },
            {
              id: 'm-profile',
              label: user ? 'Hồ sơ' : 'Đăng nhập',
              icon: UserIcon,
              active: false,
              onClick: () => (user ? onOpenProfile() : onRequireAuth()),
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={item.onClick}
                className={`flex flex-col items-center justify-center py-1.5 rounded-xl text-[10px] font-semibold transition ${
                  item.active
                    ? 'text-red-600 dark:text-red-400 bg-red-50/70 dark:bg-red-950/40'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="w-4 h-4 mb-0.5" />
                <span className="truncate max-w-full">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* LESSON ROADMAP PICKER MODAL */}
      {showRoadmapModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowRoadmapModal(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[82vh] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-red-600" />
                  Lộ trình bài học ({lessons.length} bài)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Chọn bài bất kỳ để mở ngay giáo trình tương ứng.
                </p>
              </div>
              <ModalCloseButton onClick={() => setShowRoadmapModal(false)} />
            </div>

            <div className="p-4 overflow-y-auto space-y-2">
              {lessons.map((l) => {
                const isCurrent = l.id === currentLessonId;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => {
                      setShowRoadmapModal(false);
                      onOpenLesson(l.id, 'vocab');
                    }}
                    className={`w-full text-left p-3.5 rounded-xl border transition flex items-center justify-between gap-3 ${
                      isCurrent
                        ? 'bg-red-50/70 dark:bg-red-950/30 border-red-300 dark:border-red-800'
                        : 'bg-slate-50/60 dark:bg-slate-800/40 border-slate-200/70 dark:border-slate-800 hover:border-red-300 dark:hover:border-red-700'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {l.title}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                          {l.hskLevel}
                        </span>
                        {isCurrent && (
                          <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold">
                            Đang chọn
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                        {l.vocabCount} từ vựng • {l.grammarCount} ngữ pháp • {l.textCount} bài khóa
                      </div>
                    </div>
                    <CheckCircle2
                      className={`w-4 h-4 shrink-0 ${
                        isCurrent ? 'text-red-600' : 'text-slate-300 dark:text-slate-600'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
