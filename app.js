/**
 * Chinese Study Web App - Core Logic (Updated with Radicals & 4 New Game Modes)
 */

// Global State
const state = {
  lessons: [],
  currentLessonId: null,
  activeTab: 'vocab', // 'vocab' | 'texts' | 'grammar' | 'games' | 'test'
  
  // Flashcard State
  flashcardIndex: 0,
  flashcardFlipped: false,
  flashcardFilter: 'all', // 'all' | 'need_review' | 'mastered'
  masteredVocab: {}, // { [vocabId]: true }
  vocabSearch: '',
  showPinyinInList: true,
  showMeaningInList: true,
  showHVDInList: true,
  showRadicalInList: true,
  
  // Audio State
  speechRate: 0.9,
  isPlayingDialogue: false,
  dialogueSentenceIndex: -1,
  dialogueTimer: null,
  
  // Text Settings
  showTextPinyin: true,
  showTextMeaning: true,
  
  // 4 New Game Modes State
  activeGame: 'tri_match', // 'tri_match' | 'scramble' | 'translation' | 'expanded_quiz'
  
  // Game 1: Triple Match (Hán tự + Pinyin + Nghĩa)
  triMatchGame: {
    words: [],
    selectedHanzi: null,
    selectedPinyin: null,
    selectedMeaning: null,
    matchedIds: [],
    score: 0,
    combo: 0,
    timeElapsed: 0,
    timerInterval: null,
    isCompleted: false
  },

  // Game 2: Sắp xếp câu Hán tự
  scrambleGame: {
    index: 0,
    selectedTokens: [],
    availableTokens: [],
    isCorrect: null
  },

  // Game 3: Gõ câu dịch song ngữ
  translationGame: {
    mode: 'vi_to_zh', // 'vi_to_zh' | 'zh_to_vi'
    index: 0,
    userInput: '',
    isChecked: false,
    isCorrect: false,
    showHint: false,
    showAnswer: false
  },

  // Game 4: Trắc nghiệm mở rộng (20+ câu)
  expandedQuizGame: {
    index: 0,
    userAnswers: {},
    isCompleted: false,
    score: 0,
    streak: 0
  },

  // Comprehensive Test State
  test: {
    isActive: false,
    questions: [],
    userAnswers: {},
    isSubmitted: false,
    score: 0,
    timeRemaining: 600,
    timerInterval: null,
    currentQuestionIndex: 0
  }
};

// ==========================================
// Web Audio API Sound Effects
// ==========================================
const soundFx = {
  ctx: null,
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },
  playCorrect() {
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.09);
      osc.frequency.setValueAtTime(783.99, now + 0.18);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    } catch (e) { console.error(e); }
  },
  playWrong() {
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.setValueAtTime(170, now + 0.12);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch (e) { console.error(e); }
  },
  playFlip() {
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(350, now);
      osc.frequency.exponentialRampToValueAtTime(600, now + 0.08);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } catch (e) { console.error(e); }
  },
  playVictory() {
    try {
      this.init();
      if (!this.ctx) return;
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, i) => {
        const now = this.ctx.currentTime + (i * 0.12);
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + (i === 3 ? 0.6 : 0.22));
        osc.start(now);
        osc.stop(now + (i === 3 ? 0.6 : 0.22));
      });
    } catch (e) { console.error(e); }
  }
};

// ==========================================
// Speech Synthesis (Chinese TTS)
// ==========================================
function getChineseVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  let voice = voices.find(v => v.lang === 'zh-CN' || v.lang === 'cmn-Hans-CN');
  if (!voice) voice = voices.find(v => v.lang && v.lang.startsWith('zh'));
  return voice || null;
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    getChineseVoice();
  };
}

function speakChinese(text, rate = null, onEndCallback = null) {
  if (!('speechSynthesis' in window)) {
    if (onEndCallback) onEndCallback();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = rate !== null ? rate : state.speechRate;
  const chineseVoice = getChineseVoice();
  if (chineseVoice) utterance.voice = chineseVoice;
  if (onEndCallback) {
    utterance.onend = onEndCallback;
    utterance.onerror = onEndCallback;
  }
  window.speechSynthesis.speak(utterance);
}

// ==========================================
// Storage Helpers
// ==========================================
function loadSavedLessons() {
  try {
    const raw = localStorage.getItem('chinese_study_lessons_v8');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length >= 26) {
        state.lessons = parsed;
        return;
      }
    }
  } catch (e) {
    console.error("Error loading lessons:", e);
  }
  // Initialize with DEFAULT_LESSONS
  state.lessons = JSON.parse(JSON.stringify(DEFAULT_LESSONS));
  saveLessonsToStorage();
}

function saveLessonsToStorage() {
  localStorage.setItem('chinese_study_lessons_v8', JSON.stringify(state.lessons));
  if (state.currentLessonId) {
    localStorage.setItem('chinese_study_current_lesson_id', state.currentLessonId);
  }
}

function loadMasteredVocab() {
  try {
    const raw = localStorage.getItem('chinese_study_mastered');
    if (raw) state.masteredVocab = JSON.parse(raw);
  } catch (e) {
    state.masteredVocab = {};
  }
}

function saveMasteredVocab() {
  localStorage.setItem('chinese_study_mastered', JSON.stringify(state.masteredVocab));
}

// ==========================================
// App Initialization
// ==========================================
function initApp() {
  loadSavedLessons();
  loadMasteredVocab();
  
  if (state.lessons.length > 0) {
    const savedLessonId = localStorage.getItem('chinese_study_current_lesson_id');
    const exists = savedLessonId && state.lessons.some(l => l.id === savedLessonId);
    state.currentLessonId = exists ? savedLessonId : state.lessons[0].id;
    localStorage.setItem('chinese_study_current_lesson_id', state.currentLessonId);
  }

  const savedTab = localStorage.getItem('chinese_study_active_tab');
  if (savedTab && ['vocab', 'texts', 'grammar', 'games', 'test'].includes(savedTab)) {
    state.activeTab = savedTab;
  }

  if (state.activeTab === 'games') {
    if (state.activeGame === 'tri_match') initTriMatchGame();
    else if (state.activeGame === 'scramble') initScrambleGame();
    else if (state.activeGame === 'translation') initTranslationGame();
    else if (state.activeGame === 'expanded_quiz') initExpandedQuiz();
  }
  
  renderLessonSelector();
  renderApp();
  setupKeyboardShortcuts();
}

function getCurrentLesson() {
  return state.lessons.find(l => l.id === state.currentLessonId) || state.lessons[0] || null;
}

function switchLesson(lessonId) {
  state.currentLessonId = lessonId;
  localStorage.setItem('chinese_study_current_lesson_id', lessonId);
  state.flashcardIndex = 0;
  state.flashcardFlipped = false;
  state.dialogueSentenceIndex = -1;
  if (state.isPlayingDialogue) stopDialogueAudio();
  
  // Reset tests & games
  if (state.test.timerInterval) clearInterval(state.test.timerInterval);
  state.test.isActive = false;
  state.test.isSubmitted = false;

  if (state.triMatchGame.timerInterval) clearInterval(state.triMatchGame.timerInterval);
  initTriMatchGame();
  initScrambleGame();
  initTranslationGame();
  initExpandedQuiz();

  renderLessonSelector();
  renderApp();
}

function switchTab(tabName) {
  state.activeTab = tabName;
  localStorage.setItem('chinese_study_active_tab', tabName);
  if (state.isPlayingDialogue && tabName !== 'texts') {
    stopDialogueAudio();
  }
  if (tabName === 'games') {
    if (state.activeGame === 'tri_match') initTriMatchGame();
    else if (state.activeGame === 'scramble') initScrambleGame();
    else if (state.activeGame === 'translation') initTranslationGame();
    else if (state.activeGame === 'expanded_quiz') initExpandedQuiz();
  }
  renderApp();
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    
    if (state.activeTab === 'vocab') {
      if (e.code === 'Space') {
        e.preventDefault();
        flipFlashcard();
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        nextFlashcard();
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        prevFlashcard();
      } else if (e.code === 'KeyS') {
        speakCurrentFlashcard();
      }
    }
  });
}

// ==========================================
// Header Rendering
// ==========================================
function renderLessonSelector() {
  const selector = document.getElementById('lesson-select');
  if (!selector) return;

  const units = {};
  state.lessons.forEach(lesson => {
    const u = lesson.unit || 'Chung';
    if (!units[u]) units[u] = [];
    units[u].push(lesson);
  });

  let html = '';
  for (const [unitName, lList] of Object.entries(units)) {
    html += `<optgroup label="📖 ${unitName}">`;
    lList.forEach(l => {
      html += `<option value="${l.id}" ${l.id === state.currentLessonId ? 'selected' : ''}>
        ${l.title}
      </option>`;
    });
    html += `</optgroup>`;
  }
  selector.innerHTML = html;
}

function renderLessonHeader() {
  const current = getCurrentLesson();
  if (!current) return;
  
  const titleEl = document.getElementById('lesson-title-display');
  const badgeEl = document.getElementById('lesson-badge-display');
  const descEl = document.getElementById('lesson-desc-display');
  
  if (titleEl) titleEl.textContent = current.title;
  if (badgeEl) badgeEl.textContent = current.hskLevel || 'HSK';
  if (descEl) descEl.textContent = current.description || 'Chưa có mô tả cho buổi học này.';
}

// ==========================================
// Main Router
// ==========================================
function renderApp() {
  renderLessonHeader();
  
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const tab = btn.getAttribute('data-tab');
    if (tab === state.activeTab) {
      btn.className = "tab-btn px-4 py-2.5 font-medium text-sm rounded-xl transition-all duration-200 bg-red-600 text-white shadow-md shadow-red-200 flex items-center gap-2";
    } else {
      btn.className = "tab-btn px-4 py-2.5 font-medium text-sm rounded-xl transition-all duration-200 text-gray-600 hover:text-red-700 hover:bg-red-50 flex items-center gap-2";
    }
  });

  const contentArea = document.getElementById('main-content-area');
  if (!contentArea) return;
  
  const currentLesson = getCurrentLesson();
  if (!currentLesson) {
    contentArea.innerHTML = `
      <div class="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-300">
        <i class="fas fa-book-open text-gray-400 text-5xl mb-4"></i>
        <h3 class="text-lg font-semibold text-gray-700">Chưa có buổi học nào!</h3>
        <button onclick="restoreDefaultLessons()" class="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium">
          Khôi phục bài học mẫu HSK
        </button>
      </div>
    `;
    return;
  }

  switch (state.activeTab) {
    case 'vocab':
      renderVocabSection(contentArea, currentLesson);
      break;
    case 'texts':
      renderTextsSection(contentArea, currentLesson);
      break;
    case 'grammar':
      renderGrammarSection(contentArea, currentLesson);
      break;
    case 'games':
      renderGamesSection(contentArea, currentLesson);
      break;
    case 'test':
      renderComprehensiveTestSection(contentArea, currentLesson);
      break;
    default:
      renderVocabSection(contentArea, currentLesson);
  }
}

// ==========================================
// FEATURE 1: TỪ VỰNG, FLASHCARD, BỘ THỦ & CẤU TẠO CHỮ
// ==========================================
function getFilteredVocabList(lesson) {
  let list = lesson.vocabulary || [];
  if (state.vocabSearch.trim()) {
    const q = state.vocabSearch.toLowerCase().trim();
    list = list.filter(v => 
      (v.hanzi && v.hanzi.toLowerCase().includes(q)) ||
      (v.pinyin && v.pinyin.toLowerCase().includes(q)) ||
      (v.meaning && v.meaning.toLowerCase().includes(q)) ||
      (v.sinoVietnamese && v.sinoVietnamese.toLowerCase().includes(q)) ||
      (v.radical && v.radical.toLowerCase().includes(q))
    );
  }
  if (state.flashcardFilter === 'mastered') {
    list = list.filter(v => state.masteredVocab[v.id]);
  } else if (state.flashcardFilter === 'need_review') {
    list = list.filter(v => !state.masteredVocab[v.id]);
  }
  return list;
}

