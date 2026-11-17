/**
 * Mở rộng kho câu hỏi Trò chơi (Sắp xếp câu & Dịch Việt–Trung) cho toàn bộ 26 bài học trong data.js.
 * Script chạy idempotent: giữ nguyên câu gốc (ss{N}_*, tr{N}_vi_*, tr{N}_zh_*) và sinh thêm từ câu thật
 * trong hội thoại (texts), ví dụ từ vựng và ví dụ ngữ pháp của từng bài.
 * Chạy bằng: node database/expand-games-exercises.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataJsPath = path.resolve(__dirname, '../data.js');

const TARGET_SCRAMBLES_PER_LESSON = 20;
const TARGET_TRANS_PER_DIRECTION = 14;

const COMMON_WORDS = [
  '我们', '你们', '他们', '她们', '大家', '自己', '什么', '怎么', '怎么样',
  '多少', '几', '哪里', '哪儿', '这里', '这儿', '那里', '那儿', '时候', '时间',
  '老师', '同学', '学生', '留学生', '朋友', '先生', '小姐', '医生', '工作',
  '早上', '上午', '中午', '下午', '晚上', '今天', '明天', '昨天', '现在', '星期',
  '学校', '大学', '中国', '越南', '北京', '名字', '请问', '贵姓', '认识', '高兴',
  '喜欢', '可以', '没有', '不是', '还是', '或者', '因为', '所以', '虽然', '但是',
  '如果', '已经', '正在', '非常', '觉得', '知道', '一下', '一点儿', '一会儿', '一点',
  '对不起', '没关系', '谢谢', '不客气', '再见', '您好', '你好', '非常感谢',
];

function cleanChineseSentence(str) {
  if (!str) return '';
  return str
    .replace(/\s*[(\（][A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ'\s,.\-!?/0-9]+:\s*[^)\）]+[)\）]/gi, '')
    .replace(/^[A-Za-z0-9]+\s*[:：]\s*/g, '')
    .replace(/\s+([，。！？；：、])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanVocabHanzi(hanzi) {
  if (!hanzi) return '';
  return hanzi
    .replace(/[（(][^）)]*[)）]/g, '')
    .split('/')[0]
    .replace(/[^\u4e00-\u9fff]/g, '')
    .trim();
}

