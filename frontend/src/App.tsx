import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  Bookmark,
  Edit3,
  Gamepad2,
  GitBranch,
  Headphones,
  Layers,
  LayoutDashboard,
  Lock,
  LogIn,
  LogOut,
  Moon,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { api, getStoredToken, setStoredToken } from './lib/api';
import { hasPermission, isSuperAdminUser, PERMISSIONS } from './lib/permissions';
import { getAvatarPreset, isImageMediaUrl } from './lib/profileMedia';
import { AdminRbacPage } from './components/AdminRbacPage';
import { AiAssistantModal } from './components/AiAssistantModal';
import { AuthModal } from './components/AuthModal';
import { ConfirmDeleteModal } from './components/ConfirmDeleteModal';
import { DashboardPage } from './components/DashboardPage';
import { LoadingCard, LoadingScreen } from './components/common/LoadingState';
import { GamesSection } from './components/GamesSection';
import { GlobalSearchModal } from './components/GlobalSearchModal';
import { GrammarSection } from './components/GrammarSection';
import { HanziWriterModal } from './components/HanziWriterModal';
import { HeaderExtensionMenu } from './components/HeaderExtensionMenu';
import { LessonModal } from './components/LessonModal';
import { ProfilePage } from './components/ProfilePage';
import { TestSection } from './components/TestSection';
import { TextsSection } from './components/TextsSection';
import { VocabSection } from './components/VocabSection';
import type {
  ComprehensiveExamResponse,
  LessonDetail,
  LessonSummary,
  MarkedVocabRecord,
  TabId,
  TestAttemptRecord,
  UserProfile,
  VocabularyItem,
} from './types';

type AppView = 'dashboard' | 'saved_vocab' | 'history' | 'study' | 'profile' | 'exam' | 'admin';

