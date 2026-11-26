#!/usr/bin/env node
/**
 * Sinh bộ bài học Tiếng Anh CEFR A1 (31 buổi học từ 785 từ database/en/word-atlas-vi.json)
 * Xuất ra 2 đích đồng bộ (Dual-Mode):
 *   1. database/en/lessons-a1.json (cho chế độ In-Memory fallback)
 *   2. db-migration/src/main/resources/db/migration/sql/seed_en_a1_data.sql (cho Liquibase PostgreSQL)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const INPUT_JSON = path.join(REPO_ROOT, 'database/en/word-atlas-vi.json');
const OUT_MEMORY_JSON = path.join(REPO_ROOT, 'database/en/lessons-a1.json');
const OUT_LIQUIBASE_SQL = path.join(
  REPO_ROOT,
  'db-migration/src/main/resources/db/migration/sql/seed_en_a1_data.sql'
);

// PRNG tất định để mỗi lần chạy generator sinh ra dữ liệu & checksum Liquibase ổn định
function createRng(seed = 20261125) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = createRng(20261125);

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sqlStr(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

function sqlJsonb(val) {
  return `${sqlStr(JSON.stringify(val))}::jsonb`;
}

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitChunks(items, numChunks) {
  const chunks = [];
  const total = items.length;
  let start = 0;
  for (let i = 0; i < numChunks; i++) {
    const remainingChunks = numChunks - i;
    const size = Math.ceil((total - start) / remainingChunks);
    chunks.push(items.slice(start, start + size));
    start += size;
  }
  return chunks.filter((c) => c.length > 0);
}

function tokenizeEnglishSentence(sentence) {
  const cleaned = String(sentence || '')
    .replace(/[“”"]/g, '')
    .replace(/[.!?,;:]+$/g, '')
    .replace(/[,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];
  return cleaned.split(' ').filter(Boolean);
}

function primaryViMeaning(word) {
  const first = word.senses?.[0]?.vi || '';
  return first.trim();
}

function fullViMeaning(word) {
  const parts = (word.senses || []).map((s) => s.vi?.trim()).filter(Boolean);
  return Array.from(new Set(parts)).join('; ');
}

function pickDistractors(pool, excludeSet, count = 3) {
  const candidates = pool.filter((x) => x && !excludeSet.has(x));
  return shuffle(candidates).slice(0, count);
}

function blankTargetWord(sentence, targetWord) {
  if (!sentence || !targetWord) return null;
  const escaped = escapeRegex(targetWord.trim());
  const rx = new RegExp(`\\b(${escaped}(?:s|es|ed|ing)?)\\b`, 'i');
  if (!rx.test(sentence)) return null;
  return sentence.replace(rx, '____');
}

function buildLessonGroups(allWords) {
  const byTopic = new Map();
  for (const w of allWords) {
    const key = w.topic || 'daily';
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key).push(w);
  }

  const take = (topic) => {
    const list = byTopic.get(topic) || [];
    byTopic.delete(topic);
    return list;
  };

  const specs = [
    { label: 'Giáo dục & Trường học', unit: 'A1 · Giáo dục', words: take('education'), parts: 2 },
    { label: 'Du lịch & Di chuyển', unit: 'A1 · Du lịch', words: take('travel'), parts: 2 },
    { label: 'Xã hội & Cộng đồng', unit: 'A1 · Xã hội', words: take('society'), parts: 2 },
    { label: 'Thiên nhiên & Thời tiết', unit: 'A1 · Thiên nhiên', words: take('nature'), parts: 2 },
    { label: 'Sức khỏe & Cơ thể', unit: 'A1 · Sức khỏe', words: take('health'), parts: 1 },
    { label: 'Nghệ thuật & Sáng tạo', unit: 'A1 · Nghệ thuật', words: take('arts'), parts: 1 },
    { label: 'Tư duy & Nhận thức', unit: 'A1 · Tư duy', words: take('thinking'), parts: 1 },
    { label: 'Cảm xúc & Tính cách', unit: 'A1 · Cảm xúc', words: take('emotion'), parts: 1 },
    {
      label: 'Công việc & Kinh tế',
      unit: 'A1 · Công việc & Kinh tế',
      words: [...take('work'), ...take('economy')],
      parts: 1,
    },
    {
      label: 'Đô thị & Thể thao',
      unit: 'A1 · Đô thị & Thể thao',
      words: [...take('city'), ...take('sport')],
      parts: 1,
    },
    {
      label: 'Công nghệ, Khoa học & Thế giới',
      unit: 'A1 · Công nghệ & Khoa học',
      words: [
        ...take('technology'),
        ...take('media'),
        ...take('science'),
        ...take('environment'),
        ...take('history'),
        ...take('government'),
      ],
      parts: 1,
    },
    { label: 'Đời sống hằng ngày', unit: 'A1 · Đời sống', words: take('daily'), parts: 16 },
  ];

  // Gom mọi topic lạ (nếu có) vào nhóm cuối
  const leftovers = Array.from(byTopic.values()).flat();
  if (leftovers.length > 0) {
    specs[specs.length - 1].words.push(...leftovers);
  }

  const lessons = [];
  let num = 1;
  for (const spec of specs) {
    if (spec.words.length === 0) continue;
    const chunks = splitChunks(spec.words, spec.parts);
    chunks.forEach((chunk, idx) => {
      const partSuffix = chunks.length > 1 ? ` (${idx + 1})` : '';
      lessons.push({
        num,
        id: `en-a1-${num}`,
        title: `Bài ${num}: ${spec.label}${partSuffix} - CEFR A1`,
        hskLevel: 'CEFR A1',
        unit: spec.unit,
        description: `${chunk.length} từ vựng Tiếng Anh CEFR A1 chủ đề ${spec.label.toLowerCase()} kèm ảnh minh họa, phát âm UK/US, collocations và câu ví dụ song ngữ.`,
        words: chunk,
      });
      num += 1;
    });
  }
  return lessons;
}

function buildLessonDetail(group, allWords) {
  const allMeaningsPool = Array.from(new Set(allWords.map(primaryViMeaning).filter(Boolean)));
  const allHeadwordsPool = Array.from(new Set(allWords.map((w) => w.w).filter(Boolean)));

  const vocabulary = group.words.map((w) => ({
    id: `ven_${w.id}`,
    hanzi: w.w,
    pinyin: w.us || w.uk || '',
    sinoVietnamese: w.cefr || 'A1',
    meaning: fullViMeaning(w),
    type: w.senses?.[0]?.pos || 'n.',
    radical: w.fam?.length ? w.fam.join(', ') : null,
    breakdown:
      [
        w.syn?.length ? `Đồng nghĩa: ${w.syn.join(', ')}` : '',
        w.ant?.length ? `Trái nghĩa: ${w.ant.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' · ') || null,
    mnemonic: w.tipVi || null,
    example: w.ex?.[0]?.en || null,
    examplePinyin: null,
    exampleMeaning: w.ex?.[0]?.vi || null,
    meta: {
      wordId: w.id,
      ukIpa: w.uk || '',
      usIpa: w.us || '',
      cefr: w.cefr || 'A1',
      topic: w.topic || 'daily',
      senses: w.senses || [],
      examples: (w.ex || []).map((ex, idx) => ({
        en: ex.en,
        vi: ex.vi,
        audioKind: idx === 0 ? (w.media?.ex ? 'ex' : null) : w.media?.ex2 ? 'ex2' : null,
      })),
      collocations: w.col || [],
      wordFamily: w.fam || [],
      synonyms: w.syn || [],
      antonyms: w.ant || [],
      tipVi: w.tipVi || '',
      noteVi: w.noteVi || '',
      media: w.media || { img: true, uk: true, us: true, ex: true, ex2: false },
    },
  }));

  // Grammar / Usage cards (4 điểm lưu ý cách dùng nổi bật trong bài)
  const grammarCandidates = [...group.words]
    .filter((w) => w.tipVi && w.tipVi.length >= 16)
    .sort((a, b) => (b.col?.length || 0) + (b.tipVi?.length || 0) - ((a.col?.length || 0) + (a.tipVi?.length || 0)))
    .slice(0, 4);

  const grammar = grammarCandidates.map((w, idx) => ({
    id: `gen_${group.num}_${idx + 1}`,
    title: `Cách dùng “${w.w}” (${w.senses?.[0]?.pos || 'word'}) — ${primaryViMeaning(w)}`,
    formula: w.col?.length
      ? w.col
          .slice(0, 3)
          .map((c) => c.en)
          .join('  ·  ')
      : `${w.w} ${w.us || w.uk || ''}`.trim(),
    explanation: w.tipVi,
    notes:
      [
        w.noteVi,
        w.fam?.length ? `Họ từ (Word Family): ${w.fam.join(', ')}` : '',
        w.syn?.length ? `Đồng nghĩa: ${w.syn.join(', ')}` : '',
        w.ant?.length ? `Trái nghĩa: ${w.ant.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' | ') || null,
    examples: (w.ex || []).map((ex) => ({
      hanzi: ex.en,
      pinyin: '',
      meaning: ex.vi,
    })),
  }));

  // Texts (2 bài luyện đọc & nghe câu mẫu thực tế)
  const dailySentences = group.words
    .filter((w) => w.ex?.[0]?.en && w.ex?.[0]?.vi)
    .slice(0, 8);
  const ieltsSentences = group.words
    .filter((w) => w.ex?.[1]?.en && w.ex?.[1]?.vi)
    .slice(0, 6);

  const texts = [];
  if (dailySentences.length > 0) {
    texts.push({
      id: `ten_${group.num}_1`,
      title: 'Bài đọc 1: Câu giao tiếp hằng ngày',
      description: 'Luyện nghe và đọc các câu giao tiếp ngắn sử dụng từ vựng trọng tâm trong bài.',
      sentences: dailySentences.map((w, sIdx) => ({
        id: `tsen_${group.num}_1_${sIdx + 1}`,
        speaker: w.w,
        hanzi: w.ex[0].en,
        displayHanzi: w.ex[0].en,
        pinyin: w.us || w.uk || null,
        meaning: w.ex[0].vi,
      })),
      listeningQuestions: dailySentences.slice(0, 3).map((w, qIdx) => {
        const correct = w.ex[0].vi;
        const distractors = pickDistractors(
          dailySentences.map((x) => x.ex[0].vi),
          new Set([correct]),
          3
        );
        while (distractors.length < 3) {
          const extra = pickDistractors(allMeaningsPool, new Set([correct, ...distractors]), 1);
          if (!extra[0]) break;
          distractors.push(extra[0]);
        }
        const options = shuffle([correct, ...distractors]);
        return {
          id: `lqen_${group.num}_1_${qIdx + 1}`,
          audioText: w.ex[0].en,
          question: 'Nghe câu tiếng Anh và chọn bản dịch tiếng Việt đúng nhất:',
          options,
          correctIndex: options.indexOf(correct),
          explanation: `${w.ex[0].en} → ${w.ex[0].vi}`,
        };
      }),
    });
  }

  if (ieltsSentences.length > 0) {
    texts.push({
      id: `ten_${group.num}_2`,
      title: 'Bài đọc 2: Ngữ cảnh học thuật (IELTS)',
      description: 'Làm quen với cách dùng từ vựng A1 trong các câu văn phong học thuật chuẩn IELTS.',
      sentences: ieltsSentences.map((w, sIdx) => ({
        id: `tsen_${group.num}_2_${sIdx + 1}`,
        speaker: w.w,
        hanzi: w.ex[1].en,
        displayHanzi: w.ex[1].en,
        pinyin: w.us || w.uk || null,
        meaning: w.ex[1].vi,
      })),
      listeningQuestions: ieltsSentences.slice(0, 2).map((w, qIdx) => {
        const correct = primaryViMeaning(w);
        const distractors = pickDistractors(allMeaningsPool, new Set([correct]), 3);
        const options = shuffle([correct, ...distractors]);
        return {
          id: `lqen_${group.num}_2_${qIdx + 1}`,
          audioText: w.ex[1].en,
          question: `Trong câu vừa nghe, từ “${w.w}” mang nghĩa nào sau đây?`,
          options,
          correctIndex: options.indexOf(correct),
          explanation: `“${w.w}” (${w.us || w.uk}): ${correct}. Câu đầy đủ: ${w.ex[1].en}`,
        };
      }),
    });
  }

  // Sentence Scrambles (8-10 câu ngắn 4-11 từ tiếng Anh)
  const scrambleCandidates = group.words
    .filter((w) => {
      const tokens = tokenizeEnglishSentence(w.ex?.[0]?.en);
      return tokens.length >= 4 && tokens.length <= 11 && w.ex?.[0]?.vi;
    })
    .slice(0, 10);

  const sentenceScramble = scrambleCandidates.map((w, idx) => {
    const tokens = tokenizeEnglishSentence(w.ex[0].en);
    return {
      id: `ssen_${group.num}_${idx + 1}`,
      targetHanzi: tokens.join(' '),
      targetMeaning: w.ex[0].vi,
      pinyin: `${w.w} ${w.us || w.uk || ''}`.trim(),
      tokens: shuffle(tokens),
      unlearnedHint: null,
    };
  });

  // Translation Exercises (6 vi_to_en + 6 en_to_vi)
  const transPool = group.words.filter((w) => w.ex?.[0]?.en && w.ex?.[0]?.vi);
  const viToEn = transPool.slice(0, 6).map((w, idx) => ({
    id: `tren_vi_${group.num}_${idx + 1}`,
    direction: 'vi_to_en',
    promptText: w.ex[0].vi,
    chineseAudioText: null,
    pinyin: null,
    expectedChinese: w.ex[0].en,
    expectedMeaning: null,
    acceptedPinyin: w.w,
    acceptedKeywords: [],
    hint: `Từ khóa gợi ý: ${w.w} (${w.senses?.[0]?.pos || ''})`,
    explanation: `${w.ex[0].vi} → ${w.ex[0].en}`,
  }));

  const enToVi = transPool.slice(6, 12).map((w, idx) => ({
    id: `tren_en_${group.num}_${idx + 1}`,
    direction: 'en_to_vi',
    promptText: w.ex[0].en,
    chineseAudioText: w.ex[0].en,
    pinyin: w.us || w.uk || null,
    expectedChinese: null,
    expectedMeaning: w.ex[0].vi,
    acceptedPinyin: null,
    acceptedKeywords: w.ex[0].vi
      .toLowerCase()
      .split(/[\s,;:.!?()]+/)
      .filter((tok) => tok.length >= 2)
      .slice(0, 8),
    hint: `Từ trọng tâm: ${w.w} (${primaryViMeaning(w)})`,
    explanation: `${w.ex[0].en} → ${w.ex[0].vi}`,
  }));

  const translationExercises = [...viToEn, ...enToVi];

  // Expanded Quiz (15 câu trắc nghiệm luyện nhanh)
  const lessonMeaningPool = Array.from(new Set(group.words.map(primaryViMeaning).filter(Boolean)));
  const lessonWordPool = Array.from(new Set(group.words.map((w) => w.w).filter(Boolean)));

  const expandedQuiz = group.words.slice(0, 15).map((w, idx) => {
    const mode = idx % 3;
    if (mode === 0) {
      const correct = primaryViMeaning(w);
      const distractors = pickDistractors(
        lessonMeaningPool.length >= 6 ? lessonMeaningPool : allMeaningsPool,
        new Set([correct]),
        3
      );
      const options = shuffle([correct, ...distractors]);
      return {
        id: `eqen_${group.num}_${idx + 1}`,
        type: 'vocabulary',
        question: `Từ tiếng Anh “${w.w}” (${w.us || w.uk}) có nghĩa là gì?`,
        options,
        correctIndex: options.indexOf(correct),
        explanation: `“${w.w}” (${w.senses?.[0]?.pos || ''}): ${fullViMeaning(w)}.`,
      };
    }
    if (mode === 1 && w.senses?.[0]?.en) {
      const correct = w.w;
      const distractors = pickDistractors(
        lessonWordPool.length >= 6 ? lessonWordPool : allHeadwordsPool,
        new Set([correct]),
        3
      );
      const options = shuffle([correct, ...distractors]);
      return {
        id: `eqen_${group.num}_${idx + 1}`,
        type: 'definition',
        question: `Chọn từ tiếng Anh khớp với định nghĩa: “${w.senses[0].en}”`,
        options,
        correctIndex: options.indexOf(correct),
        explanation: `“${w.w}” (${w.us || w.uk}) nghĩa là: ${primaryViMeaning(w)}.`,
      };
    }
    const blanked = blankTargetWord(w.ex?.[0]?.en, w.w);
    if (blanked) {
      const correct = w.w;
      const distractors = pickDistractors(
        lessonWordPool.length >= 6 ? lessonWordPool : allHeadwordsPool,
        new Set([correct]),
        3
      );
      const options = shuffle([correct, ...distractors]);
      return {
        id: `eqen_${group.num}_${idx + 1}`,
        type: 'cloze',
        question: `Chọn từ thích hợp điền vào chỗ trống:\n“${blanked}”`,
        options,
        correctIndex: options.indexOf(correct),
        explanation: `Câu đầy đủ: ${w.ex[0].en} (${w.ex[0].vi})`,
      };
    }
    const correct = primaryViMeaning(w);
    const distractors = pickDistractors(allMeaningsPool, new Set([correct]), 3);
    const options = shuffle([correct, ...distractors]);
    return {
      id: `eqen_${group.num}_${idx + 1}`,
      type: 'vocabulary',
      question: `Nghĩa tiếng Việt của “${w.w}” là gì?`,
      options,
      correctIndex: options.indexOf(correct),
      explanation: `“${w.w}” (${w.us || w.uk}): ${fullViMeaning(w)}.`,
    };
  });

  // Comprehensive Test (~24 câu phân bổ đủ 4 kỹ năng: Listening, Vocab, Fill Blank, Reading, Translate)
  const comprehensiveTest = [];
  let qNo = 1;

  // 1. Listening (8 câu: nghe phát âm từ / câu ví dụ -> chọn nghĩa)
  for (const w of group.words.slice(0, 8)) {
    const useSentence = qNo % 2 === 0 && w.ex?.[0]?.en && w.ex?.[0]?.vi;
    const correct = useSentence ? w.ex[0].vi : primaryViMeaning(w);
    const pool = useSentence
      ? group.words.map((x) => x.ex?.[0]?.vi).filter(Boolean)
      : allMeaningsPool;
    const distractors = pickDistractors(pool, new Set([correct]), 3);
    const options = shuffle([correct, ...distractors]);
    comprehensiveTest.push({
      id: `cten_${group.num}_${qNo++}`,
      category: 'listening',
      audioText: useSentence ? w.ex[0].en : w.w,
      passage: null,
      question: useSentence
        ? 'Nghe câu tiếng Anh sau và chọn bản dịch tiếng Việt đúng:'
        : 'Nghe phát âm tiếng Anh và chọn nghĩa tiếng Việt đúng:',
      options,
      correctIndex: options.indexOf(correct),
      explanation: useSentence
        ? `${w.ex[0].en} → ${w.ex[0].vi}`
        : `${w.w} (${w.us || w.uk}) → ${fullViMeaning(w)}`,
    });
  }

  // 2. Vocab (5 câu: định nghĩa Anh-Anh hoặc từ -> nghĩa)
  for (const w of group.words.slice(4, 9)) {
    const correct = w.w;
    const distractors = pickDistractors(
      lessonWordPool.length >= 6 ? lessonWordPool : allHeadwordsPool,
      new Set([correct]),
      3
    );
    const options = shuffle([correct, ...distractors]);
    comprehensiveTest.push({
      id: `cten_${group.num}_${qNo++}`,
      category: 'vocab',
      audioText: null,
      passage: null,
      question: w.senses?.[0]?.en
        ? `Từ nào có nghĩa là: “${w.senses[0].en}”?`
        : `Chọn từ tiếng Anh tương ứng với nghĩa: “${primaryViMeaning(w)}”`,
      options,
      correctIndex: options.indexOf(correct),
      explanation: `${w.w} (${w.us || w.uk}) → ${primaryViMeaning(w)}`,
    });
  }

  // 3. Fill Blank (4 câu cloze)
  const clozeWords = group.words.filter((w) => blankTargetWord(w.ex?.[0]?.en, w.w)).slice(0, 4);
  for (const w of clozeWords) {
    const blanked = blankTargetWord(w.ex[0].en, w.w);
    const correct = w.w;
    const distractors = pickDistractors(
      lessonWordPool.length >= 6 ? lessonWordPool : allHeadwordsPool,
      new Set([correct]),
      3
    );
    const options = shuffle([correct, ...distractors]);
    comprehensiveTest.push({
      id: `cten_${group.num}_${qNo++}`,
      category: 'fill_blank',
      audioText: null,
      passage: null,
      question: `Điền từ thích hợp vào chỗ trống:\n“${blanked}”`,
      options,
      correctIndex: options.indexOf(correct),
      explanation: `Câu hoàn chỉnh: ${w.ex[0].en} (${w.ex[0].vi})`,
    });
  }

  // 4. Reading (4 câu đọc hiểu từ câu IELTS ex[1])
  for (const w of group.words.filter((x) => x.ex?.[1]?.en && x.ex?.[1]?.vi).slice(0, 4)) {
    const correct = primaryViMeaning(w);
    const distractors = pickDistractors(allMeaningsPool, new Set([correct]), 3);
    const options = shuffle([correct, ...distractors]);
    comprehensiveTest.push({
      id: `cten_${group.num}_${qNo++}`,
      category: 'reading',
      audioText: null,
      passage: w.ex[1].en,
      question: `Dựa vào câu trên, từ “${w.w}” có nghĩa phù hợp nhất là gì?`,
      options,
      correctIndex: options.indexOf(correct),
      explanation: `${w.w}: ${fullViMeaning(w)}. Dịch cả câu: ${w.ex[1].vi}`,
    });
  }

  // 5. Translate (3 câu: en->vi & vi->en)
  for (const w of group.words.slice(-3)) {
    const correct = w.w;
    const distractors = pickDistractors(allHeadwordsPool, new Set([correct]), 3);
    const options = shuffle([correct, ...distractors]);
    comprehensiveTest.push({
      id: `cten_${group.num}_${qNo++}`,
      category: 'translate_vi_zh',
      audioText: null,
      passage: null,
      question: `Chọn từ tiếng Anh đúng cho nghĩa: “${primaryViMeaning(w)}”`,
      options,
      correctIndex: options.indexOf(correct),
      explanation: `${primaryViMeaning(w)} → ${w.w} (${w.us || w.uk})`,
    });
  }

  return {
    id: group.id,
    languageCode: 'en',
    title: group.title,
    hskLevel: group.hskLevel,
    unit: group.unit,
    description: group.description,
    dateAdded: '2026-11-25',
    isSystem: true,
    ownerId: null,
    vocabulary,
    grammar,
    texts,
    exercises: {
      sentenceScramble,
      translationExercises,
      expandedQuiz,
    },
    comprehensiveTest,
  };
}

function generateSql(lessons) {
  const lines = [];
  lines.push('-- ============================================================================');
  lines.push('-- Auto-generated English CEFR A1 Seed Data from Word Atlas (785 words, 31 lessons)');
  lines.push('-- Source: Word Atlas contributors — CC BY 4.0 (translated to Vietnamese)');
  lines.push('-- ============================================================================');
  lines.push('');

  lessons.forEach((l, lIdx) => {
    const sortOrder = 1001 + lIdx;
    lines.push(
      `INSERT INTO lessons (id, language_code, title, hsk_level, unit, description, date_added, sort_order, is_system, owner_id, is_deleted, deleted_at) ` +
        `VALUES (${sqlStr(l.id)}, 'en', ${sqlStr(l.title)}, ${sqlStr(l.hskLevel)}, ${sqlStr(l.unit)}, ${sqlStr(l.description)}, ${sqlStr(l.dateAdded)}, ${sortOrder}, TRUE, NULL, 0, NULL) ` +
        `ON CONFLICT (id) DO UPDATE SET language_code = 'en', title = EXCLUDED.title, hsk_level = EXCLUDED.hsk_level, unit = EXCLUDED.unit, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order, is_system = TRUE, is_deleted = 0, deleted_at = NULL;`
    );

    l.vocabulary.forEach((v, vIdx) => {
      lines.push(
        `INSERT INTO vocabularies (id, lesson_id, hanzi, pinyin, sino_vietnamese, meaning, word_type, radical, breakdown, mnemonic, example_hanzi, example_pinyin, example_meaning, meta, sort_order, is_deleted, deleted_at) ` +
          `VALUES (${sqlStr(v.id)}, ${sqlStr(l.id)}, ${sqlStr(v.hanzi)}, ${sqlStr(v.pinyin)}, ${sqlStr(v.sinoVietnamese)}, ${sqlStr(v.meaning)}, ${sqlStr(v.type)}, ${sqlStr(v.radical)}, ${sqlStr(v.breakdown)}, ${sqlStr(v.mnemonic)}, ${sqlStr(v.example)}, ${sqlStr(v.examplePinyin)}, ${sqlStr(v.exampleMeaning)}, ${sqlJsonb(v.meta)}, ${vIdx + 1}, 0, NULL) ` +
          `ON CONFLICT (id) DO UPDATE SET lesson_id = EXCLUDED.lesson_id, hanzi = EXCLUDED.hanzi, pinyin = EXCLUDED.pinyin, sino_vietnamese = EXCLUDED.sino_vietnamese, meaning = EXCLUDED.meaning, word_type = EXCLUDED.word_type, radical = EXCLUDED.radical, breakdown = EXCLUDED.breakdown, mnemonic = EXCLUDED.mnemonic, example_hanzi = EXCLUDED.example_hanzi, example_pinyin = EXCLUDED.example_pinyin, example_meaning = EXCLUDED.example_meaning, meta = EXCLUDED.meta, sort_order = EXCLUDED.sort_order, is_deleted = 0, deleted_at = NULL;`
      );
    });

    l.grammar.forEach((g, gIdx) => {
      lines.push(
        `INSERT INTO grammars (id, lesson_id, title, formula, explanation, notes, examples, sort_order, is_deleted, deleted_at) ` +
          `VALUES (${sqlStr(g.id)}, ${sqlStr(l.id)}, ${sqlStr(g.title)}, ${sqlStr(g.formula)}, ${sqlStr(g.explanation)}, ${sqlStr(g.notes)}, ${sqlJsonb(g.examples)}, ${gIdx + 1}, 0, NULL) ` +
          `ON CONFLICT (id) DO UPDATE SET lesson_id = EXCLUDED.lesson_id, title = EXCLUDED.title, formula = EXCLUDED.formula, explanation = EXCLUDED.explanation, notes = EXCLUDED.notes, examples = EXCLUDED.examples, sort_order = EXCLUDED.sort_order, is_deleted = 0, deleted_at = NULL;`
      );
    });

    l.texts.forEach((t, tIdx) => {
      lines.push(
        `INSERT INTO texts (id, lesson_id, title, description, sort_order, is_deleted, deleted_at) ` +
          `VALUES (${sqlStr(t.id)}, ${sqlStr(l.id)}, ${sqlStr(t.title)}, ${sqlStr(t.description)}, ${tIdx + 1}, 0, NULL) ` +
          `ON CONFLICT (id) DO UPDATE SET lesson_id = EXCLUDED.lesson_id, title = EXCLUDED.title, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order, is_deleted = 0, deleted_at = NULL;`
      );
      t.sentences.forEach((s, sIdx) => {
        lines.push(
          `INSERT INTO text_sentences (id, text_id, speaker, hanzi, display_hanzi, pinyin, meaning, sort_order, is_deleted, deleted_at) ` +
            `VALUES (${sqlStr(s.id)}, ${sqlStr(t.id)}, ${sqlStr(s.speaker)}, ${sqlStr(s.hanzi)}, ${sqlStr(s.displayHanzi)}, ${sqlStr(s.pinyin)}, ${sqlStr(s.meaning)}, ${sIdx + 1}, 0, NULL) ` +
            `ON CONFLICT (id) DO UPDATE SET text_id = EXCLUDED.text_id, speaker = EXCLUDED.speaker, hanzi = EXCLUDED.hanzi, display_hanzi = EXCLUDED.display_hanzi, pinyin = EXCLUDED.pinyin, meaning = EXCLUDED.meaning, sort_order = EXCLUDED.sort_order, is_deleted = 0, deleted_at = NULL;`
        );
      });
      t.listeningQuestions.forEach((lq, qIdx) => {
        lines.push(
          `INSERT INTO quiz_questions (id, lesson_id, text_id, scope, category, audio_text, passage, question, options, correct_index, explanation, sort_order, is_deleted, deleted_at) ` +
            `VALUES (${sqlStr(lq.id)}, ${sqlStr(l.id)}, ${sqlStr(t.id)}, 'listening', 'listening', ${sqlStr(lq.audioText)}, NULL, ${sqlStr(lq.question)}, ${sqlJsonb(lq.options)}, ${lq.correctIndex}, ${sqlStr(lq.explanation)}, ${qIdx + 1}, 0, NULL) ` +
            `ON CONFLICT (id) DO UPDATE SET lesson_id = EXCLUDED.lesson_id, text_id = EXCLUDED.text_id, audio_text = EXCLUDED.audio_text, question = EXCLUDED.question, options = EXCLUDED.options, correct_index = EXCLUDED.correct_index, explanation = EXCLUDED.explanation, sort_order = EXCLUDED.sort_order, is_deleted = 0, deleted_at = NULL;`
        );
      });
    });

    l.exercises.sentenceScramble.forEach((sc, scIdx) => {
      lines.push(
        `INSERT INTO sentence_scrambles (id, lesson_id, target_hanzi, target_meaning, pinyin, tokens, unlearned_hint, sort_order, is_deleted, deleted_at) ` +
          `VALUES (${sqlStr(sc.id)}, ${sqlStr(l.id)}, ${sqlStr(sc.targetHanzi)}, ${sqlStr(sc.targetMeaning)}, ${sqlStr(sc.pinyin)}, ${sqlJsonb(sc.tokens)}, NULL, ${scIdx + 1}, 0, NULL) ` +
          `ON CONFLICT (id) DO UPDATE SET lesson_id = EXCLUDED.lesson_id, target_hanzi = EXCLUDED.target_hanzi, target_meaning = EXCLUDED.target_meaning, pinyin = EXCLUDED.pinyin, tokens = EXCLUDED.tokens, sort_order = EXCLUDED.sort_order, is_deleted = 0, deleted_at = NULL;`
      );
    });

    l.exercises.translationExercises.forEach((tr, trIdx) => {
      lines.push(
        `INSERT INTO translation_exercises (id, lesson_id, direction, prompt_text, audio_text, pinyin, expected_chinese, expected_meaning, accepted_pinyin, accepted_keywords, hint, explanation, sort_order, is_deleted, deleted_at) ` +
          `VALUES (${sqlStr(tr.id)}, ${sqlStr(l.id)}, ${sqlStr(tr.direction)}, ${sqlStr(tr.promptText)}, ${sqlStr(tr.chineseAudioText)}, ${sqlStr(tr.pinyin)}, ${sqlStr(tr.expectedChinese)}, ${sqlStr(tr.expectedMeaning)}, ${sqlStr(tr.acceptedPinyin)}, ${sqlJsonb(tr.acceptedKeywords)}, ${sqlStr(tr.hint)}, ${sqlStr(tr.explanation)}, ${trIdx + 1}, 0, NULL) ` +
          `ON CONFLICT (id) DO UPDATE SET lesson_id = EXCLUDED.lesson_id, direction = EXCLUDED.direction, prompt_text = EXCLUDED.prompt_text, audio_text = EXCLUDED.audio_text, pinyin = EXCLUDED.pinyin, expected_chinese = EXCLUDED.expected_chinese, expected_meaning = EXCLUDED.expected_meaning, accepted_pinyin = EXCLUDED.accepted_pinyin, accepted_keywords = EXCLUDED.accepted_keywords, hint = EXCLUDED.hint, explanation = EXCLUDED.explanation, sort_order = EXCLUDED.sort_order, is_deleted = 0, deleted_at = NULL;`
      );
    });

    l.exercises.expandedQuiz.forEach((eq, eqIdx) => {
      lines.push(
        `INSERT INTO quiz_questions (id, lesson_id, text_id, scope, category, audio_text, passage, question, options, correct_index, explanation, sort_order, is_deleted, deleted_at) ` +
          `VALUES (${sqlStr(eq.id)}, ${sqlStr(l.id)}, NULL, 'expanded_quiz', ${sqlStr(eq.type)}, NULL, NULL, ${sqlStr(eq.question)}, ${sqlJsonb(eq.options)}, ${eq.correctIndex}, ${sqlStr(eq.explanation)}, ${eqIdx + 1}, 0, NULL) ` +
          `ON CONFLICT (id) DO UPDATE SET lesson_id = EXCLUDED.lesson_id, category = EXCLUDED.category, question = EXCLUDED.question, options = EXCLUDED.options, correct_index = EXCLUDED.correct_index, explanation = EXCLUDED.explanation, sort_order = EXCLUDED.sort_order, is_deleted = 0, deleted_at = NULL;`
      );
    });

    l.comprehensiveTest.forEach((ct, ctIdx) => {
      lines.push(
        `INSERT INTO quiz_questions (id, lesson_id, text_id, scope, category, audio_text, passage, question, options, correct_index, explanation, sort_order, is_deleted, deleted_at) ` +
          `VALUES (${sqlStr(ct.id)}, ${sqlStr(l.id)}, NULL, 'comprehensive_test', ${sqlStr(ct.category)}, ${sqlStr(ct.audioText)}, ${sqlStr(ct.passage)}, ${sqlStr(ct.question)}, ${sqlJsonb(ct.options)}, ${ct.correctIndex}, ${sqlStr(ct.explanation)}, ${ctIdx + 1}, 0, NULL) ` +
          `ON CONFLICT (id) DO UPDATE SET lesson_id = EXCLUDED.lesson_id, category = EXCLUDED.category, audio_text = EXCLUDED.audio_text, passage = EXCLUDED.passage, question = EXCLUDED.question, options = EXCLUDED.options, correct_index = EXCLUDED.correct_index, explanation = EXCLUDED.explanation, sort_order = EXCLUDED.sort_order, is_deleted = 0, deleted_at = NULL;`
      );
    });
  });

  lines.push('');
  return lines.join('\n');
}

function main() {
  if (!fs.existsSync(INPUT_JSON)) {
    console.error(`Không tìm thấy ${INPUT_JSON}. Hãy chạy scripts/translate-word-atlas.mjs trước.`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(INPUT_JSON, 'utf8'));
  const words = Array.isArray(raw) ? raw : raw.words || [];

  const groups = buildLessonGroups(words);
  const lessons = groups.map((g) => buildLessonDetail(g, words));

  const totalVocab = lessons.reduce((s, l) => s + l.vocabulary.length, 0);
  const totalGrammar = lessons.reduce((s, l) => s + l.grammar.length, 0);
  const totalScrambles = lessons.reduce((s, l) => s + l.exercises.sentenceScramble.length, 0);
  const totalTrans = lessons.reduce((s, l) => s + l.exercises.translationExercises.length, 0);
  const totalQuiz = lessons.reduce((s, l) => s + l.comprehensiveTest.length, 0);

  fs.mkdirSync(path.dirname(OUT_MEMORY_JSON), { recursive: true });
  fs.writeFileSync(OUT_MEMORY_JSON, JSON.stringify(lessons, null, 2), 'utf8');

  fs.mkdirSync(path.dirname(OUT_LIQUIBASE_SQL), { recursive: true });
  fs.writeFileSync(OUT_LIQUIBASE_SQL, generateSql(lessons), 'utf8');

  console.log(
    `[EN A1 Seed] Generated ${lessons.length} lessons | ${totalVocab} vocab | ${totalGrammar} grammar | ${totalScrambles} scrambles | ${totalTrans} translations | ${totalQuiz} exam questions`
  );
  console.log(`  -> Memory JSON: ${OUT_MEMORY_JSON}`);
  console.log(`  -> Liquibase SQL: ${OUT_LIQUIBASE_SQL}`);
}

main();
