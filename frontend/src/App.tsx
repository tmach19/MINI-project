import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  Edit3,
  Gamepad2,
  GitBranch,
  Headphones,
  Layers,
  LogIn,
  LogOut,
  Moon,
  Plus,
  Search,
  Sun,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { api, getStoredToken, setStoredToken } from './lib/api';
import {
  loadGuestAttempts,
  loadGuestMarkedMap,
  saveGuestAttempts,
  saveGuestMarkedMap,
} from './lib/srsLocal';
import { AuthModal } from './components/AuthModal';
import { ConfirmDeleteModal } from './components/ConfirmDeleteModal';
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

function getViewFromPath(): 'study' | 'profile' | 'exam' {
  if (typeof window !== 'undefined') {
    const p = window.location.pathname.replace(/\/+$/, '');
    if (p === '/profile') return 'profile';
    if (p === '/exam') return 'exam';
  }
  return 'study';
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
  const [activeView, setActiveView] = useState<'study' | 'profile' | 'exam'>(() => getViewFromPath());
  const [activeTab, setActiveTab] = useState<TabId>('vocab');
  const [loadingLesson, setLoadingLesson] = useState(false);
  const [comprehensiveExam, setComprehensiveExam] = useState<ComprehensiveExamResponse | null>(null);
  const [loadingExam, setLoadingExam] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [markedMap, setMarkedMap] = useState<Record<string, MarkedVocabRecord>>(() =>
    loadGuestMarkedMap()
  );
  const [attempts, setAttempts] = useState<TestAttemptRecord[]>(() => loadGuestAttempts());

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
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

  const navigateView = (nextView: 'study' | 'profile' | 'exam', replace = false) => {
    setActiveView(nextView);
    const targetPath = nextView === 'profile' ? '/profile' : nextView === 'exam' ? '/exam' : '/';
    if (window.location.pathname !== targetPath) {
      if (replace) window.history.replaceState(null, '', targetPath);
      else window.history.pushState(null, '', targetPath);
    }
  };

  const loadComprehensiveExam = async () => {
    setLoadingExam(true);
    setErrorMsg(null);
    try {
      const res = await api.getComprehensiveExam();
      setComprehensiveExam(res.exam);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không tải được đề kiểm tra tổng hợp');
    } finally {
      setLoadingExam(false);
    }
  };

  const openComprehensiveExam = () => {
    setComprehensiveExam(null);
    navigateView('exam');
    void loadComprehensiveExam();
  };

  useEffect(() => {
    const onPopState = () => setActiveView(getViewFromPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (activeView === 'exam' && !comprehensiveExam && !loadingExam) {
      void loadComprehensiveExam();
    }
  }, [activeView]);

  useEffect(() => {
    if (authChecked && activeView === 'profile' && !user) {
      navigateView('study', true);
    }
  }, [authChecked, activeView, user]);

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
  }, [currentLessonId]);

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

    const guestIds = Object.keys(loadGuestMarkedMap());
    if (guestIds.length > 0) {
      await api.syncMarkedVocab(guestIds).catch(() => {});
    }
    await Promise.all([refreshUserProgress(), refreshLessons()]);
  };

  const handleLogout = () => {
    setStoredToken(null);
    setUser(null);
    navigateView('study');
    setMarkedMap(loadGuestMarkedMap());
    setAttempts(loadGuestAttempts());
    refreshLessons();
  };

  const handleToggleMarked = async (vocabId: string) => {
    const isMarked = Boolean(markedMap[vocabId]);
    const nextMarked = !isMarked;

    if (user) {
      const res = await api.toggleMarkVocab({ vocabId, marked: nextMarked });
      setMarkedMap((prev) => {
        const copy = { ...prev };
        if (res.marked && res.record) copy[vocabId] = res.record;
        else delete copy[vocabId];
        return copy;
      });
    } else {
      const nextMap = { ...markedMap };
      if (nextMarked) {
        nextMap[vocabId] = {
          vocabId,
          markedAt: new Date().toISOString(),
        };
      } else {
        delete nextMap[vocabId];
      }
      setMarkedMap(nextMap);
      saveGuestMarkedMap(nextMap);
    }
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
    const resolvedTitle =
      payload.examTitle || currentLesson?.title || payload.lessonId || 'Kiểm tra tổng hợp (26 bài)';
    if (user) {
      const res = await api.submitTestAttempt(payload);
      setAttempts((prev) => [
        { ...res.attempt, lessonTitle: res.attempt.lessonTitle || resolvedTitle },
        ...prev,
      ]);
    } else {
      const rec: TestAttemptRecord = {
        id: `guest_${Date.now()}`,
        lessonId: payload.lessonId,
        examTitle: payload.examTitle ?? null,
        lessonTitle: resolvedTitle,
        score: payload.score,
        totalQuestions: payload.totalQuestions,
        correctCount: payload.correctCount,
        durationSeconds: payload.durationSeconds,
        answers: payload.answers,
        submittedAt: new Date().toISOString(),
      };
      const next = [rec, ...attempts];
      setAttempts(next);
      saveGuestAttempts(next);
    }
  };

  const handleSaveLesson = async (payload: {
    title: string;
    hskLevel: string;
    unit?: string;
    description?: string;
    vocabulary: any[];
    grammar: any[];
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

  const handleDeleteCurrentLesson = () => {
    if (!currentLesson || currentLesson.isSystem) return;
    setDeleteError(null);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDeleteLesson = async () => {
    if (!currentLesson || currentLesson.isSystem || deletingLesson) return;
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

  const canEditCurrent = Boolean(
    user && currentLesson && !currentLesson.isSystem && currentLesson.ownerId === user.id
  );

  if (
    initializing ||
    (activeView === 'study' && loadingLesson && !currentLesson && lessons.length === 0 && !errorMsg)
  ) {
    return <LoadingScreen />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-stone-200/80 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigateView('study')}
            className="flex items-center gap-3 flex-shrink-0 text-left"
          >
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-red-600 to-amber-600 flex items-center justify-center text-white shadow-md">
              <span className="chinese-serif text-xl font-black">汉</span>
            </div>
            <div className="hidden sm:block">
              <h1 className="text-base font-bold text-gray-900 dark:text-white">汉语学堂</h1>
              <p className="text-[11px] text-gray-500 dark:text-slate-400">Học tiếng Trung</p>
            </div>
          </button>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <select
              value={currentLessonId}
              onChange={(e) => {
                setCurrentLessonId(e.target.value);
                navigateView('study');
              }}
              className="pl-3 pr-7 py-2 bg-stone-100 dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-gray-800 dark:text-slate-100 max-w-[180px] sm:max-w-xs truncate"
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

            {canEditCurrent && (
              <>
                <button
                  onClick={() => setLessonModalMode('edit')}
                  className="p-2 rounded-xl border border-stone-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-800"
                  title="Sửa bài tự tạo"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  onClick={handleDeleteCurrentLesson}
                  className="p-2 rounded-xl border border-stone-200 dark:border-slate-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                  title="Xoá bài tự tạo"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}

            <HeaderExtensionMenu
              items={[
                {
                  id: 'comprehensive_exam',
                  label: 'Kiểm tra tổng hợp',
                  description: '50 câu ngẫu nhiên',
                  icon: Award,
                  iconClassName: 'text-red-500',
                  active: activeView === 'exam',
                  onClick: openComprehensiveExam,
                },
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
                  <UserIcon className="w-3.5 h-3.5" />
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
                className="px-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 text-xs font-bold text-gray-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800 flex items-center gap-1.5"
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
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition active:scale-95 ${
                    active
                      ? 'bg-red-600 text-white shadow-md'
                      : 'text-gray-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-slate-800 hover:text-red-700 dark:hover:text-red-300'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              );
            })}
          </nav>
        </div>
      </section>
      )}

      <main className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!user && (
          <div className="mb-6 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
            <span>
              Bạn đang ở chế độ <strong>Dùng thử (Khách)</strong> — thẻ đánh dấu tạm lưu trên trình duyệt. Đăng nhập để lưu vào Database PostgreSQL.
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
          loadingExam && !comprehensiveExam ? (
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
              onSaveAttempt={handleSaveTestAttempt}
              onGoToVocab={() => navigateView('study')}
              isComprehensiveExam
              loadingExam={loadingExam}
              onRefreshExam={loadComprehensiveExam}
              onBackToStudy={() => navigateView('study')}
            />
          )
        ) : activeView === 'profile' ? (
          user ? (
            <ProfilePage
              user={user}
              lessons={lessons}
              markedMap={markedMap}
              attempts={attempts}
              onBackToStudy={() => navigateView('study')}
              onLogout={handleLogout}
              onToggleMarked={handleToggleMarked}
              onOpenLesson={(lessonId, tab = 'vocab') => {
                setCurrentLessonId(lessonId);
                setActiveTab(tab);
                navigateView('study');
              }}
              onOpenExam={openComprehensiveExam}
              onOpenWriter={(vocab) => setWriterVocab(vocab)}
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
              />
            )}
            {activeTab === 'texts' && <TextsSection lesson={currentLesson} />}
            {activeTab === 'grammar' && <GrammarSection lesson={currentLesson} />}
            {activeTab === 'games' && <GamesSection lesson={currentLesson} />}
            {activeTab === 'test' && (
              <TestSection
                lesson={currentLesson}
                attempts={attempts}
                onSaveAttempt={handleSaveTestAttempt}
                onGoToVocab={() => setActiveTab('vocab')}
              />
            )}
          </>
        )}
      </main>

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
        />
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