function getViewFromPath(): AppView {
  if (typeof window !== 'undefined') {
    const p = window.location.pathname.replace(/\/+$/, '');
    if (p === '/study') return 'study';
    if (p === '/saved-vocab') return 'saved_vocab';
    if (p === '/history') return 'history';
    if (p === '/profile') return 'profile';
    if (p === '/exam') return 'exam';
    if (p === '/admin') return 'admin';
    if (p === '/dashboard') return 'dashboard';
  }
  return 'dashboard';
}

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('cs_dark_mode') === 'true';
  });

  const [user, setUser] = useState<UserProfile | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [authChecked, setAuthChecked] = useState<boolean>(() => !getStoredToken());
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [currentLessonId, setCurrentLessonId] = useState<string>(
    () => localStorage.getItem('cs_current_lesson') || 'lesson-1'
  );
  const [currentLesson, setCurrentLesson] = useState<LessonDetail | null>(null);
  const [activeView, setActiveView] = useState<AppView>(() =>
    getViewFromPath()
  );
  const [activeTab, setActiveTab] = useState<TabId>('vocab');
  const [loadingLesson, setLoadingLesson] = useState(false);
  const [comprehensiveExam, setComprehensiveExam] = useState<ComprehensiveExamResponse | null>(null);
  const [selectedExamLessonIds, setSelectedExamLessonIds] = useState<string[] | null>(null);
  const [loadingExam, setLoadingExam] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [markedMap, setMarkedMap] = useState<Record<string, MarkedVocabRecord>>({});
  const [attempts, setAttempts] = useState<TestAttemptRecord[]>([]);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiInitialTab, setAiInitialTab] = useState<'dictionary' | 'chat'>('dictionary');
  const [aiInitialQuery, setAiInitialQuery] = useState('');
  const [writerVocab, setWriterVocab] = useState<VocabularyItem | null>(null);
  const [lessonModalMode, setLessonModalMode] = useState<'create' | 'edit' | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingLesson, setDeletingLesson] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('cs_dark_mode', String(darkMode));
  }, [darkMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSearchModal(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const refreshLessons = async () => {
    const res = await api.listLessons();
    setLessons(res.lessons);
    if (res.lessons.length > 0 && !res.lessons.some((l) => l.id === currentLessonId)) {
      setCurrentLessonId(res.lessons[0].id);
    }
  };

  const refreshUserProgress = async () => {
    const progRes = await api.getProgress();
    setMarkedMap(progRes.markedMap);
    setAttempts(progRes.attempts);
  };

  const refreshCurrentUserProfile = async () => {
    if (!getStoredToken()) return;
    try {
      const me = await api.me();
      setUser(me.user);
    } catch {
      // Bỏ qua nếu phiên đã hết hạn
    }
  };

  const navigateView = (nextView: AppView, replace = false) => {
    setActiveView(nextView);
    const targetPath =
      nextView === 'study'
        ? '/study'
        : nextView === 'saved_vocab'
        ? '/saved-vocab'
        : nextView === 'history'
        ? '/history'
        : nextView === 'profile'
        ? '/profile'
        : nextView === 'exam'
        ? '/exam'
        : nextView === 'admin'
        ? '/admin'
        : '/';
    if (window.location.pathname !== targetPath) {
      if (replace) window.history.replaceState(null, '', targetPath);
      else window.history.pushState(null, '', targetPath);
    }
  };

  const effectiveExamLessonIds = useMemo(
    () => (selectedExamLessonIds === null ? lessons.map((l) => l.id) : selectedExamLessonIds),
    [selectedExamLessonIds, lessons]
  );

  const canAccessAdmin = hasPermission(user, [
    PERMISSIONS.MENU_ADMIN,
    PERMISSIONS.USER_MANAGE,
    PERMISSIONS.ROLE_MANAGE,
  ]);
  const canCreateCustomLesson = hasPermission(user, PERMISSIONS.LESSON_CUSTOM_CRUD);
  const canCreateSystemLesson = hasPermission(user, PERMISSIONS.LESSON_SYSTEM_CREATE);
  const canCreateAnyLesson = !user || canCreateCustomLesson || canCreateSystemLesson;
  const canUseAiAssistant = !user || hasPermission(user, PERMISSIONS.AI_ASSISTANT_USE);
  const canTakeExam = Boolean(user && hasPermission(user, PERMISSIONS.EXAM_TAKE));
  const canShowExamEntry = !user || canTakeExam;
  const canPlayGames = Boolean(user);
  const canBookmarkVocab = Boolean(user && hasPermission(user, PERMISSIONS.VOCAB_BOOKMARK));

  const loadComprehensiveExam = async (lessonIdsOverride?: string[]) => {
    if (!canTakeExam) return;
    const targetIds = lessonIdsOverride ?? effectiveExamLessonIds;
    if (selectedExamLessonIds !== null && targetIds.length === 0) {
      setComprehensiveExam({
        id: 'comprehensive_empty',
        title: 'Kiểm tra tổng hợp (0 bài)',
        hskLevel: 'HSK 1 - HSK 3',
        description: 'Vui lòng chọn ít nhất 1 buổi học trong danh sách để bốc câu hỏi ngẫu nhiên.',
        questions: [],
      });
      return;
    }

    setLoadingExam(true);
    setErrorMsg(null);
    try {
      const res = await api.getComprehensiveExam(targetIds.length > 0 ? targetIds : undefined);
      setComprehensiveExam(res.exam);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không tải được đề kiểm tra tổng hợp');
    } finally {
      setLoadingExam(false);
    }
  };

  const openComprehensiveExam = () => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    if (!canTakeExam) {
      setErrorMsg('Tài khoản của bạn hiện không có quyền làm bài kiểm tra.');
      return;
    }
    setComprehensiveExam(null);
    navigateView('exam');
    void loadComprehensiveExam(effectiveExamLessonIds);
  };

  useEffect(() => {
    const onPopState = () => setActiveView(getViewFromPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (
      authChecked &&
      canTakeExam &&
      activeView === 'exam' &&
      !comprehensiveExam &&
      !loadingExam &&
      lessons.length > 0
    ) {
      void loadComprehensiveExam(effectiveExamLessonIds);
    }
  }, [authChecked, canTakeExam, activeView, lessons.length]);

  const openAiAssistant = (tab: 'dictionary' | 'chat' = 'dictionary', query = '') => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    if (!hasPermission(user, PERMISSIONS.AI_ASSISTANT_USE)) {
      setErrorMsg('Tài khoản của bạn hiện không có quyền sử dụng Trợ lý AI & Từ điển.');
      return;
    }
    setAiInitialTab(tab);
    setAiInitialQuery(query);
    setShowAiModal(true);
  };

  useEffect(() => {
    if (!authChecked) return;
    if (activeView === 'profile' && !user) {
      navigateView('dashboard', true);
    } else if (activeView === 'admin' && !canAccessAdmin) {
      navigateView('dashboard', true);
    } else if (activeView === 'exam' && user && !canTakeExam) {
      navigateView('dashboard', true);
    }
  }, [authChecked, activeView, user, canAccessAdmin, canTakeExam]);

  useEffect(() => {
    const init = async () => {
      try {
        await api.health();

        const token = getStoredToken();
        if (token) {
          try {
            const me = await api.me();
            setUser(me.user);
            await refreshUserProgress();
          } catch {
            setStoredToken(null);
          }
        }
        await refreshLessons();
      } catch (err) {
        setErrorMsg(
          `Không kết nối được Backend API (${(err as Error).message}). Hãy chạy backend trước.`
        );
      } finally {
        setAuthChecked(true);
        setInitializing(false);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (!currentLessonId) return;
    localStorage.setItem('cs_current_lesson', currentLessonId);
    setLoadingLesson(true);
    api
      .getLesson(currentLessonId)
      .then((res) => {
        setCurrentLesson(res.lesson);
        setErrorMsg(null);
      })
      .catch((err) => {
        setErrorMsg((err as Error).message);
      })
      .finally(() => setLoadingLesson(false));
  }, [currentLessonId, user?.id]);

  const groupedLessons = useMemo(() => {
    const groups: Record<string, LessonSummary[]> = {};
    lessons.forEach((l) => {
      const unit = l.unit || 'Chung';
      if (!groups[unit]) groups[unit] = [];
      groups[unit].push(l);
    });
    return groups;
  }, [lessons]);

  const handleAuthSuccess = async (token: string, loggedUser: UserProfile) => {
    setStoredToken(token);
    setUser(loggedUser);
    setShowAuthModal(false);

    await Promise.all([refreshUserProgress(), refreshLessons()]);
  };

  const handleLogout = () => {
    setStoredToken(null);
    setUser(null);
    setComprehensiveExam(null);
    setMarkedMap({});
    setAttempts([]);
    refreshLessons();
  };

  const handleToggleMarked = async (vocabId: string) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    if (!canBookmarkVocab) {
      setErrorMsg('Tài khoản của bạn hiện không có quyền đánh dấu từ vựng.');
      return;
    }

    const isMarked = Boolean(markedMap[vocabId]);
    const nextMarked = !isMarked;

    const res = await api.toggleMarkVocab({ vocabId, marked: nextMarked });
    setMarkedMap((prev) => {
      const copy = { ...prev };
      if (res.marked && res.record) copy[vocabId] = res.record;
      else delete copy[vocabId];
      return copy;
    });
  };

  const handleSaveTestAttempt = async (payload: {
    lessonId: string | null;
    examTitle?: string | null;
    score: number;
    totalQuestions: number;
    correctCount: number;
    durationSeconds: number;
    answers: Record<string, number>;
  }) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    const resolvedTitle =
      payload.examTitle || currentLesson?.title || payload.lessonId || 'Kiểm tra tổng hợp (26 bài)';
    const res = await api.submitTestAttempt(payload);
    setAttempts((prev) => [
      { ...res.attempt, lessonTitle: res.attempt.lessonTitle || resolvedTitle },
      ...prev,
    ]);
  };

  const handleSaveLesson = async (payload: {
    title: string;
    hskLevel: string;
    unit?: string;
    description?: string;
    vocabulary: any[];
    grammar: any[];
    isSystem?: boolean;
  }) => {
    if (lessonModalMode === 'edit' && currentLesson) {
      const res = await api.updateLesson(currentLesson.id, payload);
      setCurrentLesson(res.lesson);
    } else {
      const res = await api.createLesson(payload);
      setCurrentLessonId(res.lesson.id);
      setCurrentLesson(res.lesson);
    }
    await refreshLessons();
  };

  const canEditCurrent = Boolean(
    user &&
      currentLesson &&
      (currentLesson.isSystem
        ? hasPermission(user, PERMISSIONS.LESSON_SYSTEM_EDIT)
        : isSuperAdminUser(user) ||
          (currentLesson.ownerId === user.id && canCreateCustomLesson))
  );

  const canDeleteCurrent = Boolean(
    user &&
      currentLesson &&
      (currentLesson.isSystem
        ? hasPermission(user, PERMISSIONS.LESSON_SYSTEM_DELETE)
        : isSuperAdminUser(user) ||
          (currentLesson.ownerId === user.id && canCreateCustomLesson))
  );

  const handleDeleteCurrentLesson = () => {
    if (!currentLesson || !canDeleteCurrent) return;
    setDeleteError(null);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDeleteLesson = async () => {
    if (!currentLesson || !canDeleteCurrent || deletingLesson) return;
    setDeletingLesson(true);
    setDeleteError(null);
    try {
      await api.deleteLesson(currentLesson.id);
      setShowDeleteConfirm(false);
      await refreshLessons();
    } catch (err) {
      setDeleteError((err as Error).message || 'Không thể xoá buổi học. Vui lòng thử lại.');
    } finally {
      setDeletingLesson(false);
    }
  };

  const renderFeatureAccessGate = (
    title: string,
    description: string,
    backLabel: string,
    onBack: () => void
  ) => (
    <div className="max-w-xl mx-auto bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 p-8 text-center space-y-4 shadow-sm">
      <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 mx-auto flex items-center justify-center border border-red-200/80 dark:border-red-900/50">
        <Lock className="w-6 h-6" />
      </div>
      <div className="space-y-1.5">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
        <p className="text-xs text-gray-600 dark:text-slate-400 leading-relaxed">{description}</p>
      </div>
      <div className="flex items-center justify-center gap-2.5 flex-wrap pt-1">
        {!user && (
          <button
            type="button"
            onClick={() => setShowAuthModal(true)}
            className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition"
          >
            <LogIn className="w-3.5 h-3.5" /> Đăng nhập / Đăng ký
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2.5 rounded-xl border border-stone-200 dark:border-slate-700 text-xs font-semibold text-gray-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800 transition"
        >
          {backLabel}
        </button>
      </div>
    </div>
  );

  const renderExamAccessGate = (backLabel: string, onBack: () => void) =>
    renderFeatureAccessGate(
      !user ? 'Đăng nhập để làm bài kiểm tra' : 'Bạn chưa được cấp quyền làm bài kiểm tra',
      !user
        ? 'Chức năng Kiểm tra từng bài và Kiểm tra tổng hợp chỉ dành cho tài khoản Học viên (user) hoặc Quản trị viên (admin).'
        : 'Tài khoản của bạn hiện không có quyền làm bài kiểm tra (EXAM_TAKE).',
      backLabel,
      onBack
    );

  if (
    initializing ||
    (activeView === 'study' && loadingLesson && !currentLesson && lessons.length === 0 && !errorMsg)
  ) {
    return <LoadingScreen />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {activeView === 'dashboard' || activeView === 'saved_vocab' || activeView === 'history' ? (
        <DashboardPage
          user={user}
          lessons={lessons}
          attempts={attempts}
          currentLessonId={currentLessonId}
          activeSection={
            activeView === 'saved_vocab'
              ? 'saved_vocab'
              : activeView === 'history'
                ? 'history'
                : 'overview'
          }
          darkMode={darkMode}
          canAccessAdmin={canAccessAdmin}
          canUseAiAssistant={canUseAiAssistant}
          onChangeSection={(section) =>
            navigateView(section === 'overview' ? 'dashboard' : section)
          }
          onSelectLesson={(lessonId) => setCurrentLessonId(lessonId)}
          onToggleDarkMode={() => setDarkMode((d) => !d)}
          onOpenLesson={(lessonId, tab = 'vocab') => {
            setCurrentLessonId(lessonId);
            setActiveTab(tab);
            navigateView('study');
          }}
          onOpenExam={openComprehensiveExam}
          onOpenProfile={() => navigateView('profile')}
          onOpenAdmin={() => navigateView('admin')}
          onOpenSearch={() => setShowSearchModal(true)}
          onOpenAiDictionary={() => openAiAssistant('dictionary', '')}
          onToggleMarked={handleToggleMarked}
          onOpenWriter={(vocab) => setWriterVocab(vocab)}
          onRequireAuth={() => setShowAuthModal(true)}
          onLogout={handleLogout}
        />
      ) : (
      <>
      <header className="relative md:sticky md:top-0 z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-stone-200/80 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 min-h-16 py-2 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={() => navigateView('dashboard')}
              className="flex items-center gap-2.5 sm:gap-3 flex-shrink-0 text-left"
              title="Về trang Tổng quan (Dashboard)"
            >
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-red-600 to-amber-600 flex items-center justify-center text-white shadow-md">
                <span className="chinese-serif text-lg sm:text-xl font-black">汉</span>
              </div>
              <div className="hidden sm:block">
                <h1 className="text-base font-bold text-gray-900 dark:text-white">汉语学堂</h1>
                <p className="text-[11px] text-gray-500 dark:text-slate-400">Học tiếng Trung</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => navigateView('dashboard')}
              className="px-2.5 sm:px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-950/70 border border-red-200/80 dark:border-red-900/60 text-xs font-bold text-red-700 dark:text-red-300 flex items-center gap-1.5 transition active:scale-95"
              title="Mở trang Tổng quan học tập (Dashboard)"
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Tổng quan</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end min-w-0 flex-1">
            <select
              value={currentLessonId}
              onChange={(e) => {
                setCurrentLessonId(e.target.value);
                navigateView('study');
              }}
              className="pl-2.5 sm:pl-3 pr-6 sm:pr-7 py-2 bg-stone-100 dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-gray-800 dark:text-slate-100 min-w-0 flex-1 sm:flex-initial max-w-full sm:max-w-[230px] md:max-w-xs truncate"
            >
              {Object.entries(groupedLessons).map(([unit, items]) => (
                <optgroup key={unit} label={unit}>
                  {items.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title} ({l.vocabCount} từ)
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            <button
              onClick={() => setShowSearchModal(true)}
              className="px-3 py-2 rounded-xl bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 border border-stone-200 dark:border-slate-700 text-xs font-semibold text-gray-700 dark:text-slate-200 flex items-center gap-1.5"
              title="Tìm từ vựng toàn bộ 26 bài (Ctrl+K)"
            >
              <Search className="w-3.5 h-3.5 text-red-600" />
              <span className="hidden md:inline">Tìm từ (Ctrl+K)</span>
            </button>

            {canCreateAnyLesson && (
              <button
                onClick={() => {
                  if (!user) {
                    setShowAuthModal(true);
                    return;
                  }
                  setLessonModalMode('create');
                }}
                className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Thêm bài</span>
              </button>
            )}

            {canEditCurrent && (
              <button
                onClick={() => setLessonModalMode('edit')}
                className="p-2 rounded-xl border border-stone-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-800"
                title={currentLesson?.isSystem ? 'Sửa bài học hệ thống' : 'Sửa bài tự tạo'}
              >
                <Edit3 className="w-4 h-4" />
              </button>
            )}

            {canDeleteCurrent && (
              <button
                onClick={handleDeleteCurrentLesson}
                className="p-2 rounded-xl border border-stone-200 dark:border-slate-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                title={currentLesson?.isSystem ? 'Xoá bài học hệ thống' : 'Xoá bài tự tạo'}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}

            <HeaderExtensionMenu
              items={[
                ...(canUseAiAssistant
                  ? [
                      {
                        id: 'ai_dictionary',
                        label: 'Từ điển & Trợ lý AI',
                        description: 'Dịch Trung ⇄ Việt & Gia sư',
                        icon: Sparkles,
                        iconClassName: 'text-amber-500',
                        active: showAiModal,
                        onClick: () => openAiAssistant('dictionary', ''),
                      },
                    ]
                  : []),
                ...(canShowExamEntry
                  ? [
                      {
                        id: 'comprehensive_exam',
                        label: 'Kiểm tra tổng hợp',
                        description: !user ? 'Đăng nhập để làm bài thi' : '50 câu ngẫu nhiên',
                        icon: Award,
                        iconClassName: 'text-red-500',
                        active: activeView === 'exam',
                        onClick: openComprehensiveExam,
                      },
                    ]
                  : []),
                {
                  id: 'saved_vocab',
                  label: 'Từ đã đánh dấu',
                  description: !user ? 'Đăng nhập để xem từ đánh dấu' : 'Sổ tay từ vựng cần ôn tập',
                  icon: Bookmark,
                  iconClassName: 'text-amber-500',
                  onClick: () => (user ? navigateView('saved_vocab') : setShowAuthModal(true)),
                },
                {
                  id: 'test_history',
                  label: 'Lịch sử làm bài',
                  description: !user ? 'Đăng nhập để xem lịch sử thi' : 'Tổng hợp kết quả kiểm tra',
                  icon: BarChart3,
                  iconClassName: 'text-blue-500',
                  onClick: () => (user ? navigateView('history') : setShowAuthModal(true)),
                },
                ...(canAccessAdmin
                  ? [
                      {
                        id: 'admin_rbac',
                        label: 'Quản trị & Phân quyền',
                        description: 'Vai trò & quyền tài khoản',
                        icon: ShieldCheck,
                        iconClassName: 'text-amber-500',
                        active: activeView === 'admin',
                        onClick: () => navigateView('admin'),
                      },
                    ]
                  : []),
              ]}
            />

            <button
              onClick={() => setDarkMode((d) => !d)}
              className="p-2 rounded-xl border border-stone-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-800"
              title="Chế độ Sáng / Tối"
            >
              {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>

            {user ? (
              <div className="flex items-center gap-1.5 pl-1">
                <button
                  type="button"
                  onClick={() => navigateView(activeView === 'profile' ? 'study' : 'profile')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold border transition active:scale-95 ${
                    activeView === 'profile'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                      : 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200/70 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
                  }`}
                  title="Trang cá nhân (Profile)"
                >
                  {(() => {
                    const miniPreset = getAvatarPreset(user.avatarUrl);
                    if (isImageMediaUrl(user.avatarUrl)) {
                      return (
                        <img
                          src={user.avatarUrl!}
                          alt={user.displayName}
                          className="w-4 h-4 rounded-full object-cover flex-shrink-0"
                        />
                      );
                    }
                    if (miniPreset) {
                      return (
                        <span
                          className={`w-4 h-4 rounded-full ${miniPreset.gradientClass} text-white chinese-serif text-[10px] font-black flex items-center justify-center flex-shrink-0`}
                        >
                          {miniPreset.symbol}
                        </span>
                      );
                    }
                    return <UserIcon className="w-3.5 h-3.5" />;
                  })()}
                  <span className="hidden sm:inline">{user.displayName}</span>
                </button>
                <button
                  onClick={handleLogout}
                  className="p-2 rounded-xl border border-stone-200 dark:border-slate-700 text-gray-500 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 dark:hover:border-red-800 transition active:scale-95"
                  title="Đăng xuất"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="px-2.5 sm:px-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 text-xs font-bold text-gray-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800 flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" /> Đăng nhập
              </button>
            )}
          </div>
        </div>
      </header>

      {activeView === 'study' && (
      <section className="bg-white dark:bg-slate-900/70 border-b border-stone-200/60 dark:border-slate-800 py-4 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 text-xs font-extrabold uppercase font-mono">
                {currentLesson?.hskLevel || 'HSK'}
              </span>
              <h2 className="text-lg md:text-xl font-black text-gray-900 dark:text-white">
                {currentLesson?.title || 'Đang tải buổi học...'}
              </h2>
            </div>
            {currentLesson?.description && (
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{currentLesson.description}</p>
            )}
          </div>

          <nav className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
            {(
              [
                ['vocab', '1. Từ vựng & Viết', Layers],
                ['texts', '2. Bài khoá & Nghe', Headphones],
                ['grammar', '3. Ngữ pháp', GitBranch],
                ['games', '4. Trò chơi', Gamepad2],
                ['test', '5. Kiểm tra', Award],
              ] as const
            ).map(([id, label, Icon]) => {
              const active = activeTab === id;
              const isLockedTab =
                (id === 'test' && !canTakeExam) || (id === 'games' && !canPlayGames);
              return (
                <button
                  key={id}
                  onClick={() => {
                    if ((id === 'test' || id === 'games') && !user) {
                      setShowAuthModal(true);
                    }
                    setActiveTab(id);
                  }}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition active:scale-95 ${
                    active
                      ? 'bg-red-600 text-white shadow-md'
                      : 'text-gray-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-slate-800 hover:text-red-700 dark:hover:text-red-300'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                  {isLockedTab && <Lock className="w-3 h-3 opacity-80" />}
                </button>
              );
            })}
          </nav>
        </div>
      </section>
      )}

      <main className="flex-grow max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-8">
        {!user && (
          <div className="mb-6 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
            <span>
              Bạn đang ở chế độ <strong>Dùng thử (Khách)</strong>.
            </span>
            <button
              onClick={() => setShowAuthModal(true)}
              className="px-3 py-1.5 rounded-xl bg-amber-600 text-white font-bold self-start sm:self-auto flex-shrink-0"
            >
              Đăng nhập / Đăng ký
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="mb-6 p-4 rounded-2xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        {activeView === 'exam' ? (
          !canTakeExam ? (
            renderExamAccessGate('Quay lại buổi học', () => navigateView('study'))
          ) : loadingExam && !comprehensiveExam ? (
            <LoadingCard
              message="Đang bốc 50 câu hỏi ngẫu nhiên..."
              subMessage="Tổng hợp từ 26 bài học theo đúng cơ cấu HSK 3"
            />
          ) : (
            <TestSection
              lesson={{
                id: comprehensiveExam?.id || 'comprehensive_all_26',
                title: comprehensiveExam?.title || 'Kiểm tra tổng hợp (26 bài)',
                unit: 'Tổng hợp 26 bài',
                hskLevel: comprehensiveExam?.hskLevel || 'HSK 1 - HSK 3',
                description:
                  comprehensiveExam?.description ||
                  '50 câu hỏi ngẫu nhiên rải đều 26 bài học chuẩn cơ cấu HSK 3.',
                isSystem: true,
                vocabulary: [],
                texts: [],
                grammar: [],
                exercises: {
                  sentenceScramble: [],
                  translationExercises: [],
                  expandedQuiz: [],
                },
                comprehensiveTest: comprehensiveExam?.questions || [],
              }}
              attempts={attempts}
              currentUserId={user?.id}
              onSaveAttempt={handleSaveTestAttempt}
              onGoToVocab={() => navigateView('study')}
              isComprehensiveExam
              loadingExam={loadingExam}
              onRefreshExam={() => void loadComprehensiveExam(effectiveExamLessonIds)}
              onBackToStudy={() => navigateView('study')}
              availableLessons={lessons}
              selectedLessonIds={effectiveExamLessonIds}
              onChangeSelectedLessons={(ids) => {
                setSelectedExamLessonIds(ids);
                void loadComprehensiveExam(ids);
              }}
            />
          )
        ) : activeView === 'admin' ? (
          user && canAccessAdmin ? (
            <AdminRbacPage
              currentUser={user}
              onBackToStudy={() => navigateView('study')}
              onRefreshCurrentUser={refreshCurrentUserProfile}
            />
          ) : (
            <LoadingCard message="Đang kiểm tra quyền truy cập..." />
          )
        ) : activeView === 'profile' ? (
          user ? (
            <ProfilePage
              user={user}
              lessons={lessons}
              markedMap={markedMap}
              attempts={attempts}
              onBackToStudy={() => navigateView('dashboard')}
              onLogout={handleLogout}
              onOpenSavedVocab={() => navigateView('saved_vocab')}
              onOpenTestHistory={() => navigateView('history')}
              onUpdateUser={(updatedUser) => setUser(updatedUser)}
            />
          ) : (
            <LoadingCard message="Đang tải thông tin tài khoản..." />
          )
        ) : loadingLesson || !currentLesson ? (
          <LoadingCard message="Đang tải nội dung buổi học..." />
        ) : (
          <>
            {activeTab === 'vocab' && (
              <VocabSection
                lesson={currentLesson}
                markedMap={markedMap}
                onToggleMarked={handleToggleMarked}
                onOpenWriter={(v) => setWriterVocab(v)}
                canUseBookmark={canBookmarkVocab}
                onRequireBookmarkAccess={() => {
                  if (!user) {
                    setShowAuthModal(true);
                  } else {
                    setErrorMsg('Tài khoản của bạn hiện không có quyền đánh dấu từ vựng.');
                  }
                }}
              />
            )}
            {activeTab === 'texts' && (
              <TextsSection
                lesson={currentLesson}
                canChangeSpeechRate={Boolean(user)}
                onRequireAuth={() => setShowAuthModal(true)}
              />
            )}
            {activeTab === 'grammar' && <GrammarSection lesson={currentLesson} />}
            {activeTab === 'games' ? (
              !canPlayGames ? (
                renderFeatureAccessGate(
                  'Đăng nhập để chơi Trò chơi ôn tập',
                  'Chức năng Trò chơi sắp xếp câu, luyện dịch và trắc nghiệm mở rộng chỉ dành cho tài khoản Học viên (user) hoặc Quản trị viên (admin).',
                  'Quay lại Từ vựng',
                  () => setActiveTab('vocab')
                )
              ) : (
                <GamesSection lesson={currentLesson} currentUserId={user?.id} />
              )
            ) : null}
            {activeTab === 'test' ? (
              !canTakeExam ? (
                renderExamAccessGate('Quay lại Từ vựng', () => setActiveTab('vocab'))
              ) : (
                <TestSection
                  lesson={currentLesson}
                  attempts={attempts}
                  currentUserId={user?.id}
                  onSaveAttempt={handleSaveTestAttempt}
                  onGoToVocab={() => setActiveTab('vocab')}
                />
              )
            ) : null}
          </>
        )}
      </main>
      </>
      )}

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} onSuccess={handleAuthSuccess} />
      )}
      {showSearchModal && (
        <GlobalSearchModal
          onClose={() => setShowSearchModal(false)}
          onJumpToLesson={(id) => {
            setCurrentLessonId(id);
            navigateView('study');
            setActiveTab('vocab');
          }}
          onOpenAiDictionary={
            canUseAiAssistant ? (q) => openAiAssistant('dictionary', q) : undefined
          }
        />
      )}
      {showAiModal && (
        <AiAssistantModal
          userId={user?.id}
          initialTab={aiInitialTab}
          initialQuery={aiInitialQuery}
          currentLesson={currentLesson}
          lessons={lessons}
          onClose={() => setShowAiModal(false)}
          onJumpToLesson={(id, tab = 'vocab') => {
            setCurrentLessonId(id);
            navigateView('study');
            setActiveTab(tab);
          }}
          onNavigateView={(view) => {
            if (view === 'exam') {
              openComprehensiveExam();
            } else {
              navigateView(view);
            }
          }}
          onStartReviewExam={(exam, lessonIds) => {
            setSelectedExamLessonIds(lessonIds);
            setComprehensiveExam(exam);
            navigateView('exam');
          }}
          onOpenWriter={(v) => setWriterVocab(v)}
          onProgressChanged={refreshUserProgress}
          onLessonsChanged={async (focusId) => {
            await refreshLessons();
            if (focusId) setCurrentLessonId(focusId);
          }}
        />
      )}
      {canUseAiAssistant && (
        <button
          type="button"
          onClick={() => openAiAssistant('dictionary', '')}
          title="Mở Từ điển & Gia sư AI"
          aria-label="Mở Từ điển & Gia sư AI"
          className="group fixed bottom-4 right-4 sm:bottom-5 sm:right-5 z-30 h-10 sm:h-11 px-2.5 sm:px-3 hover:px-4 focus-visible:px-4 rounded-full bg-gradient-to-r from-red-600 to-amber-600 hover:opacity-95 text-white text-xs font-bold shadow-lg flex items-center justify-center transition-all duration-300 ease-out active:scale-95"
        >
          <Sparkles className="w-5 h-5 flex-shrink-0" />
          <span className="max-w-0 opacity-0 overflow-hidden whitespace-nowrap transition-all duration-300 ease-out group-hover:max-w-[180px] group-hover:opacity-100 group-hover:ml-2 group-focus-visible:max-w-[180px] group-focus-visible:opacity-100 group-focus-visible:ml-2">
            Từ điển &amp; Gia sư AI
          </span>
        </button>
      )}
      {writerVocab && (
        <HanziWriterModal
          word={writerVocab.hanzi}
          pinyin={writerVocab.pinyin}
          meaning={writerVocab.meaning}
          onClose={() => setWriterVocab(null)}
        />
      )}
      {lessonModalMode && (
        <LessonModal
          initialLesson={lessonModalMode === 'edit' ? currentLesson : null}
          canCreateSystemLesson={canCreateSystemLesson}
          canCreateCustomLesson={canCreateCustomLesson}
          onClose={() => setLessonModalMode(null)}
          onSave={handleSaveLesson}
        />
      )}
      {showDeleteConfirm && currentLesson && (
        <ConfirmDeleteModal
          title="Xoá buổi học"
          itemName={currentLesson.title}
          description={`Toàn bộ ${currentLesson.vocabulary?.length ?? 0} từ vựng, ngữ pháp, bài tập và lịch sử làm bài kiểm tra của buổi học này sẽ bị xoá vĩnh viễn và không thể khôi phục.`}
          confirmLabel="Xoá buổi học"
          loading={deletingLesson}
          error={deleteError}
          onConfirm={handleConfirmDeleteLesson}
          onCancel={() => {
            if (deletingLesson) return;
            setShowDeleteConfirm(false);
            setDeleteError(null);
          }}
        />
      )}
    </div>
  );
}