function cleanVietnameseMeaning(str) {
  if (!str) return '';
  return str
    .replace(/^\[(Mở rộng|Ôn tập[^\]]*|Bài\s*\d+)\]\s*/gi, '')
    .replace(/^[A-Za-z0-9]+\s*[:：]\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanPinyinText(str) {
  if (!str) return '';
  return str
    .replace(/^[A-Za-z0-9]+\s*[:：]\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractHanziOnly(str) {
  return cleanChineseSentence(str).replace(/[^\u4e00-\u9fff]/g, '');
}

function stripPinyinPunct(str) {
  return cleanPinyinText(str)
    .replace(/[，。！？、；：“”"'.,!?;:]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLowerCase();
}

function segmentChineseTokens(hanziOnly, wordSet) {
  const tokens = [];
  let i = 0;
  const maxLen = 6;
  while (i < hanziOnly.length) {
    let matched = '';
    const limit = Math.min(maxLen, hanziOnly.length - i);
    for (let len = limit; len >= 2; len--) {
      const sub = hanziOnly.slice(i, i + len);
      if (wordSet.has(sub)) {
        matched = sub;
        break;
      }
    }
    if (matched) {
      tokens.push(matched);
      i += matched.length;
    } else {
      tokens.push(hanziOnly[i]);
      i += 1;
    }
  }
  return tokens;
}

function collectLessonSentencePool(lesson) {
  const poolMap = new Map();

  const addCandidate = (rawHanzi, rawPinyin, rawMeaning, priority) => {
    const cleanZh = cleanChineseSentence(rawHanzi);
    const hanziKey = cleanZh.replace(/[^\u4e00-\u9fff]/g, '');
    const cleanPy = cleanPinyinText(rawPinyin);
    const cleanVi = cleanVietnameseMeaning(rawMeaning);

    if (hanziKey.length < 3 || !cleanPy || !cleanVi) return;
    if (cleanVi.includes('Đây là câu ví dụ')) return;

    const existing = poolMap.get(hanziKey);
    if (!existing || priority < existing.priority) {
      poolMap.set(hanziKey, {
        hanziKey,
        hanziWithPunct: cleanZh,
        pinyin: cleanPy,
        meaning: cleanVi,
        priority,
      });
    }
  };

  (lesson.texts || []).forEach((t) => {
    (t.sentences || []).forEach((s) => addCandidate(s.hanzi, s.pinyin, s.meaning, 1));
  });

  (lesson.grammar || []).forEach((g) => {
    (g.examples || []).forEach((e) => addCandidate(e.hanzi, e.pinyin, e.meaning, 2));
  });

  (lesson.vocabulary || []).forEach((v) => {
    addCandidate(v.example, v.examplePinyin, v.exampleMeaning, 3);
  });

  return Array.from(poolMap.values()).sort((a, b) => a.priority - b.priority);
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

const cumulativeWords = new Set(COMMON_WORDS);
const summary = [];

for (let i = 0; i < lessons.length; i++) {
  const lesson = lessons[i];
  const lessonNum = i + 1;

  for (const v of lesson.vocabulary || []) {
    const cleaned = cleanVocabHanzi(v.hanzi);
    if (cleaned.length >= 2) cumulativeWords.add(cleaned);
  }

  const pool = collectLessonSentencePool(lesson);

  // 1. Expand Sentence Scramble
  const baseScrambles = (lesson.exercises?.sentenceScramble || []).filter(
    (s) => !String(s.id || '').includes('_exp_')
  );
  const existingScrambleKeys = new Set(
    baseScrambles.map((s) => extractHanziOnly(s.targetHanzi))
  );
  const nextScrambles = [...baseScrambles];
  let scCounter = 1;

  for (const item of pool) {
    if (nextScrambles.length >= TARGET_SCRAMBLES_PER_LESSON) break;
    if (existingScrambleKeys.has(item.hanziKey)) continue;
    const tokens = segmentChineseTokens(item.hanziKey, cumulativeWords);
    if (tokens.length < 2) continue;

    nextScrambles.push({
      id: `ss${lessonNum}_exp_${scCounter++}`,
      targetHanzi: item.hanziKey,
      targetMeaning: item.meaning,
      pinyin: item.pinyin,
      tokens,
    });
    existingScrambleKeys.add(item.hanziKey);
  }

  // 2. Expand Translation Exercises (vi_to_zh & zh_to_vi)
  const baseTrans = (lesson.exercises?.translationExercises || []).filter(
    (t) => !String(t.id || '').includes('_exp_')
  );
  const baseViToZh = baseTrans.filter((t) => t.direction === 'vi_to_zh');
  const baseZhToVi = baseTrans.filter((t) => t.direction === 'zh_to_vi');

  const existingViKeys = new Set(
    baseViToZh.map((t) => extractHanziOnly(t.expectedChinese || ''))
  );
  const existingZhKeys = new Set(
    baseZhToVi.map((t) => extractHanziOnly(t.promptText || ''))
  );

  const nextViToZh = [...baseViToZh];
  const nextZhToVi = [...baseZhToVi];
  let viCounter = 1;
  let zhCounter = 1;

  for (const item of pool) {
    if (nextViToZh.length >= TARGET_TRANS_PER_DIRECTION) break;
    if (existingViKeys.has(item.hanziKey)) continue;

    const cleanPy = stripPinyinPunct(item.pinyin);
    nextViToZh.push({
      id: `tr${lessonNum}_vi_exp_${viCounter++}`,
      direction: 'vi_to_zh',
      promptText: item.meaning,
      expectedChinese: item.hanziWithPunct,
      acceptedPinyin: cleanPy,
      hint: `Gợi ý Pinyin: ${item.pinyin}`,
      explanation: `${item.meaning} → ${item.hanziWithPunct} (${item.pinyin})`,
    });
    existingViKeys.add(item.hanziKey);
  }

  // Reverse offset pass so zh_to_vi picks varied sentences first where available
  const zhPool = [...pool].reverse();
  for (const item of zhPool) {
    if (nextZhToVi.length >= TARGET_TRANS_PER_DIRECTION) break;
    if (existingZhKeys.has(item.hanziKey)) continue;

    const kws = item.meaning
      .toLowerCase()
      .replace(/[,.;:!?'"“”‘’()（）！？。，、/]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    nextZhToVi.push({
      id: `tr${lessonNum}_zh_exp_${zhCounter++}`,
      direction: 'zh_to_vi',
      promptText: item.hanziWithPunct,
      chineseAudioText: item.hanziWithPunct,
      pinyin: item.pinyin,
      expectedMeaning: item.meaning,
      acceptedKeywords: kws,
      hint: `Pinyin: ${item.pinyin}`,
      explanation: `${item.hanziWithPunct} (${item.pinyin}) nghĩa là: ${item.meaning}`,
    });
    existingZhKeys.add(item.hanziKey);
  }

  lesson.exercises.sentenceScramble = nextScrambles;
  lesson.exercises.translationExercises = [...nextViToZh, ...nextZhToVi];

  summary.push({
    lesson: lessonNum,
    scramble: nextScrambles.length,
    vi_to_zh: nextViToZh.length,
    zh_to_vi: nextZhToVi.length,
    expandedQuiz: (lesson.exercises.expandedQuiz || []).length,
  });
}

const updatedJs = `${header}const DEFAULT_LESSONS = ${JSON.stringify(lessons, null, 2)};\r\n`;
fs.writeFileSync(dataJsPath, updatedJs, 'utf8');

console.table(summary);
console.log(
  'Min counts:',
  'scramble=', Math.min(...summary.map((s) => s.scramble)),
  'vi_to_zh=', Math.min(...summary.map((s) => s.vi_to_zh)),
  'zh_to_vi=', Math.min(...summary.map((s) => s.zh_to_vi))
);
