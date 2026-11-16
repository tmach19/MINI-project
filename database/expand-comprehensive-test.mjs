import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataJsPath = path.resolve(__dirname, '../data.js');

// Deterministic PRNG so generated banks & shuffled options are reproducible
function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Strip inline pinyin/meaning glosses like "同学们 (tóngxuémen: các bạn học)"
function cleanChinese(str) {
  if (!str) return '';
  return str
    .replace(/\s*[(\（][A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ'\s,.\-!?/0-9]+:\s*[^)\）]+[)\）]/gi, '')
    .replace(/^[A-Za-z]\s*[:：]\s*/g, '')
    .replace(/\s+([，。！？；：、])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanVocabHanzi(hanzi) {
  if (!hanzi) return '';
  return hanzi
    .replace(/[（(][^）)]*[)）]/g, '')
    .split('/')[0]
    .trim();
}

function cleanMeaning(str) {
  if (!str) return '';
  return str
    .replace(/^\[(Mở rộng|Ôn tập[^\]]*|Bài\s*\d+)\]\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripPunct(str) {
  return (str || '').replace(/[，。！？、；：“”"'‘’.,!?;:\s]/g, '').trim();
}

function normalizeTextKey(str) {
  return stripPunct(cleanChinese(str)).toLowerCase();
}

function normalizeMeaningKey(str) {
  return cleanMeaning(str).toLowerCase().replace(/[.,!?;:"'()]/g, '').trim();
}

function getTierConfig(vocabCount) {
  // Proportions match official HSK 3 exam: ~50% Listening (Parts 1-4), ~37.5% Reading (Parts 1-3), ~12.5% Writing (Parts 1-2)
  if (vocabCount <= 21) {
    // 50 questions: Listening 25 (50%), Reading+Vocab+Fill+TransZhVi 19 (38%), Writing(TransViZh+Pinyin->Hanzi) 6 (12%)
    return {
      total: 50,
      p1: 7,
      p2_tf: 6,
      p3_short: 6,
      p4_long: 6,
      r_match: 3,
      tz_vi: 3,
      fb_cloze: 3,
      vocab: 4,
      r_passage: 6,
      tv_zh: 3,
      fb_pinyin: 3,
    };
  }
  if (vocabCount <= 25) {
    // 56 questions (exact 7 * 8): Listening 28 (50.0%), Reading 21 (37.5%), Writing 7 (12.5%)
    return {
      total: 56,
      p1: 7,
      p2_tf: 7,
      p3_short: 7,
      p4_long: 7,
      r_match: 4,
      tz_vi: 3,
      fb_cloze: 4,
      vocab: 3,
      r_passage: 7,
      tv_zh: 4,
      fb_pinyin: 3,
    };
  }
  if (vocabCount <= 29) {
    // 60 questions: Listening 30 (50.0%), Reading 22 (36.7%), Writing 8 (13.3%)
    return {
      total: 60,
      p1: 8,
      p2_tf: 7,
      p3_short: 8,
      p4_long: 7,
      r_match: 4,
      tz_vi: 3,
      fb_cloze: 4,
      vocab: 4,
      r_passage: 7,
      tv_zh: 4,
      fb_pinyin: 4,
    };
  }
  // >= 30 vocab -> 64 questions (exact 4 * 16: Listening 32 = 50%, Reading 24 = 37.5%, Writing 8 = 12.5%)
  return {
    total: 64,
    p1: 8,
    p2_tf: 8,
    p3_short: 8,
    p4_long: 8,
    r_match: 4,
    tz_vi: 4,
    fb_cloze: 4,
    vocab: 4,
    r_passage: 8,
    tv_zh: 4,
    fb_pinyin: 4,
  };
}

function buildOptionsWithCorrect(correct, candidatePool, rng, targetLen = 4, isChinese = false) {
  const norm = isChinese ? normalizeTextKey : normalizeMeaningKey;
  const correctKey = norm(correct);
  const picked = [correct];
  const usedKeys = new Set([correctKey]);

  for (const cand of candidatePool) {
    if (picked.length >= targetLen) break;
    if (!cand) continue;
    const cleaned = isChinese ? cleanChinese(cand) : cleanMeaning(cand);
    const key = norm(cleaned);
    if (!key || usedKeys.has(key)) continue;
    // Avoid trivial substring containment duplicates
    if (key.length > 2 && (correctKey === key)) continue;
    usedKeys.add(key);
    picked.push(cleaned);
  }

  if (picked.length < targetLen) {
    throw new Error(`Insufficient distractors for "${correct}": only got ${picked.length}/${targetLen}`);
  }

  shuffleInPlace(picked, rng);
  const correctIndex = picked.indexOf(correct);
  return { options: picked, correctIndex };
}

function collectLessonPools(lessons, upToIdx) {
  const sentences = [];
  const sentSeen = new Set();
  const pairs = [];
  const pairSeen = new Set();
  const vocabList = [];
  const vocabSeen = new Set();
  const passages = [];
  const scrambles = [];
  const scrambleSeen = new Set();
  const translationsZhVi = [];
  const translationsViZh = [];
  const existingMultiListening = [];
  const existingReadingComp = [];

  // Iterate from current lesson down to 0 so current lesson items come FIRST
  for (let idx = upToIdx; idx >= 0; idx--) {
    const lesson = lessons[idx];
    const lessonNum = idx + 1;
    const isCurrent = idx === upToIdx;

    // 1. Vocabulary
    for (const v of lesson.vocabulary || []) {
      const ch = cleanVocabHanzi(v.hanzi);
      if (!ch || !v.meaning) continue;
      if (!vocabSeen.has(ch)) {
        vocabSeen.add(ch);
        vocabList.push({
          hanzi: ch,
          rawHanzi: v.hanzi,
          pinyin: (v.pinyin || '').trim(),
          meaning: cleanMeaning(v.meaning),
          type: v.type || 'Từ vựng',
          lessonNum,
          isCurrent,
        });
      }
      if (v.example && !v.example.includes('常用句子') && v.exampleMeaning) {
        const eh = cleanChinese(v.example);
        const em = cleanMeaning(v.exampleMeaning);
        const ek = normalizeTextKey(eh);
        if (eh && em && ek.length >= 2 && !sentSeen.has(ek)) {
          sentSeen.add(ek);
          sentences.push({
            hanzi: eh,
            pinyin: (v.examplePinyin || '').trim(),
            meaning: em,
            lessonNum,
            isCurrent,
            source: 'vocab',
          });
        }
      }
    }

    // 2. Grammar examples
    for (const g of lesson.grammar || []) {
      for (const ex of g.examples || []) {
        const eh = cleanChinese(ex.hanzi);
        const em = cleanMeaning(ex.meaning);
        const ek = normalizeTextKey(eh);
        if (eh && em && ek.length >= 2 && !sentSeen.has(ek)) {
          sentSeen.add(ek);
          sentences.push({
            hanzi: eh,
            pinyin: (ex.pinyin || '').trim(),
            meaning: em,
            lessonNum,
            isCurrent,
            source: 'grammar',
          });
        }
      }
    }

    // 3. Texts -> sentences, adjacent pairs, and dialogue passages
    for (let ti = 0; ti < (lesson.texts || []).length; ti++) {
      const t = lesson.texts[ti];
      const turns = (t.sentences || [])
        .map((s) => ({
          speaker: (s.speaker || '').trim(),
          hanzi: cleanChinese(s.hanzi),
          pinyin: (s.pinyin || '').trim(),
          meaning: cleanMeaning(s.meaning),
        }))
        .filter((s) => s.hanzi && s.meaning);

      for (const s of turns) {
        const sk = normalizeTextKey(s.hanzi);
        if (sk.length >= 2 && !sentSeen.has(sk)) {
          sentSeen.add(sk);
          sentences.push({
            hanzi: s.hanzi,
            pinyin: s.pinyin,
            meaning: s.meaning,
            lessonNum,
            isCurrent,
            source: 'text',
          });
        }
      }

      const isConversation =
        !(t.title || '').includes('Luyện mẫu câu') && !(t.title || '').includes('Ôn tập lũy tiến');

      if (isConversation) {
        for (let k = 0; k + 1 < turns.length; k++) {
          const a = turns[k];
          const b = turns[k + 1];
          const pk = `${normalizeTextKey(a.hanzi)}=>${normalizeTextKey(b.hanzi)}`;
          if (
            a.speaker &&
            b.speaker &&
            a.speaker !== b.speaker &&
            !pairSeen.has(pk) &&
            normalizeTextKey(a.hanzi) !== normalizeTextKey(b.hanzi)
          ) {
            pairSeen.add(pk);
            pairs.push({
              a,
              b,
              lessonNum,
              isCurrent,
              title: t.title,
            });
          }
        }

        // Slice long dialogues into 3-5 sentence windows for rich passage reading/listening
        if (turns.length >= 3) {
          if (turns.length <= 6) {
            passages.push({ turns, lessonNum, isCurrent, title: t.title, textIdx: ti });
          } else {
            const mid = Math.ceil(turns.length / 2);
            passages.push({ turns: turns.slice(0, Math.min(5, turns.length)), lessonNum, isCurrent, title: t.title, textIdx: ti });
            passages.push({ turns: turns.slice(Math.max(0, mid - 1), turns.length), lessonNum, isCurrent, title: t.title, textIdx: ti });
            if (turns.length >= 9) {
              passages.push({ turns: turns.slice(2, Math.min(7, turns.length)), lessonNum, isCurrent, title: t.title, textIdx: ti });
            }
          }
        }
      }

      // Preserve genuine multi-turn listening comprehension questions from texts
      for (const lq of t.listeningQuestions || []) {
        if (lq.question && lq.question.includes('tình huống mới') && lq.audioText && Array.isArray(lq.options) && lq.options.length === 4) {
          existingMultiListening.push({
            audioText: cleanChinese(lq.audioText),
            question: cleanMeaning(lq.question),
            options: lq.options.map((o) => cleanChinese(cleanMeaning(o))),
            correctIndex: lq.correctIndex,
            explanation: lq.explanation || '',
            isCurrent,
            lessonNum,
          });
        }
      }
    }

    // 4. Sentence scramble & translation exercises
    for (const ss of lesson.exercises?.sentenceScramble || []) {
      const th = cleanChinese(ss.targetHanzi);
      const tm = cleanMeaning(ss.targetMeaning);
      const key = normalizeTextKey(th);
      if (th && tm && Array.isArray(ss.tokens) && ss.tokens.length >= 2 && !scrambleSeen.has(key)) {
        scrambleSeen.add(key);
        scrambles.push({
          targetHanzi: th,
          targetMeaning: tm,
          pinyin: (ss.pinyin || '').trim(),
          tokens: ss.tokens.map((x) => cleanChinese(x)).filter(Boolean),
          lessonNum,
          isCurrent,
        });
      }
      if (th && tm && !sentSeen.has(key)) {
        sentSeen.add(key);
        sentences.push({
          hanzi: th,
          pinyin: (ss.pinyin || '').trim(),
          meaning: tm,
          lessonNum,
          isCurrent,
          source: 'scramble',
        });
      }
    }

    for (const tr of lesson.exercises?.translationExercises || []) {
      const ch = cleanChinese(tr.expectedChinese);
      const mn = cleanMeaning(tr.promptText);
      const key = normalizeTextKey(ch);
      if (!ch || !mn) continue;
      if (tr.direction === 'vi_to_zh') {
        translationsViZh.push({ hanzi: ch, meaning: mn, hint: tr.hint || '', explanation: tr.explanation || '', isCurrent, lessonNum });
      } else {
        translationsZhVi.push({ hanzi: ch, meaning: mn, explanation: tr.explanation || '', isCurrent, lessonNum });
      }
      if (!sentSeen.has(key)) {
        sentSeen.add(key);
        sentences.push({ hanzi: ch, pinyin: '', meaning: mn, lessonNum, isCurrent, source: 'trans' });
      }
    }

    // 5. Preserve cleaned "[Đọc hiểu mở rộng]" questions from existing comprehensiveTest
    for (const ct of lesson.comprehensiveTest || []) {
      if (
        ct.category === 'reading' &&
        ct.question &&
        ct.question.includes('Đọc hiểu mở rộng') &&
        ct.passage &&
        Array.isArray(ct.options) &&
        ct.options.length === 4
      ) {
        const cleanPassage = ct.passage
          .split('\n')
          .map((line) => {
            const m = line.match(/^([^:：]+[:：]\s*)(.*)$/);
            if (m) return m[1] + cleanChinese(m[2]);
            return cleanChinese(line);
          })
          .join('\n');
        existingReadingComp.push({
          passage: cleanPassage,
          question: cleanMeaning(ct.question),
          options: ct.options.map((o) => cleanChinese(cleanMeaning(o))),
          correctIndex: ct.correctIndex,
          explanation: ct.explanation || '',
          isCurrent,
          lessonNum,
        });
      }
    }
  }

  return {
    sentences,
    pairs,
    vocabList,
    passages,
    scrambles,
    translationsZhVi,
    translationsViZh,
    existingMultiListening,
    existingReadingComp,
  };
}

function buildWrongTokenOrders(tokens, targetHanzi, rng, fallbackChinesePool) {
  const targetClean = stripPunct(targetHanzi);
  const results = [];
  const used = new Set([targetClean]);

  if (tokens.length >= 3) {
    // Try deterministic rotations & swaps first
    for (let attempt = 0; attempt < 40 && results.length < 3; attempt++) {
      const copy = [...tokens];
      if (attempt === 0) {
        copy.reverse();
      } else if (attempt === 1) {
        const first = copy.shift();
        copy.push(first);
      } else if (attempt === 2 && copy.length >= 2) {
        [copy[0], copy[1]] = [copy[1], copy[0]];
      } else {
        shuffleInPlace(copy, rng);
      }
      const joined = copy.join('');
      const key = stripPunct(joined);
      if (key && !used.has(key)) {
        used.add(key);
        const endPunct = /[？?]$/.test(targetHanzi) ? '？' : '。';
        results.push(joined + endPunct);
      }
    }
  }

  // Fallback if sentence only has 2 unique token swaps
  for (const cand of fallbackChinesePool) {
    if (results.length >= 3) break;
    const key = stripPunct(cand);
    if (key && !used.has(key)) {
      used.add(key);
      results.push(cand);
    }
  }
  return results;
}

function generateLessonTest(lessons, idx) {
  const lesson = lessons[idx];
  const lessonNum = idx + 1;
  const rng = createRng(lessonNum * 7919 + 1337);
  const cfg = getTierConfig(lesson.vocabulary.length);
  const pools = collectLessonPools(lessons, idx);

  const distractorMeanings = pools.sentences.map((s) => s.meaning);
  const distractorChinese = pools.sentences.map((s) => s.hanzi);
  const vocabHanziPool = pools.vocabList.map((v) => v.hanzi);
  const vocabMeaningPool = pools.vocabList.map((v) => v.meaning);
  const vocabPinyinPool = pools.vocabList.map((v) => v.pinyin).filter(Boolean);

  // Shuffle copies of current-first pools for variety without exhausting current items
  const sortCurrentFirst = (arr) => {
    const curr = arr.filter((x) => x.isCurrent);
    const prev = arr.filter((x) => !x.isCurrent);
    shuffleInPlace(curr, rng);
    shuffleInPlace(prev, rng);
    return [...curr, ...prev];
  };

  const sentPool = sortCurrentFirst(pools.sentences);
  const pairPool = sortCurrentFirst(pools.pairs);
  const vocabPool = sortCurrentFirst(pools.vocabList);
  const passagePool = sortCurrentFirst(pools.passages);
  const scramblePool = sortCurrentFirst(pools.scrambles);
  const transViZhPool = sortCurrentFirst(pools.translationsViZh);

  const usedGlobalSentenceP1 = new Set();
  const usedGlobalSentenceP2 = new Set();
  const usedGlobalTransZhVi = new Set();
  const usedVocabWords = new Set();

  const questions = [];
  const pushQ = (q) => {
    questions.push({
      id: `ct${lessonNum}_${questions.length + 1}`,
      ...q,
    });
  };

  // ============================================================================
  // 1. NGHE HSK - PHẦN 1 (12.5%): Nghe câu chọn nghĩa Việt hoặc câu Hán tự
  // ============================================================================
  let sCursor = 0;
  for (let k = 0; k < cfg.p1; k++) {
    let item = null;
    for (let tryIdx = 0; tryIdx < sentPool.length; tryIdx++) {
      const cand = sentPool[(sCursor + tryIdx) % sentPool.length];
      const key = normalizeTextKey(cand.hanzi);
      if (!usedGlobalSentenceP1.has(key) && cand.meaning && cand.hanzi.length >= 2) {
        usedGlobalSentenceP1.add(key);
        item = cand;
        sCursor = (sCursor + tryIdx + 1) % sentPool.length;
        break;
      }
    }
    if (!item) item = sentPool[k % sentPool.length];

    if (k % 2 === 0) {
      const dPool = shuffleInPlace([...distractorMeanings], rng);
      const { options, correctIndex } = buildOptionsWithCorrect(item.meaning, dPool, rng, 4, false);
      pushQ({
        category: 'listening',
        audioText: item.hanzi,
        question: 'Nghe đoạn ghi âm và chọn nghĩa tiếng Việt đúng:',
        options,
        correctIndex,
        explanation: `Nội dung nghe được: “${item.hanzi}”${item.pinyin ? ` (${item.pinyin})` : ''} → ${item.meaning}`,
      });
    } else {
      const dPool = shuffleInPlace([...distractorChinese], rng);
      const { options, correctIndex } = buildOptionsWithCorrect(item.hanzi, dPool, rng, 4, true);
      pushQ({
        category: 'listening',
        audioText: item.hanzi,
        question: 'Nghe đoạn ghi âm và chọn câu tiếng Trung khớp với nội dung vừa nghe:',
        options,
        correctIndex,
        explanation: `Câu vừa đọc: “${item.hanzi}”${item.pinyin ? ` (${item.pinyin})` : ''} → ${item.meaning}`,
      });
    }
  }

  // ============================================================================
  // 2. NGHE HSK - PHẦN 2 (12.5%): Nghe câu phán đoán Đúng / Sai (对 / 错)
  // ============================================================================
  for (let k = 0; k < cfg.p2_tf; k++) {
    let item = null;
    for (let tryIdx = 0; tryIdx < sentPool.length; tryIdx++) {
      const cand = sentPool[(sCursor + tryIdx) % sentPool.length];
      const key = normalizeTextKey(cand.hanzi);
      if (!usedGlobalSentenceP2.has(key) && !usedGlobalSentenceP1.has(key)) {
        usedGlobalSentenceP2.add(key);
        item = cand;
        sCursor = (sCursor + tryIdx + 1) % sentPool.length;
        break;
      }
    }
    if (!item) {
      for (const cand of sentPool) {
        const key = normalizeTextKey(cand.hanzi);
        if (!usedGlobalSentenceP2.has(key)) {
          usedGlobalSentenceP2.add(key);
          item = cand;
          break;
        }
      }
    }
    if (!item) item = sentPool[(k + 5) % sentPool.length];

    const isTrue = k % 2 === 0;
    let statement = item.meaning;
    if (!isTrue) {
      // Pick a genuinely different meaning from the same/earlier lessons
      const altCands = sentPool.filter(
        (x) => normalizeMeaningKey(x.meaning) !== normalizeMeaningKey(item.meaning) && normalizeTextKey(x.hanzi) !== normalizeTextKey(item.hanzi),
      );
      const wrongItem = altCands[Math.floor(rng() * altCands.length)] || sentPool[0];
      statement = wrongItem.meaning;
    }

    pushQ({
      category: 'listening',
      audioText: item.hanzi,
      question: `Nghe đoạn ghi âm và cho biết nhận định sau ĐÚNG hay SAI:\n\nNhận định: “${statement}”`,
      options: ['Đúng (对 / ✓)', 'Sai (错 / ✗)'],
      correctIndex: isTrue ? 0 : 1,
      explanation: isTrue
        ? `Đúng (✓). Câu nghe được là: “${item.hanzi}”${item.pinyin ? ` (${item.pinyin})` : ''} → ${item.meaning}.`
        : `Sai (✗). Câu thực tế nghe được là: “${item.hanzi}”${item.pinyin ? ` (${item.pinyin})` : ''}, nghĩa đúng là: “${item.meaning}”, không phải “${statement}”.`,
    });
  }

  // ============================================================================
  // 3. NGHE HSK - PHẦN 3 (12.5%): Nghe đối thoại ngắn 2 lượt A–B chọn đáp án
  // ============================================================================
  const usedPairsL3 = new Set();
  for (let k = 0; k < cfg.p3_short; k++) {
    let pair = pairPool[k % pairPool.length];
    for (const cand of pairPool) {
      const pk = `${normalizeTextKey(cand.a.hanzi)}=>${normalizeTextKey(cand.b.hanzi)}`;
      if (!usedPairsL3.has(pk)) {
        usedPairsL3.add(pk);
        pair = cand;
        break;
      }
    }
    const audioText = `${pair.a.hanzi}\n${pair.b.hanzi}`;
    if (k % 2 === 0) {
      const dPool = shuffleInPlace([...distractorMeanings], rng);
      const { options, correctIndex } = buildOptionsWithCorrect(pair.b.meaning, dPool, rng, 4, false);
      pushQ({
        category: 'listening',
        audioText,
        question: 'Nghe đoạn đối thoại giữa hai người, người thứ hai đã phản hồi với nội dung gì?',
        options,
        correctIndex,
        explanation: `Người 1: “${pair.a.hanzi}” (${pair.a.meaning})\nNgười 2 đáp lại: “${pair.b.hanzi}” → ${pair.b.meaning}.`,
      });
    } else {
      const dPool = shuffleInPlace([...distractorChinese], rng);
      const { options, correctIndex } = buildOptionsWithCorrect(pair.b.hanzi, dPool, rng, 4, true);
      pushQ({
        category: 'listening',
        audioText,
        question: 'Nghe đoạn đối thoại ngắn sau và chọn đúng câu trả lời của người thứ hai:',
        options,
        correctIndex,
        explanation: `Hội thoại: “${pair.a.hanzi}” / “${pair.b.hanzi}” (${pair.b.meaning}).`,
      });
    }
  }

  // ============================================================================
  // 4. NGHE HSK - PHẦN 4 (12.5%): Nghe đối thoại dài / đoạn văn chọn đáp án
  // ============================================================================
  const currentMultiL = pools.existingMultiListening.filter((x) => x.isCurrent);
  let p4Added = 0;
  for (const ml of currentMultiL) {
    if (p4Added >= cfg.p4_long) break;
    pushQ({
      category: 'listening',
      audioText: ml.audioText,
      question: ml.question.replace(/^\[[^\]]+\]\s*/, ''),
      options: ml.options,
      correctIndex: ml.correctIndex,
      explanation: ml.explanation,
    });
    p4Added++;
  }

  let passIdx = 0;
  while (p4Added < cfg.p4_long) {
    const pObj = passagePool[passIdx % passagePool.length];
    passIdx++;
    const turns = pObj.turns;
    const audioText = turns.map((t) => t.hanzi).join('\n');
    const passageKeys = new Set(turns.map((t) => normalizeMeaningKey(t.meaning)));
    const passageChineseKeys = new Set(turns.map((t) => normalizeTextKey(t.hanzi)));

    if (p4Added % 2 === 0) {
      // Pick the richest/last informative turn in this dialogue slice
      const targetTurn = turns[Math.min(turns.length - 1, (p4Added + 1) % turns.length)];
      const safeWrongMeanings = shuffleInPlace(
        distractorMeanings.filter((m) => !passageKeys.has(normalizeMeaningKey(m))),
        rng,
      );
      const { options, correctIndex } = buildOptionsWithCorrect(targetTurn.meaning, safeWrongMeanings, rng, 4, false);
      pushQ({
        category: 'listening',
        audioText,
        question: 'Nghe toàn bộ đoạn hội thoại sau và chọn thông tin CÓ xuất hiện trong bài nghe:',
        options,
        correctIndex,
        explanation: `Trong đoạn hội thoại có câu: “${targetTurn.hanzi}” (${targetTurn.pinyin}) → ${targetTurn.meaning}.`,
      });
    } else {
      const targetTurn = turns[Math.min(turns.length - 1, p4Added % turns.length)];
      const speakerLabel = targetTurn.speaker || 'một nhân vật trong bài';
      const safeWrongChinese = shuffleInPlace(
        distractorChinese.filter((c) => !passageChineseKeys.has(normalizeTextKey(c))),
        rng,
      );
      const { options, correctIndex } = buildOptionsWithCorrect(targetTurn.hanzi, safeWrongChinese, rng, 4, true);
      pushQ({
        category: 'listening',
        audioText,
        question: `Theo đoạn hội thoại vừa nghe, nhân vật “${speakerLabel}” đã nói câu nào sau đây?`,
        options,
        correctIndex,
        explanation: `Nhân vật ${speakerLabel} đã nói: “${targetTurn.hanzi}” (${targetTurn.meaning}).`,
      });
    }
    p4Added++;
  }

  // ============================================================================
  // 5. ĐỌC HSK - PHẦN 1 (~12.5%): Ghép câu đối thoại (`reading`) + Dịch Trung→Việt (`translate_zh_vi`)
  // ============================================================================
  let rMatchAdded = 0;
  for (const pair of pairPool) {
    if (rMatchAdded >= cfg.r_match) break;
    const pk = `${normalizeTextKey(pair.a.hanzi)}=>${normalizeTextKey(pair.b.hanzi)}`;
    // Prefer pairs not already tested verbatim in Nghe P3 if plenty exist
    if (usedPairsL3.has(pk) && pairPool.length > cfg.p3_short + cfg.r_match) continue;
    const dPool = shuffleInPlace(
      distractorChinese.filter((c) => normalizeTextKey(c) !== normalizeTextKey(pair.a.hanzi)),
      rng,
    );
    const { options, correctIndex } = buildOptionsWithCorrect(pair.b.hanzi, dPool, rng, 4, true);
    pushQ({
      category: 'reading',
      question: `Chọn câu trả lời / tiếp nối phù hợp nhất cho lời thoại sau:\n\nA: “${pair.a.hanzi}”`,
      options,
      correctIndex,
      explanation: `A: “${pair.a.hanzi}” (${pair.a.meaning})\n→ B đáp hợp lý: “${pair.b.hanzi}” (${pair.b.meaning}).`,
    });
    rMatchAdded++;
  }
  while (rMatchAdded < cfg.r_match) {
    const pair = pairPool[(rMatchAdded + 2) % pairPool.length];
    const dPool = shuffleInPlace(
      distractorChinese.filter((c) => normalizeTextKey(c) !== normalizeTextKey(pair.a.hanzi)),
      rng,
    );
    const { options, correctIndex } = buildOptionsWithCorrect(pair.b.hanzi, dPool, rng, 4, true);
    pushQ({
      category: 'reading',
      question: `Chọn câu phản hồi đúng ngữ cảnh cho câu:\n\nA: “${pair.a.hanzi}”`,
      options,
      correctIndex,
      explanation: `A: “${pair.a.hanzi}” (${pair.a.meaning}) → B: “${pair.b.hanzi}” (${pair.b.meaning}).`,
    });
    rMatchAdded++;
  }

  for (let k = 0; k < cfg.tz_vi; k++) {
    let item = null;
    for (const cand of sentPool) {
      const key = normalizeTextKey(cand.hanzi);
      if (!usedGlobalTransZhVi.has(key) && !usedGlobalSentenceP1.has(key)) {
        usedGlobalTransZhVi.add(key);
        item = cand;
        break;
      }
    }
    if (!item) {
      for (const cand of sentPool) {
        const key = normalizeTextKey(cand.hanzi);
        if (!usedGlobalTransZhVi.has(key)) {
          usedGlobalTransZhVi.add(key);
          item = cand;
          break;
        }
      }
    }
    if (!item) item = sentPool[(k + 1) % sentPool.length];
    const dPool = shuffleInPlace([...distractorMeanings], rng);
    const { options, correctIndex } = buildOptionsWithCorrect(item.meaning, dPool, rng, 4, false);
    pushQ({
      category: 'translate_zh_vi',
      question: `Chọn nghĩa tiếng Việt chính xác của câu sau:\n“${item.hanzi}”`,
      options,
      correctIndex,
      explanation: `Đáp án đúng: “${item.hanzi}”${item.pinyin ? ` (${item.pinyin})` : ''} → ${item.meaning}`,
    });
  }

  // ============================================================================
  // 6. ĐỌC HSK - PHẦN 2 (~12.5%): Điền từ vào chỗ trống (`fill_blank`) + Từ vựng (`vocab`)
  // ============================================================================
  const clozePairs = [];
  const clozeUsedSent = new Set();
  for (const w of vocabPool) {
    if (w.hanzi.length < 1) continue;
    // Sort sentences prioritizing shorter/clearer current-lesson sentences containing w.hanzi
    for (const s of sentPool) {
      if (clozeUsedSent.has(normalizeTextKey(s.hanzi))) continue;
      if (s.hanzi.includes(w.hanzi) && s.hanzi !== w.hanzi && s.hanzi.length >= w.hanzi.length + 2) {
        clozePairs.push({ word: w, sentence: s });
        clozeUsedSent.add(normalizeTextKey(s.hanzi));
        break;
      }
    }
  }

  const pickHanziDistractors = (targetWord) => {
    const sameLen = vocabPool
      .filter((v) => v.hanzi !== targetWord.hanzi && v.pinyin !== targetWord.pinyin && v.hanzi.length === targetWord.hanzi.length)
      .map((v) => v.hanzi);
    const otherLen = vocabPool
      .filter((v) => v.hanzi !== targetWord.hanzi && v.pinyin !== targetWord.pinyin && v.hanzi.length !== targetWord.hanzi.length)
      .map((v) => v.hanzi);
    return [...shuffleInPlace(sameLen, rng), ...shuffleInPlace(otherLen, rng)];
  };

  let clozeIdx = 0;
  for (let k = 0; k < cfg.fb_cloze; k++) {
    const pair = clozePairs[clozeIdx % clozePairs.length];
    clozeIdx++;
    const masked = pair.sentence.hanzi.replace(pair.word.hanzi, '____');
    const dPool = pickHanziDistractors(pair.word);
    const { options, correctIndex } = buildOptionsWithCorrect(pair.word.hanzi, dPool, rng, 4, true);
    pushQ({
      category: 'fill_blank',
      question: `Chọn từ thích hợp điền vào chỗ trống:\n“${masked}”\n(Gợi ý nghĩa: ${pair.sentence.meaning})`,
      options,
      correctIndex,
      explanation: `Từ cần điền là “${pair.word.hanzi}” (${pair.word.pinyin}: ${pair.word.meaning}). Câu hoàn chỉnh: “${pair.sentence.hanzi}”.`,
    });
  }

  for (let k = 0; k < cfg.vocab; k++) {
    let word = vocabPool[k % vocabPool.length];
    for (const cand of vocabPool) {
      if (!usedVocabWords.has(cand.hanzi)) {
        usedVocabWords.add(cand.hanzi);
        word = cand;
        break;
      }
    }
    if (k % 2 === 0 || !word.pinyin) {
      const dPool = shuffleInPlace([...vocabMeaningPool], rng);
      const { options, correctIndex } = buildOptionsWithCorrect(word.meaning, dPool, rng, 4, false);
      pushQ({
        category: 'vocab',
        question: `Từ “${word.hanzi}” có nghĩa tiếng Việt là gì?`,
        options,
        correctIndex,
        explanation: `“${word.hanzi}” (${word.pinyin}) là ${word.type}, nghĩa là: ${word.meaning}.`,
      });
    } else {
      const dPool = shuffleInPlace([...vocabPinyinPool], rng);
      const { options, correctIndex } = buildOptionsWithCorrect(word.pinyin, dPool, rng, 4, false);
      pushQ({
        category: 'vocab',
        question: `Từ Hán tự “${word.hanzi}” (${word.meaning}) có phiên âm Pinyin đúng là gì?`,
        options,
        correctIndex,
        explanation: `“${word.hanzi}” đọc là “${word.pinyin}”, nghĩa là: ${word.meaning}.`,
      });
    }
  }

  // ============================================================================
  // 7. ĐỌC HSK - PHẦN 3 (~12.5%): Đọc đoạn văn / hội thoại ngắn chọn đáp án (`reading`)
  // ============================================================================
  let rPassAdded = 0;
  const currentRComp = pools.existingReadingComp.filter((x) => x.isCurrent);
  for (const rc of currentRComp) {
    if (rPassAdded >= cfg.r_passage) break;
    pushQ({
      category: 'reading',
      passage: rc.passage,
      question: rc.question.replace(/^\[[^\]]+\]\s*/i, ''),
      options: rc.options,
      correctIndex: rc.correctIndex,
      explanation: rc.explanation,
    });
    rPassAdded++;
  }

  let rPassCursor = 0;
  while (rPassAdded < cfg.r_passage) {
    const pObj = passagePool[rPassCursor % passagePool.length];
    rPassCursor++;
    const turns = pObj.turns;
    const passageStr = turns
      .map((t) => (t.speaker ? `${t.speaker}: ${t.hanzi}` : t.hanzi))
      .join('\n');
    const passageKeys = new Set(turns.map((t) => normalizeMeaningKey(t.meaning)));
    const passageChineseKeys = new Set(turns.map((t) => normalizeTextKey(t.hanzi)));

    if (rPassAdded % 2 === 0) {
      const targetTurn = turns[Math.max(0, turns.length - 1 - (rPassAdded % turns.length))];
      const safeWrongMeanings = shuffleInPlace(
        distractorMeanings.filter((m) => !passageKeys.has(normalizeMeaningKey(m))),
        rng,
      );
      const { options, correctIndex } = buildOptionsWithCorrect(targetTurn.meaning, safeWrongMeanings, rng, 4, false);
      pushQ({
        category: 'reading',
        passage: passageStr,
        question: 'Đọc đoạn hội thoại trên, câu nào sau đây PHÙ HỢP với nội dung bài đọc?',
        options,
        correctIndex,
        explanation: `Trong đoạn hội thoại có câu: “${targetTurn.hanzi}” → ${targetTurn.meaning}.`,
      });
    } else {
      const speakersTurns = turns.filter((t) => t.speaker);
      const targetTurn = speakersTurns[rPassAdded % Math.max(1, speakersTurns.length)] || turns[0];
      const safeWrongChinese = shuffleInPlace(
        distractorChinese.filter((c) => !passageChineseKeys.has(normalizeTextKey(c))),
        rng,
      );
      const { options, correctIndex } = buildOptionsWithCorrect(targetTurn.hanzi, safeWrongChinese, rng, 4, true);
      pushQ({
        category: 'reading',
        passage: passageStr,
        question: targetTurn.speaker
          ? `Dựa vào đoạn hội thoại trên, nhân vật “${targetTurn.speaker}” đã nói câu nào sau đây?`
          : 'Câu nào sau đây có trong đoạn hội thoại trên?',
        options,
        correctIndex,
        explanation: `Trong bài đọc, ${targetTurn.speaker || 'người nói'} đã nói: “${targetTurn.hanzi}” (${targetTurn.meaning}).`,
      });
    }
    rPassAdded++;
  }

  // ============================================================================
  // 8. VIẾT HSK - PHẦN 1 (~6.25%): Sắp xếp từ thành câu / Dịch Việt→Trung (`translate_vi_zh`)
  // ============================================================================
  let viZhAdded = 0;
  for (const sc of scramblePool) {
    if (viZhAdded >= cfg.tv_zh) break;
    const endPunct = /[？?]$/.test(sc.targetHanzi) ? '？' : /[！!]$/.test(sc.targetHanzi) ? '！' : '。';
    const expectedSentence = /[。？！?!]$/.test(sc.targetHanzi) ? sc.targetHanzi : sc.targetHanzi + endPunct;
    const wrongOrders = buildWrongTokenOrders(sc.tokens, expectedSentence, rng, distractorChinese);
    const { options, correctIndex } = buildOptionsWithCorrect(expectedSentence, wrongOrders, rng, 4, true);
    const shuffledTokens = shuffleInPlace([...sc.tokens], rng);
    pushQ({
      category: 'translate_vi_zh',
      question: `Sắp xếp các từ gợi ý sau thành câu tiếng Trung đúng ngữ pháp:\nTừ gợi ý: ${shuffledTokens.join('  /  ')}\n(Nghĩa: “${sc.targetMeaning}”)`,
      options,
      correctIndex,
      explanation: `Trật tự đúng: ${expectedSentence}${sc.pinyin ? ` (${sc.pinyin})` : ''} → ${sc.targetMeaning}.`,
    });
    viZhAdded++;
  }

  for (const tr of transViZhPool) {
    if (viZhAdded >= cfg.tv_zh) break;
    const dPool = shuffleInPlace([...distractorChinese], rng);
    const { options, correctIndex } = buildOptionsWithCorrect(tr.hanzi, dPool, rng, 4, true);
    pushQ({
      category: 'translate_vi_zh',
      question: `Chọn câu tiếng Trung diễn đạt đúng nghĩa sau:\n“${tr.meaning}”`,
      options,
      correctIndex,
      explanation: tr.explanation || `“${tr.meaning}” → ${tr.hanzi}`,
    });
    viZhAdded++;
  }

  // ============================================================================
  // 9. VIẾT HSK - PHẦN 2 (~6.25%): Nhìn Pinyin chọn chữ Hán đúng (`fill_blank`)
  // ============================================================================
  for (let k = 0; k < cfg.fb_pinyin; k++) {
    const pair = clozePairs[(clozeIdx + k) % clozePairs.length];
    const pinyinCue = pair.word.pinyin || '?';
    const masked = pair.sentence.hanzi.replace(pair.word.hanzi, `____ (${pinyinCue})`);
    const dPool = pickHanziDistractors(pair.word);
    const { options, correctIndex } = buildOptionsWithCorrect(pair.word.hanzi, dPool, rng, 4, true);
    pushQ({
      category: 'fill_blank',
      question: `Chọn chữ Hán tương ứng với phiên âm Pinyin để hoàn thành câu:\n“${masked}”\n(Nghĩa: ${pair.sentence.meaning})`,
      options,
      correctIndex,
      explanation: `Âm “${pinyinCue}” trong câu này viết là “${pair.word.hanzi}” (${pair.word.meaning}). Câu hoàn chỉnh: “${pair.sentence.hanzi}”.`,
    });
  }

  return questions;
}

// ---- Main execution ----
const rawContent = fs.readFileSync(dataJsPath, 'utf8');
const declIdx = rawContent.indexOf('const DEFAULT_LESSONS');
if (declIdx === -1) throw new Error('Could not find const DEFAULT_LESSONS in data.js');
const header = rawContent.slice(0, declIdx);

const ctx = { window: {} };
vm.runInNewContext(rawContent + '\nwindow.DEFAULT_LESSONS = DEFAULT_LESSONS;', ctx);
const lessons = ctx.window.DEFAULT_LESSONS;

if (!Array.isArray(lessons) || lessons.length !== 26) {
  throw new Error(`Expected 26 lessons, got ${lessons?.length}`);
}

const summary = [];
const allIds = new Set();

for (let i = 0; i < lessons.length; i++) {
  const newCt = generateLessonTest(lessons, i);
  lessons[i].comprehensiveTest = newCt;

  const counts = {};
  for (const q of newCt) {
    if (allIds.has(q.id)) throw new Error(`Duplicate ID ${q.id}`);
    allIds.add(q.id);
    if (!Array.isArray(q.options) || q.options.length < 2) {
      throw new Error(`Invalid options count on ${q.id}`);
    }
    if (q.correctIndex < 0 || q.correctIndex >= q.options.length) {
      throw new Error(`Invalid correctIndex on ${q.id}`);
    }
    if (new Set(q.options).size !== q.options.length) {
      throw new Error(`Duplicate options inside ${q.id}: ${JSON.stringify(q.options)}`);
    }
    counts[q.category] = (counts[q.category] || 0) + 1;
  }

  summary.push({
    lesson: i + 1,
    vocab: lessons[i].vocabulary.length,
    total: newCt.length,
    listen: counts.listening || 0,
    read: counts.reading || 0,
    fill: counts.fill_blank || 0,
    vocabQ: counts.vocab || 0,
    zh_vi: counts.translate_zh_vi || 0,
    vi_zh: counts.translate_vi_zh || 0,
  });
}

const updatedJs = `${header}const DEFAULT_LESSONS = ${JSON.stringify(lessons, null, 2)};\r\n`;
fs.writeFileSync(dataJsPath, updatedJs, 'utf8');

console.table(summary);
console.log('Total generated questions across 26 lessons:', allIds.size);