function renderVocabSection(container, lesson) {
  const filteredList = getFilteredVocabList(lesson);
  const totalCount = (lesson.vocabulary || []).length;
  const masteredCount = (lesson.vocabulary || []).filter(v => state.masteredVocab[v.id]).length;
  
  if (state.flashcardIndex >= filteredList.length) {
    state.flashcardIndex = Math.max(0, filteredList.length - 1);
  }
  
  const currentCard = filteredList[state.flashcardIndex] || null;
  const isCardMastered = currentCard ? !!state.masteredVocab[currentCard.id] : false;

  container.innerHTML = `
    <div class="space-y-8">
      <!-- Section Header -->
      <div class="bg-gradient-to-r from-red-500 via-rose-500 to-amber-500 rounded-3xl p-6 text-white shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div class="inline-flex items-center gap-2 bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-2">
            <i class="fas fa-layer-group"></i> Module 1: Từ vựng, Bộ thủ & Cấu tạo chữ
          </div>
          <h2 class="text-2xl md:text-3xl font-bold">Thẻ ghi nhớ & Chiết tự Hán tự</h2>
          <p class="text-white/90 text-sm mt-1">Học sâu từ vựng qua Bộ thủ, Phân tích Cấu tạo chữ và Mẹo ghi nhớ hình ảnh sinh động.</p>
        </div>
        
        <div class="flex items-center gap-4 bg-white/10 backdrop-blur-md px-6 py-4 rounded-2xl border border-white/20">
          <div class="text-center">
            <span class="text-3xl font-black">${totalCount}</span>
            <p class="text-xs text-white/80 uppercase font-medium">Tổng từ</p>
          </div>
          <div class="w-px h-10 bg-white/30"></div>
          <div class="text-center">
            <span class="text-3xl font-black text-emerald-200">${masteredCount}</span>
            <p class="text-xs text-white/80 uppercase font-medium">Đã thuộc</p>
          </div>
          <div class="w-px h-10 bg-white/30"></div>
          <div class="text-center">
            <span class="text-3xl font-black text-amber-200">${totalCount - masteredCount}</span>
            <p class="text-xs text-white/80 uppercase font-medium">Cần ôn</p>
          </div>
        </div>
      </div>

      <!-- Flashcard Interactive Zone -->
      <div class="max-w-2xl mx-auto space-y-4">
        <div class="flex items-center justify-between text-sm">
          <div class="inline-flex bg-gray-200/70 p-1 rounded-xl">
            <button onclick="setVocabFilter('all')" class="px-3 py-1.5 rounded-lg text-xs font-medium transition ${state.flashcardFilter === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}">
              Tất cả (${totalCount})
            </button>
            <button onclick="setVocabFilter('need_review')" class="px-3 py-1.5 rounded-lg text-xs font-medium transition ${state.flashcardFilter === 'need_review' ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}">
              Cần ôn (${totalCount - masteredCount})
            </button>
            <button onclick="setVocabFilter('mastered')" class="px-3 py-1.5 rounded-lg text-xs font-medium transition ${state.flashcardFilter === 'mastered' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}">
              Đã thuộc (${masteredCount})
            </button>
          </div>

          <button onclick="shuffleFlashcards()" class="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition text-xs font-medium flex items-center gap-1.5">
            <i class="fas fa-random"></i> Xáo trộn
          </button>
        </div>

        ${filteredList.length === 0 ? `
          <div class="h-80 bg-white rounded-3xl border border-gray-200 shadow-sm flex flex-col items-center justify-center p-6 text-center">
            <i class="fas fa-search text-gray-300 text-4xl mb-3"></i>
            <p class="text-gray-600 font-medium">Không tìm thấy từ vựng theo bộ lọc.</p>
          </div>
        ` : `
          <div class="flashcard-container h-[480px] w-full select-none">
            <div class="flashcard-inner h-full w-full ${state.flashcardFlipped ? 'flipped' : ''}" onclick="flipFlashcard()">
              
              <!-- FLASHCARD FRONT -->
              <div class="flashcard-front bg-white border border-gray-200 shadow-xl p-6 md:p-8 flex flex-col justify-between rounded-3xl">
                <div class="w-full flex items-center justify-between text-xs">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold px-2.5 py-1 bg-red-50 text-red-700 rounded-md">
                      ${currentCard.type || 'Từ vựng'}
                    </span>
                    ${currentCard.radical ? `
                      <span class="px-2.5 py-1 bg-amber-50 text-amber-800 rounded-md font-medium border border-amber-200/60">
                        <i class="fas fa-puzzle-piece text-amber-600 mr-1"></i>Bộ: ${currentCard.radical}
                      </span>
                    ` : ''}
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-gray-400 font-medium">${state.flashcardIndex + 1} / ${filteredList.length}</span>
                    <button onclick="event.stopPropagation(); toggleMastered('${currentCard.id}')" class="p-1.5 rounded-full hover:bg-gray-100 ${isCardMastered ? 'text-emerald-500' : 'text-gray-300'}">
                      <i class="fas fa-check-circle text-base"></i>
                    </button>
                  </div>
                </div>

                <div class="my-auto flex flex-col items-center py-4">
                  <div class="text-6xl md:text-8xl font-bold chinese-serif text-gray-900 tracking-wide hover:scale-105 transition-transform duration-200">
                    ${currentCard.hanzi}
                  </div>
                </div>

                <div class="w-full flex items-center justify-between text-xs text-gray-400 border-t border-gray-100 pt-3">
                  <button onclick="event.stopPropagation(); speakChinese('${currentCard.hanzi}')" class="flex items-center gap-1.5 text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg font-medium transition">
                    <i class="fas fa-volume-up"></i> Phát âm (S)
                  </button>
                  <span class="text-gray-400 flex items-center gap-1">
                    <i class="fas fa-sync-alt text-[10px]"></i> Bấm thẻ / Space để xem Pinyin, Hán Việt & Giải nghĩa
                  </span>
                </div>
              </div>

              <!-- FLASHCARD BACK -->
              <div class="flashcard-back bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 shadow-xl p-6 md:p-8 flex flex-col justify-between rounded-3xl">
                <div class="w-full flex items-center justify-between text-xs text-amber-800">
                  <span class="font-semibold px-2.5 py-1 bg-amber-200/60 rounded-md">
                    Pinyin, Hán Việt & Chiết tự
                  </span>
                  <span class="font-mono text-amber-700 font-medium">${state.flashcardIndex + 1} / ${filteredList.length}</span>
                </div>

                <div class="my-auto flex flex-col items-center w-full py-2 space-y-3 overflow-y-auto max-h-[310px] pr-1">
                  <!-- Hanzi + Pinyin + Hán Việt + Meaning -->
                  <div class="flex flex-col items-center text-center pb-1">
                    <div class="flex items-baseline justify-center gap-3 flex-wrap">
                      <span class="text-3xl font-bold chinese-serif text-gray-900">${currentCard.hanzi}</span>
                      <span class="text-xl font-semibold text-red-600 font-mono tracking-wider">${currentCard.pinyin}</span>
                    </div>
                    ${currentCard.sinoVietnamese ? `
                      <div class="text-[11px] text-amber-700 mt-0.5 uppercase tracking-widest font-semibold">
                        Hán Việt: [ ${currentCard.sinoVietnamese} ]
                      </div>
                    ` : ''}
                    <div class="text-2xl font-bold text-gray-900 mt-1.5">
                      ${currentCard.meaning}
                    </div>
                  </div>

                  <!-- Radical & Character Breakdown Box -->
                  <div class="w-full bg-white/95 backdrop-blur-sm p-4 rounded-2xl border border-amber-200 text-left space-y-2 shadow-xs">
                    <div class="flex items-center gap-2 text-xs font-bold text-amber-900 border-b border-amber-100 pb-1.5">
                      <i class="fas fa-cube text-amber-600"></i> Phân tích Cấu tạo chữ & Bộ thủ
                    </div>
                    
                    ${currentCard.radical ? `
                      <div class="text-xs text-gray-800">
                        <span class="font-bold text-amber-800">Bộ thủ chính:</span> ${currentCard.radical}
                      </div>
                    ` : ''}

                    ${currentCard.breakdown ? `
                      <div class="text-xs text-gray-700 leading-relaxed">
                        <span class="font-bold text-amber-800">Cấu tạo:</span> ${currentCard.breakdown}
                      </div>
                    ` : ''}

                    ${currentCard.mnemonic ? `
                      <div class="text-xs text-amber-900 bg-amber-50 p-2.5 rounded-xl border border-amber-200/60 leading-relaxed">
                        💡 <span class="font-bold">Mẹo ghi nhớ:</span> ${currentCard.mnemonic}
                      </div>
                    ` : ''}
                  </div>
                  
                  <!-- Example Sentence -->
                  ${currentCard.example ? `
                    <div class="w-full bg-white/90 p-3 rounded-2xl border border-amber-200 text-left text-xs">
                      <div class="flex items-center justify-between mb-1">
                        <span class="font-semibold text-amber-700 uppercase">Ví dụ câu:</span>
                        <button onclick="event.stopPropagation(); speakChinese('${currentCard.example}')" class="text-amber-700 hover:text-amber-900 p-1">
                          <i class="fas fa-volume-up text-xs"></i>
                        </button>
                      </div>
                      <div class="text-sm font-bold text-gray-800 chinese-font">${currentCard.example}</div>
                      <div class="text-red-600 font-mono text-[11px]">${currentCard.examplePinyin || ''}</div>
                      <div class="text-gray-600 italic text-[11px] mt-0.5">→ ${currentCard.exampleMeaning || ''}</div>
                    </div>
                  ` : ''}
                </div>

                <div class="w-full flex items-center justify-between text-xs text-amber-700 border-t border-amber-200/60 pt-3">
                  <button onclick="event.stopPropagation(); speakChinese('${currentCard.hanzi}')" class="flex items-center gap-1.5 text-amber-800 font-medium">
                    <i class="fas fa-volume-up"></i> Nghe từ
                  </button>
                  <span>Nhấn để quay lại mặt trước</span>
                </div>
              </div>

            </div>
          </div>

          <!-- Controls below Flashcard -->
          <div class="flex items-center justify-center gap-4 pt-2">
            <button onclick="prevFlashcard()" class="w-12 h-12 rounded-2xl bg-white border border-gray-200 hover:border-red-500 hover:text-red-600 shadow-sm flex items-center justify-center text-gray-700 transition active:scale-95">
              <i class="fas fa-chevron-left"></i>
            </button>
            <button onclick="toggleMastered('${currentCard.id}')" class="px-5 py-3 rounded-2xl font-medium text-sm transition flex items-center gap-2 shadow-sm ${isCardMastered ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-white border border-gray-200 hover:border-emerald-500 text-gray-700'}">
              <i class="fas ${isCardMastered ? 'fa-check-circle' : 'fa-circle'}"></i>
              ${isCardMastered ? 'Đã nhớ từ này' : 'Đánh dấu đã thuộc'}
            </button>
            <button onclick="speakChinese('${currentCard.hanzi}')" class="w-12 h-12 rounded-2xl bg-red-50 text-red-600 hover:bg-red-600 hover:text-white border border-red-200 flex items-center justify-center transition active:scale-95">
              <i class="fas fa-volume-up"></i>
            </button>
            <button onclick="nextFlashcard()" class="w-12 h-12 rounded-2xl bg-white border border-gray-200 hover:border-red-500 hover:text-red-600 shadow-sm flex items-center justify-center text-gray-700 transition active:scale-95">
              <i class="fas fa-chevron-right"></i>
            </button>
          </div>
        `}
      </div>

      <!-- Vocabulary Table with Radicals & Breakdown -->
      <div class="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
        <div class="p-6 border-b border-gray-100 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h3 class="text-lg font-bold text-gray-900 flex items-center gap-2">
              <i class="fas fa-list text-red-600"></i> Bảng từ vựng & Chiết tự bộ thủ
            </h3>
            <p class="text-xs text-gray-500 mt-0.5">Bấm biểu tượng loa để nghe phát âm, bấm các nút để ẩn/hiện cột hỗ trợ tự kiểm tra.</p>
          </div>

          <div class="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
            <div class="relative flex-1 md:w-64">
              <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
              <input 
                type="text" 
                placeholder="Tìm Hán tự, Pinyin, Bộ thủ..." 
                value="${state.vocabSearch}"
                oninput="searchVocab(this.value)"
                class="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-red-500"
              />
            </div>
            <div class="flex items-center gap-1 bg-gray-100 p-1 rounded-xl text-xs">
              <button onclick="toggleVocabColumn('pinyin')" class="px-2.5 py-1 rounded-lg ${state.showPinyinInList ? 'bg-white shadow-xs font-semibold text-gray-800' : 'text-gray-400 line-through'}">
                Pinyin
              </button>
              <button onclick="toggleVocabColumn('meaning')" class="px-2.5 py-1 rounded-lg ${state.showMeaningInList ? 'bg-white shadow-xs font-semibold text-gray-800' : 'text-gray-400 line-through'}">
                Nghĩa
              </button>
              <button onclick="toggleVocabColumn('radical')" class="px-2.5 py-1 rounded-lg ${state.showRadicalInList ? 'bg-white shadow-xs font-semibold text-gray-800' : 'text-gray-400 line-through'}">
                Bộ thủ & Cấu tạo
              </button>
            </div>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider border-b border-gray-100">
              <tr>
                <th class="py-3.5 px-4 w-12 text-center">STT</th>
                <th class="py-3.5 px-4">Chữ Hán</th>
                <th class="py-3.5 px-4 ${state.showPinyinInList ? '' : 'filter blur-sm select-none'}">Phiên âm</th>
                <th class="py-3.5 px-4 ${state.showMeaningInList ? '' : 'filter blur-sm select-none'}">Ý nghĩa & Loại từ</th>
                ${state.showRadicalInList ? `<th class="py-3.5 px-4 min-w-[220px]">Bộ thủ & Chiết tự cấu tạo</th>` : ''}
                <th class="py-3.5 px-4">Ví dụ câu & Dịch</th>
                <th class="py-3.5 px-4 w-16 text-center">Nghe</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              ${(lesson.vocabulary || []).map((v, idx) => {
                const isMastered = !!state.masteredVocab[v.id];
                return `
                  <tr class="hover:bg-red-50/40 transition">
                    <td class="py-4 px-4 text-center font-mono text-xs text-gray-400">${idx + 1}</td>
                    <td class="py-4 px-4">
                      <div class="flex items-center gap-2">
                        <button onclick="toggleMastered('${v.id}')" class="text-xs ${isMastered ? 'text-emerald-500' : 'text-gray-300'}">
                          <i class="fas fa-check-circle"></i>
                        </button>
                        <span class="chinese-font text-2xl font-bold text-gray-900 hover:text-red-600 transition cursor-pointer" onclick="speakChinese('${v.hanzi}')">
                          ${v.hanzi}
                        </span>
                      </div>
                    </td>
                    <td class="py-4 px-4 font-mono font-medium text-red-600 ${state.showPinyinInList ? '' : 'filter blur-sm select-none'}">
                      ${v.pinyin}
                    </td>
                    <td class="py-4 px-4 ${state.showMeaningInList ? '' : 'filter blur-sm select-none'}">
                      <div class="font-medium text-gray-800">${v.meaning}</div>
                      ${v.type ? `<span class="inline-block mt-0.5 text-[10px] px-2 py-0.5 bg-gray-100 text-gray-600 rounded">${v.type}</span>` : ''}
                    </td>
                    ${state.showRadicalInList ? `
                      <td class="py-4 px-4">
                        <div class="space-y-1 text-xs">
                          ${v.radical ? `
                            <div class="inline-block px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200/60 font-semibold text-[11px]">
                              Bộ: ${v.radical}
                            </div>
                          ` : ''}
                          ${v.breakdown ? `<div class="text-gray-700 text-[11px] leading-tight">${v.breakdown}</div>` : ''}
                          ${v.mnemonic ? `<div class="text-amber-900 text-[10px] italic">💡 ${v.mnemonic}</div>` : ''}
                        </div>
                      </td>
                    ` : ''}
                    <td class="py-4 px-4">
                      ${v.example ? `
                        <div class="text-xs">
                          <div class="chinese-font font-medium text-gray-900 flex items-center gap-1.5">
                            <span>${v.example}</span>
                            <button onclick="speakChinese('${v.example}')" class="text-gray-400 hover:text-red-600">
                              <i class="fas fa-volume-up text-[10px]"></i>
                            </button>
                          </div>
                          <div class="text-red-600 font-mono text-[10px]">${v.examplePinyin || ''}</div>
                          <div class="text-gray-500 text-[11px] italic">${v.exampleMeaning || ''}</div>
                        </div>
                      ` : '<span class="text-gray-300 text-xs">--</span>'}
                    </td>
                    <td class="py-4 px-4 text-center">
                      <button onclick="speakChinese('${v.hanzi}')" class="w-8 h-8 rounded-full bg-gray-100 hover:bg-red-600 hover:text-white text-gray-600 transition flex items-center justify-center mx-auto text-xs">
                        <i class="fas fa-volume-up"></i>
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function flipFlashcard() {
  state.flashcardFlipped = !state.flashcardFlipped;
  soundFx.playFlip();
  const inner = document.querySelector('.flashcard-inner');
  if (inner) {
    if (state.flashcardFlipped) inner.classList.add('flipped');
    else inner.classList.remove('flipped');
  }
}

function nextFlashcard() {
  const current = getCurrentLesson();
  if (!current) return;
  const list = getFilteredVocabList(current);
  if (list.length === 0) return;
  state.flashcardFlipped = false;
  state.flashcardIndex = (state.flashcardIndex + 1) % list.length;
  renderApp();
}

function prevFlashcard() {
  const current = getCurrentLesson();
  if (!current) return;
  const list = getFilteredVocabList(current);
  if (list.length === 0) return;
  state.flashcardFlipped = false;
  state.flashcardIndex = (state.flashcardIndex - 1 + list.length) % list.length;
  renderApp();
}

function speakCurrentFlashcard() {
  const current = getCurrentLesson();
  if (!current) return;
  const list = getFilteredVocabList(current);
  const card = list[state.flashcardIndex];
  if (card) speakChinese(card.hanzi);
}

function setVocabFilter(filter) {
  state.flashcardFilter = filter;
  state.flashcardIndex = 0;
  state.flashcardFlipped = false;
  renderApp();
}

function toggleMastered(vocabId) {
  if (state.masteredVocab[vocabId]) {
    delete state.masteredVocab[vocabId];
  } else {
    state.masteredVocab[vocabId] = true;
    soundFx.playCorrect();
  }
  saveMasteredVocab();
  renderApp();
}

function shuffleFlashcards() {
  const current = getCurrentLesson();
  if (!current || !current.vocabulary) return;
  for (let i = current.vocabulary.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [current.vocabulary[i], current.vocabulary[j]] = [current.vocabulary[j], current.vocabulary[i]];
  }
  state.flashcardIndex = 0;
  state.flashcardFlipped = false;
  renderApp();
}

function searchVocab(val) {
  state.vocabSearch = val;
  state.flashcardIndex = 0;
  renderApp();
}

function toggleVocabColumn(type) {
  if (type === 'pinyin') state.showPinyinInList = !state.showPinyinInList;
  if (type === 'meaning') state.showMeaningInList = !state.showMeaningInList;
  if (type === 'radical') state.showRadicalInList = !state.showRadicalInList;
  renderApp();
}

// ==========================================
// FEATURE 2: BÀI KHOÁ & NGHE HSK
// ==========================================
function renderTextsSection(container, lesson) {
  const texts = lesson.texts || [];
  container.innerHTML = `
    <div class="space-y-8">
      <div class="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 rounded-3xl p-6 text-white shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div class="inline-flex items-center gap-2 bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-2">
            <i class="fas fa-headphones-alt"></i> Module 2: Bài khoá & Luyện nghe HSK
          </div>
          <h2 class="text-2xl md:text-3xl font-bold">Hội thoại thực tế & Luyện nghe</h2>
          <p class="text-white/90 text-sm mt-1">Đọc hiểu đoạn hội thoại, nghe giọng chuẩn và làm bài tập nghe hiểu format HSK.</p>
        </div>

        <div class="flex flex-wrap items-center gap-3 bg-white/10 backdrop-blur-md p-3 rounded-2xl border border-white/20 text-xs">
          <div class="flex items-center gap-2">
            <span>Tốc độ:</span>
            <select onchange="setSpeechRate(this.value)" class="bg-white text-gray-800 rounded-lg px-2 py-1 font-semibold focus:outline-none">
              <option value="0.7" ${state.speechRate === 0.7 ? 'selected' : ''}>Chậm (0.7x)</option>
              <option value="0.9" ${state.speechRate === 0.9 ? 'selected' : ''}>Vừa (0.9x)</option>
              <option value="1.0" ${state.speechRate === 1.0 ? 'selected' : ''}>Tự nhiên (1.0x)</option>
            </select>
          </div>
          <div class="flex items-center gap-2 border-l border-white/30 pl-3">
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" ${state.showTextPinyin ? 'checked' : ''} onchange="toggleTextPinyin()" class="rounded text-red-600">
              <span>Hiện Pinyin</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" ${state.showTextMeaning ? 'checked' : ''} onchange="toggleTextMeaning()" class="rounded text-red-600">
              <span>Hiện dịch nghĩa</span>
            </label>
          </div>
        </div>
      </div>

      ${texts.map((textItem, tIndex) => `
        <div class="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
          <div class="p-6 bg-emerald-50/50 border-b border-emerald-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <span class="text-xs font-bold text-emerald-700 uppercase tracking-widest">Bài khoá #${tIndex + 1}</span>
              <h3 class="text-xl font-bold text-gray-900 mt-0.5">${textItem.title}</h3>
              ${textItem.description ? `<p class="text-xs text-gray-600 mt-1">${textItem.description}</p>` : ''}
            </div>

            <div class="flex items-center gap-3">
              ${state.isPlayingDialogue ? `
                <button onclick="stopDialogueAudio()" class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm transition">
                  <i class="fas fa-stop"></i> Dừng đọc
                </button>
              ` : `
                <button onclick="playFullDialogue(${tIndex})" class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm transition active:scale-95">
                  <i class="fas fa-play"></i> Nghe toàn bài khoá
                </button>
              `}
            </div>
          </div>

          <div class="p-6 md:p-8 space-y-4">
            ${(textItem.sentences || []).map((s, sIndex) => {
              const isCurrentPlaying = state.isPlayingDialogue && state.dialogueSentenceIndex === sIndex;
              return `
                <div id="sentence-${sIndex}" class="p-4 rounded-2xl border border-gray-100 hover:border-emerald-200 transition-all flex items-start gap-4 ${isCurrentPlaying ? 'sentence-active' : 'bg-gray-50/50'}">
                  <div class="flex-shrink-0 w-24 md:w-32">
                    <span class="inline-block text-xs font-bold text-emerald-800 bg-emerald-100/70 px-2.5 py-1 rounded-lg">
                      ${s.speaker || 'Người nói'}
                    </span>
                  </div>
                  <div class="flex-grow space-y-1">
                    <div class="chinese-font text-lg md:text-xl font-semibold text-gray-900 tracking-wide">${s.displayHanzi || s.hanzi}</div>
                    ${state.showTextPinyin && s.pinyin ? `<div class="font-mono text-xs text-red-600 font-medium">${s.pinyin}</div>` : ''}
                    ${state.showTextMeaning && s.meaning ? `<div class="text-xs text-gray-600 italic pt-0.5">${s.meaning}</div>` : ''}
                  </div>
                  <button data-audio="${String(s.hanzi || '').replace(/"/g, '&quot;')}" onclick="speakChinese(this.dataset.audio)" class="flex-shrink-0 w-8 h-8 rounded-full bg-white hover:bg-emerald-600 hover:text-white border border-gray-200 text-gray-600 flex items-center justify-center text-xs transition active:scale-95">
                    <i class="fas fa-volume-up"></i>
                  </button>
                </div>
              `;
            }).join('')}
          </div>

          ${(textItem.listeningQuestions && textItem.listeningQuestions.length > 0) ? `
            <div class="p-6 md:p-8 bg-amber-50/40 border-t border-amber-100 space-y-6">
              <div class="flex items-center gap-2">
                <span class="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center text-sm font-bold shadow-sm">
                  <i class="fas fa-question"></i>
                </span>
                <div>
                  <h4 class="font-bold text-gray-900 text-base">Câu hỏi luyện nghe hiểu HSK</h4>
                  <p class="text-xs text-gray-500">Bấm nút loa để nghe đoạn ghi âm và chọn đáp án chính xác.</p>
                </div>
              </div>

              <div class="space-y-4">
                ${textItem.listeningQuestions.map((q, qIndex) => `
                  <div class="bg-white p-5 rounded-2xl border border-amber-200/80 shadow-xs space-y-3">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-md">Câu hỏi #${qIndex + 1}</span>
                      <button data-audio="${String(q.audioText || q.question || '').replace(/"/g, '&quot;')}" onclick="speakChinese(this.dataset.audio)" class="text-xs font-semibold text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition">
                        <i class="fas fa-volume-up"></i> Bấm để nghe câu hỏi HSK
                      </button>
                    </div>

                    <div class="text-sm font-semibold text-gray-800">${q.question}</div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1" id="lq-options-${tIndex}-${qIndex}">
                      ${q.options.map((opt, optIndex) => `
                        <button onclick="checkListeningAnswer(${tIndex}, ${qIndex}, ${optIndex})" class="lq-btn-${tIndex}-${qIndex} text-left p-3 rounded-xl border border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 text-xs font-medium text-gray-700 transition flex items-center gap-2.5">
                          <span class="w-6 h-6 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center text-xs font-bold font-mono">
                            ${String.fromCharCode(65 + optIndex)}
                          </span>
                          <span>${opt}</span>
                        </button>
                      `).join('')}
                    </div>

                    <div id="lq-feedback-${tIndex}-${qIndex}" class="hidden text-xs p-3 rounded-xl"></div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function setSpeechRate(val) {
  state.speechRate = parseFloat(val);
}

function toggleTextPinyin() {
  state.showTextPinyin = !state.showTextPinyin;
  renderApp();
}

function toggleTextMeaning() {
  state.showTextMeaning = !state.showTextMeaning;
  renderApp();
}

function playFullDialogue(textIndex) {
  const lesson = getCurrentLesson();
  if (!lesson || !lesson.texts || !lesson.texts[textIndex]) return;
  const sentences = lesson.texts[textIndex].sentences || [];
  if (sentences.length === 0) return;
  
  state.isPlayingDialogue = true;
  state.dialogueSentenceIndex = 0;
  
  function playNext(idx) {
    if (!state.isPlayingDialogue) return;
    if (idx >= sentences.length) {
      stopDialogueAudio();
      return;
    }
    state.dialogueSentenceIndex = idx;
    document.querySelectorAll('[id^="sentence-"]').forEach(el => el.classList.remove('sentence-active'));
    const currEl = document.getElementById(`sentence-${idx}`);
    if (currEl) {
      currEl.classList.add('sentence-active');
      currEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    speakChinese(sentences[idx].hanzi, state.speechRate, () => {
      if (state.isPlayingDialogue) {
        state.dialogueTimer = setTimeout(() => {
          playNext(idx + 1);
        }, 700);
      }
    });
  }
  playNext(0);
  renderApp();
}

function stopDialogueAudio() {
  state.isPlayingDialogue = false;
  state.dialogueSentenceIndex = -1;
  if (state.dialogueTimer) clearTimeout(state.dialogueTimer);
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  document.querySelectorAll('[id^="sentence-"]').forEach(el => el.classList.remove('sentence-active'));
  renderApp();
}

function checkListeningAnswer(textIndex, qIndex, selectedIndex) {
  const lesson = getCurrentLesson();
  if (!lesson) return;
  const q = lesson.texts[textIndex].listeningQuestions[qIndex];
  if (!q) return;
  
  const feedbackEl = document.getElementById(`lq-feedback-${textIndex}-${qIndex}`);
  const buttons = document.querySelectorAll(`.lq-btn-${textIndex}-${qIndex}`);
  
  buttons.forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === q.correctIndex) {
      btn.className = "text-left p-3 rounded-xl border border-emerald-500 bg-emerald-50 text-xs font-semibold text-emerald-800 flex items-center gap-2.5";
    } else if (idx === selectedIndex) {
      btn.className = "text-left p-3 rounded-xl border border-red-500 bg-red-50 text-xs font-semibold text-red-800 flex items-center gap-2.5";
    }
  });

  if (selectedIndex === q.correctIndex) {
    soundFx.playCorrect();
    feedbackEl.className = "text-xs p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-start gap-2";
    feedbackEl.innerHTML = `<i class="fas fa-check-circle text-emerald-600 mt-0.5"></i> <div><strong>Chính xác!</strong> ${q.explanation || ''}</div>`;
  } else {
    soundFx.playWrong();
    feedbackEl.className = "text-xs p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 flex items-start gap-2";
    feedbackEl.innerHTML = `<i class="fas fa-times-circle text-red-600 mt-0.5"></i> <div><strong>Chưa đúng!</strong> Đáp án đúng là: <b>${String.fromCharCode(65 + q.correctIndex)}. ${q.options[q.correctIndex]}</b>. ${q.explanation || ''}</div>`;
  }
  feedbackEl.classList.remove('hidden');
}

