-- ============================================================================
-- 汉语学堂 (Chinese Study Web App) - PostgreSQL Database Schema
-- Tương thích 100% với PostgreSQL Local (14+) và Supabase PostgreSQL
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Người dùng (Users)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2. Buổi học / Bài học (Lessons)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  hsk_level TEXT NOT NULL DEFAULT 'HSK 1',
  unit TEXT,
  description TEXT,
  date_added DATE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lessons_sort ON lessons (sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_lessons_owner ON lessons (owner_id);

-- ----------------------------------------------------------------------------
-- 3. Từ vựng & Bộ thủ (Vocabularies)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vocabularies (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  hanzi TEXT NOT NULL,
  pinyin TEXT NOT NULL,
  sino_vietnamese TEXT,
  meaning TEXT NOT NULL,
  word_type TEXT,
  radical TEXT,
  breakdown TEXT,
  mnemonic TEXT,
  example_hanzi TEXT,
  example_pinyin TEXT,
  example_meaning TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vocabularies_lesson ON vocabularies (lesson_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_vocabularies_hanzi ON vocabularies (hanzi);

-- ----------------------------------------------------------------------------
-- 4. Ngữ pháp trọng tâm (Grammars)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grammars (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  formula TEXT,
  explanation TEXT,
  notes TEXT,
  examples JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grammars_lesson ON grammars (lesson_id, sort_order);

-- ----------------------------------------------------------------------------
-- 5. Bài khoá & Hội thoại (Texts & Text Sentences)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS texts (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_texts_lesson ON texts (lesson_id, sort_order);

CREATE TABLE IF NOT EXISTS text_sentences (
  id TEXT PRIMARY KEY,
  text_id TEXT NOT NULL REFERENCES texts(id) ON DELETE CASCADE,
  speaker TEXT,
  hanzi TEXT NOT NULL,
  display_hanzi TEXT,
  pinyin TEXT,
  meaning TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_text_sentences_text ON text_sentences (text_id, sort_order);

-- ----------------------------------------------------------------------------
-- 6. Bài tập sắp xếp câu (Sentence Scrambles)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sentence_scrambles (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  target_hanzi TEXT NOT NULL,
  target_meaning TEXT NOT NULL,
  pinyin TEXT,
  tokens JSONB NOT NULL DEFAULT '[]'::jsonb,
  unlearned_hint TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_scrambles_lesson ON sentence_scrambles (lesson_id, sort_order);

-- ----------------------------------------------------------------------------
-- 7. Bài tập dịch song ngữ (Translation Exercises)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS translation_exercises (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('vi_to_zh', 'zh_to_vi')),
  prompt_text TEXT NOT NULL,
  audio_text TEXT,
  pinyin TEXT,
  expected_chinese TEXT,
  expected_meaning TEXT,
  accepted_pinyin TEXT,
  accepted_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  hint TEXT,
  explanation TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_translations_lesson ON translation_exercises (lesson_id, direction, sort_order);

-- ----------------------------------------------------------------------------
-- 8. Câu hỏi trắc nghiệm (Listening, Expanded Quiz, Comprehensive Test)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  text_id TEXT REFERENCES texts(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('listening', 'expanded_quiz', 'comprehensive_test')),
  category TEXT,
  audio_text TEXT,
  passage TEXT,
  question TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  correct_index INTEGER NOT NULL CHECK (correct_index >= 0),
  explanation TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_quiz_lesson_scope ON quiz_questions (lesson_id, scope, sort_order);
CREATE INDEX IF NOT EXISTS idx_quiz_text ON quiz_questions (text_id);

-- ----------------------------------------------------------------------------
-- 9. Từ vựng được đánh dấu / gắn cờ (User Marked Vocab)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_marked_vocab (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocab_id TEXT NOT NULL REFERENCES vocabularies(id) ON DELETE CASCADE,
  note TEXT,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_marked_vocab UNIQUE (user_id, vocab_id)
);

CREATE INDEX IF NOT EXISTS idx_marked_vocab_user ON user_marked_vocab (user_id, marked_at DESC);

-- ----------------------------------------------------------------------------
-- 10. Lịch sử làm bài kiểm tra (Test Attempts)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS test_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  total_questions INTEGER NOT NULL CHECK (total_questions > 0),
  correct_count INTEGER NOT NULL CHECK (correct_count >= 0),
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attempts_user_lesson ON test_attempts (user_id, lesson_id, submitted_at DESC);