// ==========================================
// FEATURE 3: NGỮ PHÁP (GRAMMAR)
// ==========================================
function renderGrammarSection(container, lesson) {
  const grammarList = lesson.grammar || [];
  container.innerHTML = `
    <div class="space-y-8">
      <div class="bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 rounded-3xl p-6 text-white shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div class="inline-flex items-center gap-2 bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-2">
            <i class="fas fa-code-branch"></i> Module 3: Ngữ pháp trọng tâm
          </div>
          <h2 class="text-2xl md:text-3xl font-bold">Cấu trúc & Quy tắc ngữ pháp</h2>
          <p class="text-white/90 text-sm mt-1">Nắm vững công thức, phân tích lỗi sai người Việt hay mắc và làm bài tập củng cố.</p>
        </div>
        <div class="bg-white/10 backdrop-blur-md px-6 py-4 rounded-2xl border border-white/20 text-center">
          <span class="text-3xl font-black">${grammarList.length}</span>
          <p class="text-xs text-white/80 uppercase font-medium">Cấu trúc bài này</p>
        </div>
      </div>

      ${grammarList.map((g, gIdx) => `
        <div class="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
          <div class="p-6 bg-blue-50/60 border-b border-blue-100 flex items-start gap-4">
            <span class="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-sm flex-shrink-0">
              #${gIdx + 1}
            </span>
            <div class="flex-grow">
              <h3 class="text-xl font-bold text-gray-900">${g.title}</h3>
              <div class="inline-flex items-center gap-2 mt-2 px-4 py-2 bg-white rounded-xl border border-blue-200 shadow-xs text-xs font-mono font-bold text-blue-700">
                <i class="fas fa-calculator text-blue-500"></i> Công thức: ${g.formula}
              </div>
            </div>
          </div>

          <div class="p-6 md:p-8 space-y-6">
            <div class="space-y-2">
              <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wider">Giải thích chi tiết</h4>
              <p class="text-sm text-gray-700 leading-relaxed bg-gray-50/60 p-4 rounded-2xl border border-gray-100">${g.explanation}</p>
            </div>

            ${g.notes ? `
              <div class="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 text-xs text-amber-900 flex items-start gap-3">
                <i class="fas fa-exclamation-triangle text-amber-600 text-base flex-shrink-0 mt-0.5"></i>
                <div>
                  <strong class="font-bold">Lưu ý quan trọng cho người Việt:</strong>
                  <div class="mt-1 leading-relaxed">${g.notes}</div>
                </div>
              </div>
            ` : ''}

            <div class="space-y-3">
              <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wider">Ví dụ câu thực tế</h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                ${(g.examples || []).map(ex => `
                  <div class="p-4 rounded-2xl border border-gray-200 bg-white flex flex-col justify-between">
                    <div class="space-y-1">
                      <div class="chinese-font text-base font-bold text-gray-900 flex items-center justify-between">
                        <span>${ex.hanzi}</span>
                        <button onclick="speakChinese('${ex.hanzi}')" class="text-gray-400 hover:text-blue-600 p-1">
                          <i class="fas fa-volume-up text-xs"></i>
                        </button>
                      </div>
                      ${ex.pinyin ? `<div class="text-xs font-mono text-red-600">${ex.pinyin}</div>` : ''}
                      <div class="text-xs text-gray-600 italic pt-1">→ ${ex.meaning}</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ==========================================
// FEATURE 4: HỆ THỐNG 4 TRÒ CHƠI & BÀI TẬP THEO YÊU CẦU
// 1. Ghép Hán tự + Pinyin + Nghĩa
// 2. Sắp xếp câu Hán tự
// 3. Gõ câu dịch song ngữ Việt <-> Trung
// 4. Trắc nghiệm mở rộng (20+ câu)
// ==========================================
function renderGamesSection(container, lesson) {
  container.innerHTML = `
    <div class="space-y-8">
      <!-- Section Header -->
      <div class="bg-gradient-to-r from-purple-600 via-pink-600 to-rose-500 rounded-3xl p-6 text-white shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div class="inline-flex items-center gap-2 bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-2">
            <i class="fas fa-gamepad"></i> Module 4: Trò chơi & Bài tập luyện phản xạ
          </div>
          <h2 class="text-2xl md:text-3xl font-bold">4 Trò chơi & Bài tập tương tác</h2>
          <p class="text-white/90 text-sm mt-1">Ghép bộ 3 (Hán tự + Pinyin + Nghĩa), Xếp câu, Gõ dịch song ngữ và Trắc nghiệm mở rộng 20+ câu.</p>
        </div>

        <!-- 4 Game Selector Buttons -->
        <div class="grid grid-cols-2 gap-1.5 bg-white/20 backdrop-blur-md p-1.5 rounded-2xl border border-white/20 text-xs font-semibold">
          <button onclick="switchGameMode('tri_match')" class="px-3 py-2 rounded-xl transition text-left ${state.activeGame === 'tri_match' ? 'bg-white text-purple-700 shadow-md font-bold' : 'text-white hover:bg-white/10'}">
            <i class="fas fa-layer-group mr-1.5"></i> 1. Ghép Hán+Pinyin+Nghĩa
          </button>
          <button onclick="switchGameMode('scramble')" class="px-3 py-2 rounded-xl transition text-left ${state.activeGame === 'scramble' ? 'bg-white text-purple-700 shadow-md font-bold' : 'text-white hover:bg-white/10'}">
            <i class="fas fa-sort-alpha-down mr-1.5"></i> 2. Sắp xếp câu Hán tự
          </button>
          <button onclick="switchGameMode('translation')" class="px-3 py-2 rounded-xl transition text-left ${state.activeGame === 'translation' ? 'bg-white text-purple-700 shadow-md font-bold' : 'text-white hover:bg-white/10'}">
            <i class="fas fa-keyboard mr-1.5"></i> 3. Gõ câu dịch Việt - Trung
          </button>
          <button onclick="switchGameMode('expanded_quiz')" class="px-3 py-2 rounded-xl transition text-left ${state.activeGame === 'expanded_quiz' ? 'bg-white text-purple-700 shadow-md font-bold' : 'text-white hover:bg-white/10'}">
            <i class="fas fa-list-check mr-1.5"></i> 4. Trắc nghiệm mở rộng (20+)
          </button>
        </div>
      </div>

      <!-- Playground -->
      <div id="game-playground" class="bg-white rounded-3xl border border-gray-200 shadow-sm p-6 md:p-8">
        ${renderActiveGameContent(lesson)}
      </div>
    </div>
  `;
}

function switchGameMode(mode) {
  state.activeGame = mode;
  if (mode === 'tri_match') initTriMatchGame();
  else if (mode === 'scramble') initScrambleGame();
  else if (mode === 'translation') initTranslationGame();
  else if (mode === 'expanded_quiz') initExpandedQuiz();
  renderApp();
}

function renderActiveGameContent(lesson) {
  if (state.activeGame === 'tri_match') return renderTriMatchGameHTML();
  if (state.activeGame === 'scramble') return renderScrambleGameHTML(lesson);
  if (state.activeGame === 'translation') return renderTranslationGameHTML(lesson);
  if (state.activeGame === 'expanded_quiz') return renderExpandedQuizHTML(lesson);
}

// ----------------------------------------------------
// GAME 1: GHÉP HÁN TỰ + PINYIN + NGHĨA (TRIPLE MATCH)
// ----------------------------------------------------
function initTriMatchGame() {
  const lesson = getCurrentLesson();
  if (!lesson || !lesson.vocabulary || lesson.vocabulary.length < 3) return;

  // Pick 4 words
  const pool = [...lesson.vocabulary].sort(() => 0.5 - Math.random()).slice(0, 4);
  
  if (state.triMatchGame.timerInterval) clearInterval(state.triMatchGame.timerInterval);

  state.triMatchGame = {
    words: pool,
    selectedHanzi: null,
    selectedPinyin: null,
    selectedMeaning: null,
    matchedIds: [],
    score: 0,
    combo: 0,
    timeElapsed: 0,
    isCompleted: false,
    timerInterval: setInterval(() => {
      state.triMatchGame.timeElapsed++;
      const timerEl = document.getElementById('tri-timer');
      if (timerEl) {
        const m = Math.floor(state.triMatchGame.timeElapsed / 60);
        const s = state.triMatchGame.timeElapsed % 60;
        timerEl.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      }
    }, 1000)
  };
}

function renderTriMatchGameHTML() {
  const g = state.triMatchGame;
  if (!g.words || g.words.length === 0) initTriMatchGame();

  if (g.isCompleted) {
    return `
      <div class="text-center py-12 space-y-4 max-w-md mx-auto pop-in">
        <div class="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-3xl mx-auto flex items-center justify-center text-4xl shadow-inner">
          <i class="fas fa-trophy"></i>
        </div>
        <h3 class="text-2xl font-bold text-gray-900">Ghép bộ ba hoàn tất!</h3>
        <p class="text-sm text-gray-600">Bạn đã nối chính xác toàn bộ chữ Hán, Pinyin và Nghĩa tương ứng.</p>
        <div class="flex items-center justify-center gap-6 py-4 bg-gray-50 rounded-2xl border border-gray-100">
          <div>
            <span class="text-2xl font-black text-purple-600">${g.score}</span>
            <p class="text-xs text-gray-400 uppercase font-medium">Điểm</p>
          </div>
          <div class="w-px h-8 bg-gray-200"></div>
          <div>
            <span class="text-2xl font-black text-gray-700">${g.timeElapsed}s</span>
            <p class="text-xs text-gray-400 uppercase font-medium">Thời gian</p>
          </div>
        </div>
        <button onclick="initTriMatchGame(); renderApp()" class="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-sm shadow-md transition">
          <i class="fas fa-redo-alt mr-2"></i> Chơi ván mới
        </button>
      </div>
    `;
  }

  // Shuffled items for each of the 3 columns
  const hanziList = [...g.words].sort((a,b) => a.id.localeCompare(b.id));
  const pinyinList = [...g.words].sort((a,b) => b.id.localeCompare(a.id));
  const meaningList = [...g.words].sort((a,b) => a.hanzi.localeCompare(b.hanzi));

  return `
    <div class="space-y-6">
      <div class="flex items-center justify-between pb-4 border-b border-gray-100 text-sm">
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2 text-gray-600">
            <i class="far fa-clock text-purple-600"></i>
            <span id="tri-timer" class="font-mono font-bold text-gray-800">00:00</span>
          </div>
          <div class="flex items-center gap-2 text-gray-600">
            <i class="fas fa-fire text-amber-500"></i>
            <span class="font-semibold">Điểm: <span class="text-purple-700 font-bold">${g.score}</span></span>
          </div>
          ${g.combo > 1 ? `<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold animate-bounce">${g.combo}x Combo!</span>` : ''}
        </div>
        <span class="text-xs text-gray-500 hidden sm:inline">Chọn 1 Chữ Hán + 1 Pinyin + 1 Nghĩa tương ứng để tạo bộ 3</span>
      </div>

      <!-- 3 Columns Layout -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        <!-- Column 1: Chữ Hán -->
        <div class="space-y-3 bg-red-50/40 p-4 rounded-2xl border border-red-100">
          <h4 class="text-xs font-bold text-red-700 uppercase tracking-wider text-center flex items-center justify-center gap-1.5">
            <span class="w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center text-[10px]">1</span> Chữ Hán
          </h4>
          <div class="space-y-2.5">
            ${hanziList.map(item => {
              const isMatched = g.matchedIds.includes(item.id);
              const isSelected = g.selectedHanzi === item.id;
              return `
                <button 
                  onclick="selectTriCard('hanzi', '${item.id}')"
                  ${isMatched ? 'disabled' : ''}
                  class="w-full p-4 rounded-xl border-2 transition text-center flex flex-col items-center justify-center ${isMatched ? 'border-emerald-500 bg-emerald-50 opacity-50 cursor-default' : (isSelected ? 'border-red-600 bg-red-100 shadow-md ring-2 ring-red-300' : 'border-gray-200 bg-white hover:border-red-300')}"
                >
                  <span class="chinese-font text-3xl font-bold text-gray-900">${item.hanzi}</span>
                  ${item.radical ? `<span class="text-[10px] text-gray-400 mt-1">Bộ: ${item.radical}</span>` : ''}
                </button>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Column 2: Pinyin -->
        <div class="space-y-3 bg-amber-50/40 p-4 rounded-2xl border border-amber-100">
          <h4 class="text-xs font-bold text-amber-700 uppercase tracking-wider text-center flex items-center justify-center gap-1.5">
            <span class="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center text-[10px]">2</span> Phiên âm Pinyin
          </h4>
          <div class="space-y-2.5">
            ${pinyinList.map(item => {
              const isMatched = g.matchedIds.includes(item.id);
              const isSelected = g.selectedPinyin === item.id;
              return `
                <button 
                  onclick="selectTriCard('pinyin', '${item.id}')"
                  ${isMatched ? 'disabled' : ''}
                  class="w-full p-4 rounded-xl border-2 transition text-center flex flex-col items-center justify-center ${isMatched ? 'border-emerald-500 bg-emerald-50 opacity-50 cursor-default' : (isSelected ? 'border-amber-600 bg-amber-100 shadow-md ring-2 ring-amber-300' : 'border-gray-200 bg-white hover:border-amber-300')}"
                >
                  <span class="font-mono text-lg font-bold text-amber-700">${item.pinyin}</span>
                  <span class="text-[10px] text-gray-400 mt-1 font-mono">${item.sinoVietnamese ? `[ ${item.sinoVietnamese} ]` : 'Pinyin'}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Column 3: Nghĩa tiếng Việt -->
        <div class="space-y-3 bg-emerald-50/40 p-4 rounded-2xl border border-emerald-100">
          <h4 class="text-xs font-bold text-emerald-700 uppercase tracking-wider text-center flex items-center justify-center gap-1.5">
            <span class="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px]">3</span> Ý nghĩa tiếng Việt
          </h4>
          <div class="space-y-2.5">
            ${meaningList.map(item => {
              const isMatched = g.matchedIds.includes(item.id);
              const isSelected = g.selectedMeaning === item.id;
              return `
                <button 
                  onclick="selectTriCard('meaning', '${item.id}')"
                  ${isMatched ? 'disabled' : ''}
                  class="w-full p-4 rounded-xl border-2 transition text-center flex flex-col items-center justify-center ${isMatched ? 'border-emerald-500 bg-emerald-50 opacity-50 cursor-default' : (isSelected ? 'border-emerald-600 bg-emerald-100 shadow-md ring-2 ring-emerald-300' : 'border-gray-200 bg-white hover:border-emerald-300')}"
                >
                  <span class="font-semibold text-sm text-gray-800">${item.meaning}</span>
                  ${item.type ? `<span class="text-[10px] text-gray-400 mt-1">${item.type}</span>` : ''}
                </button>
              `;
            }).join('')}
          </div>
        </div>

      </div>
    </div>
  `;
}

function selectTriCard(type, id) {
  const g = state.triMatchGame;
  if (g.isCompleted) return;
  soundFx.playFlip();

  if (type === 'hanzi') g.selectedHanzi = g.selectedHanzi === id ? null : id;
  if (type === 'pinyin') g.selectedPinyin = g.selectedPinyin === id ? null : id;
  if (type === 'meaning') g.selectedMeaning = g.selectedMeaning === id ? null : id;

  renderApp();

  // If all 3 slots chosen, check match!
  if (g.selectedHanzi && g.selectedPinyin && g.selectedMeaning) {
    if (g.selectedHanzi === g.selectedPinyin && g.selectedPinyin === g.selectedMeaning) {
      // MATCH SUCCESS!
      setTimeout(() => {
        soundFx.playCorrect();
        g.matchedIds.push(g.selectedHanzi);
        g.combo++;
        g.score += 150 * g.combo;
        g.selectedHanzi = null;
        g.selectedPinyin = null;
        g.selectedMeaning = null;

        if (g.matchedIds.length === g.words.length) {
          clearInterval(g.timerInterval);
          g.isCompleted = true;
          soundFx.playVictory();
        }
        renderApp();
      }, 300);
    } else {
      // MISMATCH
      setTimeout(() => {
        soundFx.playWrong();
        g.combo = 0;
        g.selectedHanzi = null;
        g.selectedPinyin = null;
        g.selectedMeaning = null;
        renderApp();
      }, 600);
    }
  }
}

// ----------------------------------------------------
// GAME 2: SẮP XẾP CÂU HÁN TỰ (SENTENCE SCRAMBLE)
// ----------------------------------------------------
function initScrambleGame() {
  state.scrambleGame.index = 0;
  loadCurrentScrambleQuestion();
}

function loadCurrentScrambleQuestion() {
  const lesson = getCurrentLesson();
  const qList = (lesson.exercises && lesson.exercises.sentenceScramble) || [];
  if (state.scrambleGame.index >= qList.length) state.scrambleGame.index = 0;
  const q = qList[state.scrambleGame.index];
  if (!q) return;

  state.scrambleGame.selectedTokens = [];
  state.scrambleGame.availableTokens = [...q.tokens].sort(() => 0.5 - Math.random());
  state.scrambleGame.isCorrect = null;
}

function renderScrambleGameHTML(lesson) {
  const qList = (lesson.exercises && lesson.exercises.sentenceScramble) || [];
  if (qList.length === 0) {
    return `<div class="p-8 text-center text-gray-500">Chưa có bài tập sắp xếp câu cho buổi này.</div>`;
  }

  const q = qList[state.scrambleGame.index];
  if (!q) return '';

  return `
    <div class="space-y-6 max-w-xl mx-auto">
      <div class="flex items-center justify-between pb-3 border-b border-gray-100 text-xs text-gray-500">
        <span class="font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-md">Câu ${state.scrambleGame.index + 1} / ${qList.length}</span>
        <span>Bấm vào các từ bên dưới để ghép thành câu đúng</span>
      </div>

      <div class="text-center py-2">
        <span class="text-xs uppercase text-gray-400 font-bold tracking-wider">Ý nghĩa câu cần ghép:</span>
        <div class="text-xl font-bold text-gray-800 mt-1">"${q.targetMeaning}"</div>
        ${q.unlearnedHint ? `<div class="inline-block mt-2 px-3 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-xs font-medium">${q.unlearnedHint}</div>` : ''}
      </div>

      <!-- Assembled sentence container -->
      <div class="min-h-[76px] p-4 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-300 flex flex-wrap items-center justify-center gap-2">
        ${state.scrambleGame.selectedTokens.length === 0 ? `
          <span class="text-xs text-gray-400 italic">Chọn các khối từ bên dưới để xếp câu...</span>
        ` : state.scrambleGame.selectedTokens.map((tok, sIdx) => `
          <button 
            onclick="removeScrambleToken(${sIdx})"
            class="px-4 py-2 bg-white text-gray-900 border border-purple-200 hover:border-red-400 hover:text-red-600 rounded-xl font-bold chinese-font text-lg shadow-xs transition"
            title="Bấm để gỡ từ này"
          >
            ${tok}
          </button>
        `).join('')}
      </div>

      <!-- Available Tokens -->
      <div class="flex flex-wrap items-center justify-center gap-3 pt-2">
        ${state.scrambleGame.availableTokens.map((tok, aIdx) => `
          <button 
            onclick="selectScrambleToken(${aIdx})"
            class="px-5 py-2.5 bg-purple-50 hover:bg-purple-600 hover:text-white text-purple-900 border border-purple-200 rounded-xl font-bold chinese-font text-lg shadow-sm transition active:scale-95"
          >
            ${tok}
          </button>
        `).join('')}
      </div>

      <!-- Controls -->
      <div class="flex items-center justify-center gap-3 pt-4">
        <button onclick="resetScrambleQuestion()" class="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-xl transition">
          <i class="fas fa-undo mr-1"></i> Làm lại
        </button>
        <button onclick="checkScrambleAnswer()" class="px-6 py-2.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-md transition">
          Kiểm tra câu
        </button>
        ${state.scrambleGame.isCorrect === true ? `
          <button onclick="nextScrambleQuestion()" class="px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md transition pop-in">
            Câu tiếp theo <i class="fas fa-arrow-right ml-1"></i>
          </button>
        ` : ''}
      </div>

      ${state.scrambleGame.isCorrect !== null ? `
        <div class="p-4 rounded-2xl text-xs font-medium text-center pop-in ${state.scrambleGame.isCorrect ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}">
          ${state.scrambleGame.isCorrect ? `
            <div class="flex items-center justify-center gap-2">
              <i class="fas fa-check-circle text-emerald-600 text-base"></i>
              <span>Xuất sắc! Câu chuẩn: <b>${q.targetHanzi}</b> (${q.pinyin || ''})</span>
              <button onclick="speakChinese('${q.targetHanzi}')" class="ml-2 text-emerald-700 hover:text-emerald-900">
                <i class="fas fa-volume-up"></i>
              </button>
            </div>
          ` : `
            <div class="flex items-center justify-center gap-2">
              <i class="fas fa-times-circle text-red-600 text-base"></i>
              <span>Chưa chính xác, hãy kiểm tra lại trật tự ngữ pháp nhé!</span>
            </div>
          `}
        </div>
      ` : ''}
    </div>
  `;
}

function selectScrambleToken(idx) {
  const tok = state.scrambleGame.availableTokens.splice(idx, 1)[0];
  state.scrambleGame.selectedTokens.push(tok);
  state.scrambleGame.isCorrect = null;
  soundFx.playFlip();
  renderApp();
}

function removeScrambleToken(idx) {
  const tok = state.scrambleGame.selectedTokens.splice(idx, 1)[0];
  state.scrambleGame.availableTokens.push(tok);
  state.scrambleGame.isCorrect = null;
  soundFx.playFlip();
  renderApp();
}

function resetScrambleQuestion() {
  loadCurrentScrambleQuestion();
  renderApp();
}

function checkScrambleAnswer() {
  const lesson = getCurrentLesson();
  const q = lesson.exercises.sentenceScramble[state.scrambleGame.index];
  if (!q) return;
  const targetClean = q.targetHanzi.replace(/\s+/g, '');
  const userClean = state.scrambleGame.selectedTokens.join('').replace(/\s+/g, '');
  if (userClean === targetClean) {
    state.scrambleGame.isCorrect = true;
    soundFx.playCorrect();
  } else {
    state.scrambleGame.isCorrect = false;
    soundFx.playWrong();
  }
  renderApp();
}

function nextScrambleQuestion() {
  const lesson = getCurrentLesson();
  state.scrambleGame.index = (state.scrambleGame.index + 1) % lesson.exercises.sentenceScramble.length;
  loadCurrentScrambleQuestion();
  renderApp();
}

// ----------------------------------------------------
// GAME 3: GÕ CÂU DỊCH VIỆT <-> TRUNG (TRANSLATION PRACTICE)
// ----------------------------------------------------
function initTranslationGame() {
  state.translationGame.index = 0;
  state.translationGame.userInput = '';
  state.translationGame.isChecked = false;
  state.translationGame.isCorrect = false;
  state.translationGame.showHint = false;
  state.translationGame.showAnswer = false;
}

function renderTranslationGameHTML(lesson) {
  const allList = (lesson.exercises && lesson.exercises.translationExercises) || [];
  const list = allList.filter(item => item.direction === state.translationGame.mode);
  
  if (list.length === 0) {
    return `<div class="p-8 text-center text-gray-500">Chưa có bài tập dịch cho chế độ này.</div>`;
  }

  if (state.translationGame.index >= list.length) {
    state.translationGame.index = 0;
  }
  const curr = list[state.translationGame.index];

  return `
    <div class="space-y-6 max-w-xl mx-auto">
      <!-- Direction Toggle Subtabs -->
      <div class="flex items-center justify-between pb-3 border-b border-gray-100">
        <div class="inline-flex bg-gray-100 p-1 rounded-xl text-xs font-semibold">
          <button 
            onclick="setTranslationMode('vi_to_zh')"
            class="px-4 py-2 rounded-lg transition ${state.translationGame.mode === 'vi_to_zh' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'}"
          >
            🇻🇳 Dịch Việt → Trung 🇨🇳
          </button>
          <button 
            onclick="setTranslationMode('zh_to_vi')"
            class="px-4 py-2 rounded-lg transition ${state.translationGame.mode === 'zh_to_vi' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'}"
          >
            🇨🇳 Dịch Trung → Việt 🇻🇳
          </button>
        </div>

        <span class="text-xs text-gray-400 font-mono font-bold">
          Câu ${state.translationGame.index + 1} / ${list.length}
        </span>
      </div>

      <!-- Prompt Question Card -->
      <div class="p-6 bg-gradient-to-r from-purple-50/70 to-indigo-50/70 rounded-2xl border border-purple-100 space-y-2">
        <span class="text-xs font-bold text-purple-700 uppercase tracking-wider block">
          ${state.translationGame.mode === 'vi_to_zh' ? 'Câu tiếng Việt cần dịch:' : 'Câu tiếng Trung cần dịch:'}
        </span>
        <div class="text-xl font-bold text-gray-900 ${state.translationGame.mode === 'zh_to_vi' ? 'chinese-font text-2xl' : ''}">
          ${curr.promptText}
        </div>
        ${curr.promptPinyin ? `
          <div class="text-xs font-mono text-red-600 flex items-center gap-2">
            <span>${curr.promptPinyin}</span>
            <button onclick="speakChinese('${curr.promptText}')" class="text-purple-600 hover:text-purple-800">
              <i class="fas fa-volume-up"></i>
            </button>
          </div>
        ` : ''}
      </div>

      <!-- Input Area -->
      <div class="space-y-2">
        <label class="text-xs font-bold text-gray-600 block">
          ${state.translationGame.mode === 'vi_to_zh' ? 'Gõ bản dịch tiếng Trung (chấp nhận cả chữ Hán hoặc Pinyin):' : 'Gõ bản dịch tiếng Việt:'}
        </label>
        <textarea 
          id="trans-input"
          rows="3" 
          placeholder="${state.translationGame.mode === 'vi_to_zh' ? 'Gõ chữ Hán hoặc Pinyin vào đây...' : 'Gõ nghĩa tiếng Việt vào đây...'}"
          class="w-full p-4 rounded-2xl border-2 border-gray-200 focus:border-purple-500 focus:outline-none text-base font-medium"
        >${state.translationGame.userInput}</textarea>
      </div>

      <!-- Control Buttons -->
      <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div class="flex items-center gap-2">
          ${curr.hint ? `
            <button onclick="toggleTranslationHint()" class="text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 px-3 py-2 rounded-xl border border-amber-200 transition">
              <i class="fas fa-lightbulb mr-1"></i> ${state.translationGame.showHint ? 'Ẩn gợi ý' : 'Gợi ý từ vựng'}
            </button>
          ` : ''}
          <button onclick="toggleTranslationAnswer()" class="text-xs font-semibold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-xl transition">
            <i class="fas fa-eye mr-1"></i> Xem đáp án
          </button>
        </div>

        <div class="flex items-center gap-2">
          <button onclick="checkTranslation()" class="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-md transition">
            Kiểm tra bản dịch
          </button>
          ${state.translationGame.isChecked ? `
            <button onclick="nextTranslationQuestion()" class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md transition pop-in">
              Câu tiếp theo <i class="fas fa-arrow-right ml-1"></i>
            </button>
          ` : ''}
        </div>
      </div>

      <!-- Hint Box -->
      ${state.translationGame.showHint && curr.hint ? `
        <div class="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 pop-in">
          💡 <b>Gợi ý:</b> ${curr.hint}
        </div>
      ` : ''}

      <!-- Result Feedback -->
      ${state.translationGame.isChecked ? `
        <div class="p-5 rounded-2xl border pop-in space-y-2 ${state.translationGame.isCorrect ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'}">
          <div class="flex items-center gap-2 font-bold text-sm">
            <i class="fas ${state.translationGame.isCorrect ? 'fa-check-circle text-emerald-600' : 'fa-info-circle text-rose-600'}"></i>
            <span>${state.translationGame.isCorrect ? 'Bản dịch rất chính xác!' : 'Bản dịch cần chỉnh sửa lại cho sát nghĩa'}</span>
          </div>
          <div class="text-xs space-y-1 pt-1">
            <div><b>Đáp án mẫu:</b> <span class="font-bold chinese-font text-sm">${curr.expectedChinese || curr.expectedVietnamese}</span></div>
            ${curr.explanation ? `<div class="text-gray-600">💡 ${curr.explanation}</div>` : ''}
          </div>
        </div>
      ` : ''}

      <!-- Answer Reveal Box -->
      ${state.translationGame.showAnswer ? `
        <div class="p-4 bg-gray-50 rounded-2xl border border-gray-200 text-xs text-gray-800 space-y-1.5 pop-in">
          <div class="font-bold text-gray-500 uppercase tracking-wider">Đáp án chuẩn:</div>
          <div class="chinese-font text-base font-bold text-gray-900">${curr.expectedChinese || curr.expectedVietnamese}</div>
          ${curr.acceptedPinyin ? `<div class="font-mono text-red-600">${curr.acceptedPinyin}</div>` : ''}
          ${curr.explanation ? `<div class="text-gray-600 italic pt-1">${curr.explanation}</div>` : ''}
        </div>
      ` : ''}
    </div>
  `;
}

function setTranslationMode(mode) {
  state.translationGame.mode = mode;
  state.translationGame.index = 0;
  state.translationGame.userInput = '';
  state.translationGame.isChecked = false;
  state.translationGame.showHint = false;
  state.translationGame.showAnswer = false;
  renderApp();
}

function toggleTranslationHint() {
  state.translationGame.showHint = !state.translationGame.showHint;
  renderApp();
}

function toggleTranslationAnswer() {
  state.translationGame.showAnswer = !state.translationGame.showAnswer;
  renderApp();
}

function checkTranslation() {
  const inputEl = document.getElementById('trans-input');
  if (inputEl) state.translationGame.userInput = inputEl.value;
  
  const userText = (state.translationGame.userInput || '').toLowerCase().trim();
  const lesson = getCurrentLesson();
  const allList = (lesson.exercises && lesson.exercises.translationExercises) || [];
  const list = allList.filter(item => item.direction === state.translationGame.mode);
  const curr = list[state.translationGame.index];
  if (!curr) return;

  state.translationGame.isChecked = true;

  if (curr.direction === 'vi_to_zh') {
    const cleanExpectedZh = (curr.expectedChinese || '').replace(/[^\p{L}\p{N}]/gu, '');
    const cleanUser = userText.replace(/[^\p{L}\p{N}]/gu, '');
    const cleanPinyin = (curr.acceptedPinyin || '').replace(/[^a-zA-Z0-9]/g, '');
    
    if (cleanUser === cleanExpectedZh || (cleanPinyin && cleanUser === cleanPinyin) || (cleanUser.length > 2 && cleanExpectedZh.includes(cleanUser))) {
      state.translationGame.isCorrect = true;
      soundFx.playCorrect();
    } else {
      state.translationGame.isCorrect = false;
      soundFx.playWrong();
    }
  } else {
    // zh_to_vi
    let matchedKeywords = 0;
    const keywords = curr.acceptableKeywords || ['tôi', 'bạn'];
    keywords.forEach(kw => {
      if (userText.includes(kw.toLowerCase())) matchedKeywords++;
    });
    if (matchedKeywords >= Math.ceil(keywords.length * 0.5) || userText.length > 5) {
      state.translationGame.isCorrect = true;
      soundFx.playCorrect();
    } else {
      state.translationGame.isCorrect = false;
      soundFx.playWrong();
    }
  }
  renderApp();
}

function nextTranslationQuestion() {
  const lesson = getCurrentLesson();
  const allList = (lesson.exercises && lesson.exercises.translationExercises) || [];
  const list = allList.filter(item => item.direction === state.translationGame.mode);
  state.translationGame.index = (state.translationGame.index + 1) % list.length;
  state.translationGame.userInput = '';
  state.translationGame.isChecked = false;
  state.translationGame.showHint = false;
  state.translationGame.showAnswer = false;
  renderApp();
}

// ----------------------------------------------------
// GAME 4: BỘ ĐỀ TRẮC NGHIỆM MỞ RỘNG (20+ CÂU HỎI)
// ----------------------------------------------------
function initExpandedQuiz() {
  state.expandedQuizGame.index = 0;
  state.expandedQuizGame.userAnswers = {};
  state.expandedQuizGame.isCompleted = false;
  state.expandedQuizGame.score = 0;
  state.expandedQuizGame.streak = 0;
}

function renderExpandedQuizHTML(lesson) {
  const qList = (lesson.exercises && lesson.exercises.expandedQuiz) || [];
  if (qList.length === 0) {
    return `<div class="p-8 text-center text-gray-500">Chưa có bộ đề trắc nghiệm mở rộng cho buổi này.</div>`;
  }

  const g = state.expandedQuizGame;

  // Completion Screen
  if (g.isCompleted) {
    const totalQ = qList.length;
    let correctCount = 0;
    qList.forEach((q, idx) => {
      if (g.userAnswers[idx] === q.correctIndex) correctCount++;
    });
    const percentage = Math.round((correctCount / totalQ) * 100);

    return `
      <div class="text-center py-10 space-y-6 max-w-xl mx-auto pop-in">
        <div class="w-24 h-24 rounded-3xl bg-purple-100 text-purple-600 flex items-center justify-center text-5xl mx-auto shadow-inner">
          <i class="fas fa-medal"></i>
        </div>
        <div>
          <h3 class="text-3xl font-black text-gray-900">Hoàn thành bài trắc nghiệm mở rộng!</h3>
          <p class="text-sm text-gray-500 mt-1">Bạn đã chinh phục bộ đề gồm ${totalQ} câu hỏi đa dạng.</p>
        </div>

        <div class="grid grid-cols-3 gap-4 bg-gray-50 p-6 rounded-2xl border border-gray-100">
          <div>
            <span class="text-3xl font-black text-purple-600">${correctCount}/${totalQ}</span>
            <p class="text-xs text-gray-400 uppercase font-medium mt-1">Trả lời đúng</p>
          </div>
          <div>
            <span class="text-3xl font-black text-emerald-600">${percentage}%</span>
            <p class="text-xs text-gray-400 uppercase font-medium mt-1">Độ chính xác</p>
          </div>
          <div>
            <span class="text-3xl font-black text-amber-600">${g.score}</span>
            <p class="text-xs text-gray-400 uppercase font-medium mt-1">Tổng điểm</p>
          </div>
        </div>

        <div class="flex items-center justify-center gap-4">
          <button onclick="initExpandedQuiz(); renderApp()" class="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-md transition">
            <i class="fas fa-redo-alt mr-2"></i> Làm lại bộ đề 20+ câu
          </button>
        </div>
      </div>
    `;
  }

  const currQ = qList[g.index];
  if (!currQ) return '';

  const userAnswer = g.userAnswers[g.index];
  const isAnswered = userAnswer !== undefined;

  return `
    <div class="space-y-6 max-w-2xl mx-auto">
      <!-- Top Status & Progress Bar -->
      <div class="space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-md">
            Câu ${g.index + 1} / ${qList.length}
          </span>
          <div class="flex items-center gap-3">
            <span class="text-gray-500 font-semibold">Điểm: <b class="text-purple-700">${g.score}</b></span>
            ${g.streak > 1 ? `<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">${g.streak} 🔥 Chuỗi đúng</span>` : ''}
          </div>
        </div>

        <!-- Progress Bar -->
        <div class="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div class="h-full bg-gradient-to-r from-purple-500 to-rose-500 transition-all duration-300" style="width: ${((g.index + 1) / qList.length) * 100}%"></div>
        </div>
      </div>

      <!-- Question Card -->
      <div class="bg-gray-50/70 p-6 rounded-2xl border border-gray-200 space-y-4">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
            Dạng bài: ${currQ.type === 'radical' ? 'Bộ thủ Hán tự' : (currQ.type === 'breakdown' ? 'Chiết tự cấu tạo chữ' : (currQ.type === 'pinyin' ? 'Phiên âm & Thanh điệu' : (currQ.type === 'classifier' ? 'Lượng từ' : 'Ngữ pháp & Giao tiếp')))}
          </span>
        </div>

        <h3 class="text-lg font-bold text-gray-900 leading-snug">
          ${currQ.question}
        </h3>

        <!-- Options Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
          ${currQ.options.map((opt, optIdx) => {
            let btnClass = "border-gray-200 bg-white hover:border-purple-400 text-gray-800";
            if (isAnswered) {
              if (optIdx === currQ.correctIndex) {
                btnClass = "border-emerald-500 bg-emerald-50 text-emerald-900 font-bold shadow-xs";
              } else if (optIdx === userAnswer) {
                btnClass = "border-rose-500 bg-rose-50 text-rose-900 font-bold";
              } else {
                btnClass = "border-gray-100 bg-white opacity-40 text-gray-400";
              }
            }
            return `
              <button 
                onclick="answerExpandedQuiz(${optIdx})"
                ${isAnswered ? 'disabled' : ''}
                class="p-4 rounded-xl border-2 transition text-left flex items-center gap-3 ${btnClass}"
              >
                <span class="w-7 h-7 rounded-lg bg-gray-100 text-gray-700 font-mono font-bold text-xs flex items-center justify-center flex-shrink-0">
                  ${String.fromCharCode(65 + optIdx)}
                </span>
                <span class="text-sm font-medium chinese-font">${opt}</span>
              </button>
            `;
          }).join('')}
        </div>

        <!-- Feedback & Explanation -->
        ${isAnswered ? `
          <div class="p-4 rounded-xl text-xs space-y-1 pop-in ${userAnswer === currQ.correctIndex ? 'bg-emerald-50 border border-emerald-200 text-emerald-900' : 'bg-rose-50 border border-rose-200 text-rose-900'}">
            <div class="font-bold flex items-center gap-1.5">
              <i class="fas ${userAnswer === currQ.correctIndex ? 'fa-check-circle text-emerald-600' : 'fa-times-circle text-rose-600'}"></i>
              <span>${userAnswer === currQ.correctIndex ? 'Chính xác (+10 điểm)!' : `Chưa đúng! Đáp án đúng là: ${String.fromCharCode(65 + currQ.correctIndex)}. ${currQ.options[currQ.correctIndex]}`}</span>
            </div>
            ${currQ.explanation ? `<div class="text-gray-700 pt-0.5">💡 <b>Giải thích:</b> ${currQ.explanation}</div>` : ''}
          </div>
        ` : ''}
      </div>

      <!-- Bottom Next / Jump Controls -->
      <div class="flex items-center justify-between pt-2">
        <button 
          onclick="jumpExpandedQuiz(${g.index - 1})"
          ${g.index === 0 ? 'disabled class="opacity-30 cursor-not-allowed"' : 'class="hover:bg-gray-100"'}
          class="px-4 py-2 text-xs font-semibold text-gray-600 rounded-xl border border-gray-200 transition"
        >
          <i class="fas fa-chevron-left mr-1"></i> Câu trước
        </button>

        ${isAnswered ? `
          <button onclick="nextExpandedQuizQuestion()" class="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-md transition pop-in">
            ${g.index === qList.length - 1 ? 'Xem kết quả tổng kết' : 'Câu tiếp theo'} <i class="fas fa-arrow-right ml-1"></i>
          </button>
        ` : `
          <span class="text-xs text-gray-400 italic">Chọn một đáp án để xem giải thích</span>
        `}
      </div>
    </div>
  `;
}

function answerExpandedQuiz(selectedIdx) {
  const g = state.expandedQuizGame;
  const lesson = getCurrentLesson();
  const qList = (lesson.exercises && lesson.exercises.expandedQuiz) || [];
  const currQ = qList[g.index];
  if (!currQ || g.userAnswers[g.index] !== undefined) return;

  g.userAnswers[g.index] = selectedIdx;

  if (selectedIdx === currQ.correctIndex) {
    soundFx.playCorrect();
    g.streak++;
    g.score += 10 + (g.streak > 1 ? 5 : 0);
  } else {
    soundFx.playWrong();
    g.streak = 0;
  }
  renderApp();
}

function nextExpandedQuizQuestion() {
  const g = state.expandedQuizGame;
  const lesson = getCurrentLesson();
  const qList = (lesson.exercises && lesson.exercises.expandedQuiz) || [];
  if (g.index < qList.length - 1) {
    g.index++;
  } else {
    g.isCompleted = true;
    soundFx.playVictory();
  }
  renderApp();
}

function jumpExpandedQuiz(idx) {
  const g = state.expandedQuizGame;
  const lesson = getCurrentLesson();
  const qList = (lesson.exercises && lesson.exercises.expandedQuiz) || [];
  if (idx >= 0 && idx < qList.length) {
    g.index = idx;
    renderApp();
  }
}

// ==========================================
// FEATURE 5: KIỂM TRA CẢ BÀI (COMPREHENSIVE TEST)
// ==========================================
function startComprehensiveTest() {
  const lesson = getCurrentLesson();
  if (!lesson || !lesson.comprehensiveTest || lesson.comprehensiveTest.length === 0) {
    alert("Buổi học này chưa có câu hỏi kiểm tra tổng hợp.");
    return;
  }

  state.test.isActive = true;
  state.test.isSubmitted = false;
  state.test.questions = lesson.comprehensiveTest;
  state.test.userAnswers = {};
  state.test.score = 0;
  state.test.timeRemaining = 1200; // 20 phút cho 20+ câu hỏi
  state.test.currentQuestionIndex = 0;

  if (state.test.timerInterval) clearInterval(state.test.timerInterval);
  state.test.timerInterval = setInterval(() => {
    state.test.timeRemaining--;
    const timeEl = document.getElementById('test-timer-display');
    if (timeEl) {
      const m = Math.floor(state.test.timeRemaining / 60);
      const s = state.test.timeRemaining % 60;
      timeEl.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    if (state.test.timeRemaining <= 0) submitComprehensiveTest();
  }, 1000);

  renderApp();
}

function getTestCategoryLabel(cat) {
  const map = {
    translate_zh_vi: { label: 'Dịch Trung → Việt', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    translate_vi_zh: { label: 'Dịch Việt → Trung', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    fill_blank: { label: 'Điền từ còn thiếu', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    vocab: { label: 'Từ vựng & Nghĩa', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    listening: { label: 'Luyện nghe HSK', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
    reading: { label: 'Đọc hiểu', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
    grammar: { label: 'Ngữ pháp', cls: 'bg-teal-50 text-teal-700 border-teal-200' }
  };
  return map[cat] || { label: 'Tổng hợp', cls: 'bg-gray-100 text-gray-700 border-gray-200' };
}

function formatTestSeconds(sec) {
  const m = Math.floor(Math.max(0, sec) / 60);
  const s = Math.max(0, sec) % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function renderComprehensiveTestSection(container, lesson) {
  const questions = lesson.comprehensiveTest || [];

  if (!state.test.isActive && !state.test.isSubmitted) {
    container.innerHTML = `
      <div class="max-w-2xl mx-auto space-y-6">
        <div class="bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 rounded-3xl p-8 text-white shadow-xl text-center space-y-4">
          <div class="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md mx-auto flex items-center justify-center text-3xl">
            <i class="fas fa-award"></i>
          </div>
          <span class="inline-block px-3 py-1 bg-white/20 rounded-full text-xs font-bold uppercase tracking-wider">Module 5</span>
          <h2 class="text-3xl font-bold">Bài kiểm tra tổng hợp cả buổi</h2>
          <p class="text-white/90 text-sm max-w-lg mx-auto">
            Đánh giá toàn diện kiến thức trong buổi học: Dịch nghĩa Trung ⇄ Việt, Điền từ vào chỗ trống, Từ vựng & Luyện nghe HSK.
          </p>
          <div class="grid grid-cols-3 gap-4 pt-4 max-w-md mx-auto">
            <div class="bg-white/10 p-3 rounded-2xl border border-white/20">
              <span class="text-2xl font-black">${questions.length}</span>
              <p class="text-[11px] uppercase text-white/80 font-medium">Câu hỏi</p>
            </div>
            <div class="bg-white/10 p-3 rounded-2xl border border-white/20">
              <span class="text-2xl font-black">100</span>
              <p class="text-[11px] uppercase text-white/80 font-medium">Thang điểm</p>
            </div>
            <div class="bg-white/10 p-3 rounded-2xl border border-white/20">
              <span class="text-2xl font-black">20:00</span>
              <p class="text-[11px] uppercase text-white/80 font-medium">Thời gian</p>
            </div>
          </div>
          <div class="pt-4">
            <button onclick="startComprehensiveTest()" class="px-8 py-3.5 bg-white text-red-600 hover:bg-red-50 rounded-2xl font-bold text-sm shadow-lg transition active:scale-95">
              <i class="fas fa-play mr-2"></i> Bắt đầu làm bài thi
            </button>
          </div>
        </div>
      </div>
    `;
    return;
  }

  if (state.test.isSubmitted) {
    const score = state.test.score;
    const qList = state.test.questions || [];
    let correctCount = 0;
    qList.forEach((q, idx) => {
      if (state.test.userAnswers[idx] === q.correctIndex) correctCount++;
    });

    let sealText = "及格 (ĐẠT)";
    let sealColor = "text-emerald-600 border-emerald-600";
    if (score >= 90) { sealText = "优秀 (XUẤT SẮC)"; sealColor = "text-red-600 border-red-600"; }
    else if (score >= 70) { sealText = "良好 (KHÁ GIỎI)"; sealColor = "text-blue-600 border-blue-600"; }
    else if (score < 50) { sealText = "需努力 (CỐ GẮNG)"; sealColor = "text-amber-600 border-amber-600"; }

    container.innerHTML = `
      <div class="max-w-3xl mx-auto space-y-8 pop-in">
        <div class="bg-white rounded-3xl border border-gray-200 shadow-xl p-8 text-center space-y-6 relative overflow-hidden">
          <div class="absolute top-6 right-6">
            <div class="chinese-seal font-serif ${sealColor}">${sealText}</div>
          </div>
          <div>
            <h3 class="text-2xl font-black text-gray-900">Kết quả bài kiểm tra</h3>
            <p class="text-xs text-gray-500 mt-1">${lesson.title}</p>
          </div>
          <div class="py-4">
            <div class="text-6xl md:text-7xl font-black text-red-600 font-mono tracking-tight">
              ${score}<span class="text-2xl text-gray-400 font-normal">/100</span>
            </div>
            <p class="text-sm text-gray-600 mt-2">Đúng <span class="font-bold text-emerald-600">${correctCount}</span> / ${qList.length} câu hỏi</p>
          </div>
          <div class="flex items-center justify-center gap-4 pt-2">
            <button onclick="startComprehensiveTest()" class="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-md transition">
              <i class="fas fa-redo-alt mr-1.5"></i> Làm lại đề này
            </button>
            <button onclick="switchTab('vocab')" class="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition">
              Quay lại ôn từ vựng
            </button>
          </div>
        </div>

        <!-- Detailed Review -->
        <div class="bg-white rounded-3xl border border-gray-200 shadow-sm p-6 md:p-8 space-y-4">
          <h4 class="text-base font-bold text-gray-900 border-b border-gray-100 pb-3">
            <i class="fas fa-clipboard-check text-red-600 mr-2"></i>Chi tiết đáp án & Giải thích
          </h4>
          <div class="space-y-4">
            ${qList.map((q, idx) => {
              const uAns = state.test.userAnswers[idx];
              const isRight = uAns === q.correctIndex;
              const badge = getTestCategoryLabel(q.category);
              return `
                <div class="p-4 rounded-2xl border ${isRight ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40'} space-y-2 text-sm">
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2">
                      <span class="font-bold text-xs px-2 py-0.5 rounded-md ${isRight ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}">Câu ${idx + 1}</span>
                      <span class="text-[11px] font-semibold px-2 py-0.5 rounded-md border ${badge.cls}">${badge.label}</span>
                    </div>
                    <span class="text-xs font-bold ${isRight ? 'text-emerald-700' : 'text-red-700'}">
                      ${isRight ? '✓ Chính xác' : (uAns === undefined ? '✗ Bỏ trống' : '✗ Chưa đúng')}
                    </span>
                  </div>
                  <p class="font-semibold text-gray-900 whitespace-pre-line">${q.question}</p>
                  <div class="text-xs space-y-1">
                    ${uAns !== undefined && !isRight ? `<p class="text-red-700">Bạn chọn: <span class="font-semibold">${String.fromCharCode(65 + uAns)}. ${q.options[uAns]}</span></p>` : ''}
                    <p class="text-emerald-800">Đáp án đúng: <span class="font-bold">${String.fromCharCode(65 + q.correctIndex)}. ${q.options[q.correctIndex]}</span></p>
                    ${q.explanation ? `<p class="text-gray-600 italic mt-1">💡 ${q.explanation}</p>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Active Test Screen
  const qList = state.test.questions;
  const currentIdx = state.test.currentQuestionIndex;
  const currQ = qList[currentIdx];
  if (!currQ) return;
  const totalAnswered = Object.keys(state.test.userAnswers).length;
  const catBadge = getTestCategoryLabel(currQ.category);

  container.innerHTML = `
    <div class="max-w-3xl mx-auto space-y-6">
      <div class="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="w-8 h-8 rounded-xl bg-red-600 text-white flex items-center justify-center font-bold text-xs">
            ${currentIdx + 1}
          </span>
          <span class="text-xs font-semibold text-gray-600">Câu hỏi ${currentIdx + 1} / ${qList.length}</span>
        </div>
        <div class="flex items-center gap-2 font-mono font-bold text-red-600 text-sm bg-red-50 px-3 py-1.5 rounded-xl border border-red-100">
          <i class="far fa-clock"></i>
          <span id="test-timer-display">${formatTestSeconds(state.test.timeRemaining)}</span>
        </div>
        <button onclick="confirmSubmitTest()" class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-sm transition">
          Nộp bài (${totalAnswered}/${qList.length})
        </button>
      </div>

      <div class="bg-white rounded-3xl border border-gray-200 shadow-md p-6 md:p-8 space-y-6">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold px-2.5 py-1 rounded-lg border ${catBadge.cls}">${catBadge.label}</span>
        </div>

        ${currQ.passage ? `
          <div class="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5">
            <div class="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <i class="fas fa-book-open text-red-500"></i> Ngữ cảnh / Đoạn hội thoại:
            </div>
            <div class="text-sm md:text-base font-medium text-gray-800 chinese-font leading-relaxed whitespace-pre-line">${currQ.passage}</div>
          </div>
        ` : ''}

        ${currQ.audioText ? `
          <div class="p-4 bg-amber-50 rounded-2xl border border-amber-200 flex items-center justify-between">
            <span class="text-xs text-amber-900 font-medium">Bấm để nghe đoạn ghi âm câu hỏi HSK:</span>
            <button onclick="speakChinese('${currQ.audioText.replace(/'/g, "\\'")}')" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition">
              <i class="fas fa-volume-up"></i> Nghe câu hỏi HSK
            </button>
          </div>
        ` : ''}

        <h3 class="text-base md:text-lg font-bold text-gray-900 whitespace-pre-line leading-relaxed">${currQ.question}</h3>

        <div class="space-y-3">
          ${currQ.options.map((opt, optIdx) => {
            const isSelected = state.test.userAnswers[currentIdx] === optIdx;
            return `
              <button 
                onclick="selectTestAnswer(${currentIdx}, ${optIdx})"
                class="w-full text-left p-4 rounded-2xl border-2 transition flex items-center gap-3.5 ${isSelected ? 'border-red-600 bg-red-50 text-red-900 shadow-sm' : 'border-gray-200 hover:border-red-300 text-gray-800'}"
              >
                <span class="w-8 h-8 rounded-xl flex items-center justify-center font-bold font-mono text-xs shrink-0 ${isSelected ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'}">
                  ${String.fromCharCode(65 + optIdx)}
                </span>
                <span class="text-sm font-medium">${opt}</span>
              </button>
            `;
          }).join('')}
        </div>

        <div class="flex items-center justify-between pt-4 border-t border-gray-100">
          <button 
            onclick="jumpToTestQuestion(${currentIdx - 1})"
            ${currentIdx === 0 ? 'disabled class="opacity-40 cursor-not-allowed px-5 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 transition"' : 'class="hover:bg-gray-100 px-5 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 transition"'}
          >
            <i class="fas fa-chevron-left mr-1.5"></i> Câu trước
          </button>
          ${currentIdx < qList.length - 1 ? `
            <button onclick="jumpToTestQuestion(${currentIdx + 1})" class="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-sm transition">
              Câu tiếp theo <i class="fas fa-chevron-right ml-1.5"></i>
            </button>
          ` : `
            <button onclick="confirmSubmitTest()" class="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md transition">
              <i class="fas fa-check-circle mr-1.5"></i> Nộp bài
            </button>
          `}
        </div>
      </div>
    </div>
  `;
}

function selectTestAnswer(qIdx, optIdx) {
  state.test.userAnswers[qIdx] = optIdx;
  soundFx.playFlip();
  renderApp();
}

function jumpToTestQuestion(idx) {
  if (idx < 0 || idx >= state.test.questions.length) return;
  state.test.currentQuestionIndex = idx;
  renderApp();
}

function confirmSubmitTest() {
  submitComprehensiveTest();
}

function submitComprehensiveTest() {
  if (state.test.timerInterval) clearInterval(state.test.timerInterval);
  state.test.isActive = false;
  state.test.isSubmitted = true;
  let correctCount = 0;
  state.test.questions.forEach((q, idx) => {
    if (state.test.userAnswers[idx] === q.correctIndex) correctCount++;
  });
  state.test.score = Math.round((correctCount / state.test.questions.length) * 100);
  if (state.test.score >= 80) soundFx.playVictory();
  else if (state.test.score >= 50) soundFx.playCorrect();
  else soundFx.playWrong();
  renderApp();
}

// ==========================================
// LESSON CREATION & EDIT MODAL
// ==========================================
let editingLessonId = null;

function openLessonModal(isEdit = false) {
  const modal = document.getElementById('lesson-modal');
  if (!modal) return;
  editingLessonId = isEdit ? state.currentLessonId : null;
  const current = isEdit ? getCurrentLesson() : null;

  document.getElementById('modal-title').textContent = isEdit ? 'Chỉnh sửa buổi học' : 'Thêm buổi học mới';
  document.getElementById('m-lesson-title').value = current ? current.title : '';
  document.getElementById('m-lesson-level').value = current ? (current.hskLevel || 'HSK 1') : 'HSK 1';
  document.getElementById('m-lesson-desc').value = current ? (current.description || '') : '';
  
  const vocabContainer = document.getElementById('m-vocab-list');
  vocabContainer.innerHTML = '';
  const vocabList = current ? (current.vocabulary || []) : [];
  if (vocabList.length > 0) {
    vocabList.forEach(v => addVocabFormRow(v));
  } else {
    addVocabFormRow();
    addVocabFormRow();
  }

  const grammarContainer = document.getElementById('m-grammar-list');
  grammarContainer.innerHTML = '';
  const grammarList = current ? (current.grammar || []) : [];
  if (grammarList.length > 0) {
    grammarList.forEach(g => addGrammarFormRow(g));
  } else {
    addGrammarFormRow();
  }

  modal.classList.remove('hidden');
}

function closeLessonModal() {
  const modal = document.getElementById('lesson-modal');
  if (modal) modal.classList.add('hidden');
}

function addVocabFormRow(data = {}) {
  const container = document.getElementById('m-vocab-list');
  const rowId = 'vrow_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
  
  const div = document.createElement('div');
  div.id = rowId;
  div.className = "p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3 relative";
  div.innerHTML = `
    <button type="button" onclick="document.getElementById('${rowId}').remove()" class="absolute top-3 right-3 text-gray-400 hover:text-red-500 text-xs">
      <i class="fas fa-trash"></i>
    </button>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
      <div>
        <label class="text-[11px] font-bold text-gray-500 uppercase">Chữ Hán (*)</label>
        <input type="text" placeholder="你好" value="${data.hanzi || ''}" class="v-hanzi w-full p-2 text-xs rounded-lg border border-gray-300 font-bold chinese-font focus:outline-none focus:border-red-500" required>
      </div>
      <div>
        <label class="text-[11px] font-bold text-gray-500 uppercase">Pinyin (*)</label>
        <input type="text" placeholder="nǐ hǎo" value="${data.pinyin || ''}" class="v-pinyin w-full p-2 text-xs rounded-lg border border-gray-300 font-mono text-red-600 focus:outline-none focus:border-red-500" required>
      </div>
      <div>
        <label class="text-[11px] font-bold text-gray-500 uppercase">Bộ thủ</label>
        <input type="text" placeholder="亻 Nhân đứng" value="${data.radical || ''}" class="v-radical w-full p-2 text-xs rounded-lg border border-gray-300 focus:outline-none focus:border-red-500">
      </div>
      <div>
        <label class="text-[11px] font-bold text-gray-500 uppercase">Ý nghĩa (*)</label>
        <input type="text" placeholder="Chào bạn" value="${data.meaning || ''}" class="v-meaning w-full p-2 text-xs rounded-lg border border-gray-300 font-medium focus:outline-none focus:border-red-500" required>
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
      <div>
        <label class="text-[11px] font-bold text-gray-500 uppercase">Cấu tạo chữ & Chiết tự (Mẹo nhớ)</label>
        <input type="text" placeholder="亻 (người) + 尔 (nhĩ) -> người trước mặt bạn" value="${data.breakdown || data.mnemonic || ''}" class="v-breakdown w-full p-2 text-xs rounded-lg border border-gray-300 focus:outline-none focus:border-red-500">
      </div>
      <div>
        <label class="text-[11px] font-bold text-gray-500 uppercase">Ví dụ câu & Dịch nghĩa</label>
        <input type="text" placeholder="你好！ (Chào bạn!)" value="${data.example || ''}" class="v-example w-full p-2 text-xs rounded-lg border border-gray-300 focus:outline-none focus:border-red-500">
      </div>
    </div>
  `;
  container.appendChild(div);
}

function addGrammarFormRow(data = {}) {
  const container = document.getElementById('m-grammar-list');
  const rowId = 'grow_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
  const div = document.createElement('div');
  div.id = rowId;
  div.className = "p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3 relative";
  div.innerHTML = `
    <button type="button" onclick="document.getElementById('${rowId}').remove()" class="absolute top-3 right-3 text-gray-400 hover:text-red-500 text-xs">
      <i class="fas fa-trash"></i>
    </button>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
      <div>
        <label class="text-[11px] font-bold text-gray-500 uppercase">Tên cấu trúc (*)</label>
        <input type="text" placeholder="Ví dụ: Câu chữ 是" value="${data.title || ''}" class="g-title w-full p-2 text-xs rounded-lg border border-gray-300 font-bold focus:outline-none focus:border-red-500" required>
      </div>
      <div>
        <label class="text-[11px] font-bold text-gray-500 uppercase">Công thức (*)</label>
        <input type="text" placeholder="A + 是 + B" value="${data.formula || ''}" class="g-formula w-full p-2 text-xs rounded-lg border border-gray-300 font-mono text-blue-700 focus:outline-none focus:border-red-500" required>
      </div>
    </div>
    <div>
      <label class="text-[11px] font-bold text-gray-500 uppercase">Giải thích & Lưu ý</label>
      <textarea rows="2" class="g-explanation w-full p-2 text-xs rounded-lg border border-gray-300 focus:outline-none focus:border-red-500">${data.explanation || ''}</textarea>
    </div>
  `;
  container.appendChild(div);
}

function pasteBatchVocab() {
  const raw = prompt("Dán danh sách từ vựng theo định dạng (mỗi dòng 1 từ):\nHán tự | Pinyin | Nghĩa | Bộ thủ | Cấu tạo chữ\n\nVí dụ:\n你好 | nǐ hǎo | Chào bạn | 亻 Nhân đứng | Người trước mặt bạn\n好 | hǎo | Tốt, đẹp | 女 Nữ | Người mẹ bồng đứa con");
  if (!raw) return;
  const lines = raw.split('\n');
  lines.forEach(line => {
    if (!line.trim()) return;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length >= 2) {
      addVocabFormRow({
        hanzi: parts[0] || '',
        pinyin: parts[1] || '',
        meaning: parts[2] || '',
        radical: parts[3] || '',
        breakdown: parts[4] || ''
      });
    }
  });
}

function saveLessonModal(event) {
  event.preventDefault();
  const title = document.getElementById('m-lesson-title').value.trim();
  const level = document.getElementById('m-lesson-level').value;
  const desc = document.getElementById('m-lesson-desc').value.trim();
  if (!title) return;

  const vocabList = [];
  document.querySelectorAll('#m-vocab-list > div').forEach((row, idx) => {
    const hanzi = row.querySelector('.v-hanzi').value.trim();
    const pinyin = row.querySelector('.v-pinyin').value.trim();
    const radical = row.querySelector('.v-radical').value.trim();
    const meaning = row.querySelector('.v-meaning').value.trim();
    const breakdown = row.querySelector('.v-breakdown').value.trim();
    const example = row.querySelector('.v-example').value.trim();
    if (hanzi && meaning) {
      vocabList.push({
        id: `v_custom_${Date.now()}_${idx}`,
        hanzi,
        pinyin: pinyin || hanzi,
        radical,
        meaning,
        breakdown,
        example
      });
    }
  });

  const grammarList = [];
  document.querySelectorAll('#m-grammar-list > div').forEach((row, idx) => {
    const gTitle = row.querySelector('.g-title').value.trim();
    const formula = row.querySelector('.g-formula').value.trim();
    const explanation = row.querySelector('.g-explanation').value.trim();
    if (gTitle) {
      grammarList.push({
        id: `g_custom_${Date.now()}_${idx}`,
        title: gTitle,
        formula: formula || '',
        explanation: explanation || '',
        examples: []
      });
    }
  });

  if (editingLessonId) {
    const existing = state.lessons.find(l => l.id === editingLessonId);
    if (existing) {
      existing.title = title;
      existing.hskLevel = level;
      existing.description = desc;
      if (vocabList.length > 0) existing.vocabulary = vocabList;
      if (grammarList.length > 0) existing.grammar = grammarList;
    }
  } else {
    const newLessonId = `lesson_${Date.now()}`;
    state.lessons.push({
      id: newLessonId,
      title: title,
      hskLevel: level,
      description: desc,
      dateAdded: new Date().toISOString().split('T')[0],
      vocabulary: vocabList,
      grammar: grammarList,
      texts: [],
      exercises: {
        sentenceScramble: vocabList.slice(0, 3).map((v, i) => ({
          id: `ss_${Date.now()}_${i}`,
          targetHanzi: v.hanzi,
          targetMeaning: v.meaning,
          tokens: v.hanzi.split('')
        })),
        translationExercises: vocabList.slice(0, 4).map((v, i) => ({
          id: `tr_${Date.now()}_${i}`,
          direction: i % 2 === 0 ? "vi_to_zh" : "zh_to_vi",
          promptText: i % 2 === 0 ? v.meaning : v.hanzi,
          expectedChinese: v.hanzi,
          expectedVietnamese: v.meaning,
          acceptedPinyin: v.pinyin,
          acceptableKeywords: [v.meaning]
        })),
        expandedQuiz: vocabList.map((v, i) => ({
          id: `eq_${Date.now()}_${i}`,
          type: "radical",
          question: `Chữ '${v.hanzi}' (${v.pinyin}) có nghĩa là gì?`,
          options: [v.meaning, "Khác 1", "Khác 2", "Khác 3"],
          correctIndex: 0,
          explanation: `${v.hanzi} nghĩa là: ${v.meaning}`
        }))
      },
      comprehensiveTest: []
    });
    state.currentLessonId = newLessonId;
  }

  saveLessonsToStorage();
  closeLessonModal();
  renderLessonSelector();
  renderApp();
}

function deleteCurrentLesson() {
  const current = getCurrentLesson();
  if (!current) return;
  if (!confirm(`Bạn có chắc muốn xoá buổi học "${current.title}" không?`)) return;
  state.lessons = state.lessons.filter(l => l.id !== current.id);
  state.currentLessonId = state.lessons.length > 0 ? state.lessons[0].id : null;
  saveLessonsToStorage();
  renderLessonSelector();
  renderApp();
}

function restoreDefaultLessons() {
  if (!confirm("Khôi phục toàn bộ bài học mẫu chuẩn HSK kèm Bộ thủ & 4 Trò chơi?")) return;
  state.lessons = JSON.parse(JSON.stringify(DEFAULT_LESSONS));
  state.currentLessonId = state.lessons[0].id;
  saveLessonsToStorage();
  renderLessonSelector();
  renderApp();
}

function exportLessonsJSON() {
  const jsonStr = JSON.stringify(state.lessons, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tieng_trung_bai_hoc_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importLessonsJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (Array.isArray(parsed) && parsed.length > 0) {
        state.lessons = parsed;
        state.currentLessonId = state.lessons[0].id;
        saveLessonsToStorage();
        renderLessonSelector();
        renderApp();
        alert(`Đã nhập thành công ${parsed.length} buổi học!`);
      }
    } catch (err) {
      alert("Lỗi khi đọc file JSON: " + err.message);
    }
  };
  reader.readAsText(file);
}

// More Options Menu Toggle & Click-Outside
function toggleMoreMenu(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const dropdown = document.getElementById('more-menu-dropdown');
  if (dropdown) {
    const isExplicitlyShown = dropdown.classList.contains('flex') || !dropdown.classList.contains('hidden');
    if (isExplicitlyShown) {
      dropdown.classList.add('hidden');
      dropdown.classList.remove('block');
    } else {
      dropdown.classList.remove('hidden');
      dropdown.classList.add('block');
    }
  }
}

function closeMoreMenu() {
  const dropdown = document.getElementById('more-menu-dropdown');
  if (dropdown) {
    dropdown.classList.add('hidden');
    dropdown.classList.remove('block');
  }
}

document.addEventListener('click', (e) => {
  const container = document.getElementById('more-menu-container');
  if (container && !container.contains(e.target)) {
    closeMoreMenu();
  }
});

// Start app on load
window.addEventListener('DOMContentLoaded', initApp);
