-- ============================================================================
-- 汉语学堂 (Chinese Study Web App) - PostgreSQL Database Schema
-- Tương thích 100% với PostgreSQL Local (14+) và Supabase PostgreSQL
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 0. Danh mục ngôn ngữ (Languages)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS languages (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  native_name TEXT NOT NULL,
  description TEXT,
  accent_theme TEXT NOT NULL DEFAULT 'red',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO languages (code, name, native_name, description, accent_theme, is_active, sort_order)
VALUES
  ('zh', 'Tiếng Trung', '汉语 · HSK', 'Lộ trình 26 bài HSK chuẩn kèm Hán Việt, bộ thủ, tập viết nét và gia sư AI.', 'red', TRUE, 1),
  ('en', 'Tiếng Anh', 'English · CEFR / IELTS', 'Lộ trình từ vựng Tiếng Anh CEFR A1–C2 (Word Atlas) kèm hình minh họa, audio UK/US và gia sư AI.', 'indigo', TRUE, 2)
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1. Người dùng (Users)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  avatar_url TEXT,
  cover_url TEXT,
  last_language_code TEXT NOT NULL DEFAULT 'zh' REFERENCES languages(code),
  is_deleted SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2. Buổi học / Bài học (Lessons)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  language_code TEXT NOT NULL DEFAULT 'zh' REFERENCES languages(code),
  title TEXT NOT NULL,
  hsk_level TEXT NOT NULL DEFAULT 'HSK 1',
  unit TEXT,
  description TEXT,
  date_added DATE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  is_deleted SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lessons_sort ON lessons (sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_lessons_owner ON lessons (owner_id);
CREATE INDEX IF NOT EXISTS idx_lessons_active ON lessons (is_system DESC, sort_order ASC, created_at ASC) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_lessons_lang_active ON lessons (language_code, is_system DESC, sort_order ASC, created_at ASC) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_lessons_purge ON lessons (deleted_at) WHERE is_deleted = 1;

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
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  search_tsv TSVECTOR GENERATED ALWAYS AS (
    setweight(
      to_tsvector(
        'simple',
        translate(
          lower(
            coalesce(hanzi, '') || ' ' ||
            coalesce(pinyin, '') || ' ' ||
            coalesce(sino_vietnamese, '') || ' ' ||
            coalesce(meaning, '')
          ),
          'áàảãạăắằẳẵặâấầẩẫậāǎéèẻẽẹêếềểễệēěíìỉĩịīǐóòỏõọôốồổỗộơớờởỡợōǒúùủũụưứừửữựūǔǖǘǚǜüýỳỷỹỵđ',
          'aaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeiiiiiiiooooooooooooooooooouuuuuuuuuuuuuuuuuuyyyyyd'
        )
      ),
      'A'
    ) ||
    setweight(
      to_tsvector(
        'simple',
        translate(
          lower(coalesce(radical, '')),
          'áàảãạăắằẳẵặâấầẩẫậāǎéèẻẽẹêếềểễệēěíìỉĩịīǐóòỏõọôốồổỗộơớờởỡợōǒúùủũụưứừửữựūǔǖǘǚǜüýỳỷỹỵđ',
          'aaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeiiiiiiiooooooooooooooooooouuuuuuuuuuuuuuuuuuyyyyyd'
        )
      ),
      'D'
    )
  ) STORED,
  is_deleted SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vocabularies_lesson ON vocabularies (lesson_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_vocabularies_hanzi ON vocabularies (hanzi);
CREATE INDEX IF NOT EXISTS idx_vocabularies_active ON vocabularies (lesson_id, sort_order ASC) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_vocabularies_search_tsv ON vocabularies USING GIN (search_tsv) WHERE is_deleted = 0;

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
  is_deleted SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
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
  is_deleted SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
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
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_deleted SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ
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
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_deleted SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scrambles_lesson ON sentence_scrambles (lesson_id, sort_order);

-- ----------------------------------------------------------------------------
-- 7. Bài tập dịch song ngữ (Translation Exercises)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS translation_exercises (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('vi_to_zh', 'zh_to_vi', 'vi_to_en', 'en_to_vi')),
  prompt_text TEXT NOT NULL,
  audio_text TEXT,
  pinyin TEXT,
  expected_chinese TEXT,
  expected_meaning TEXT,
  accepted_pinyin TEXT,
  accepted_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  hint TEXT,
  explanation TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_deleted SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ
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
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_deleted SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_quiz_lesson_scope ON quiz_questions (lesson_id, scope, sort_order);
CREATE INDEX IF NOT EXISTS idx_quiz_text ON quiz_questions (text_id);
CREATE INDEX IF NOT EXISTS idx_quiz_comprehensive_cat ON quiz_questions (category, lesson_id) WHERE scope = 'comprehensive_test' AND is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_quiz_lesson_active ON quiz_questions (lesson_id, scope, sort_order ASC) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_quiz_purge ON quiz_questions (deleted_at) WHERE is_deleted = 1;

-- ----------------------------------------------------------------------------
-- 9. Từ vựng được đánh dấu / gắn cờ (User Marked Vocab)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_marked_vocab (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocab_id TEXT NOT NULL REFERENCES vocabularies(id) ON DELETE CASCADE,
  note TEXT,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_user_marked_vocab UNIQUE (user_id, vocab_id)
);

CREATE INDEX IF NOT EXISTS idx_marked_vocab_user ON user_marked_vocab (user_id, marked_at DESC);
CREATE INDEX IF NOT EXISTS idx_marked_vocab_active ON user_marked_vocab (user_id, marked_at DESC) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_marked_vocab_purge ON user_marked_vocab (deleted_at) WHERE is_deleted = 1;

-- ----------------------------------------------------------------------------
-- 10. Lịch sử làm bài kiểm tra (Test Attempts)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS test_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT REFERENCES lessons(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL DEFAULT 'zh' REFERENCES languages(code),
  exam_title TEXT,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  total_questions INTEGER NOT NULL CHECK (total_questions > 0),
  correct_count INTEGER NOT NULL CHECK (correct_count >= 0),
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_attempts_user_lesson ON test_attempts (user_id, lesson_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_user_submitted ON test_attempts (user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_active ON test_attempts (user_id, lesson_id, submitted_at DESC) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_attempts_leaderboard ON test_attempts (lesson_id, score DESC, correct_count DESC, duration_seconds ASC, submitted_at DESC) WHERE is_deleted = 0;

-- ----------------------------------------------------------------------------
-- 11. Hệ thống Phân quyền RBAC (Roles, Permissions, Role-Permissions, User Overrides)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  active_flg BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('MENU', 'ACTION')),
  parent_code TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active_flg BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  is_excluded BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_permissions_sort ON permissions (sort_order, code);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions (role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_active ON role_permissions (role_id, permission_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions (user_id, is_excluded);
CREATE INDEX IF NOT EXISTS idx_user_permissions_active ON user_permissions (user_id, is_excluded) WHERE is_deleted = 0;

CREATE OR REPLACE FUNCTION fn_get_user_permissions(p_user_id UUID)
RETURNS TABLE (
  code TEXT
)
LANGUAGE sql
STABLE
AS $$
WITH target_user AS (
  SELECT id, role
  FROM users
  WHERE id = p_user_id
),
admin_perms AS (
  SELECT p.code, p.sort_order
  FROM permissions p
  CROSS JOIN target_user u
  WHERE u.role = 'admin'
    AND p.active_flg = TRUE
),
role_perms AS (
  SELECT p.id AS permission_id, p.code, p.sort_order
  FROM target_user u
  JOIN roles r ON r.code = u.role AND r.active_flg = TRUE
  JOIN role_permissions rp ON rp.role_id = r.id
  JOIN permissions p ON p.id = rp.permission_id AND p.active_flg = TRUE
  WHERE u.role <> 'admin'
),
added_perms AS (
  SELECT p.id AS permission_id, p.code, p.sort_order
  FROM target_user u
  JOIN user_permissions up ON up.user_id = u.id AND up.is_excluded = FALSE
  JOIN permissions p ON p.id = up.permission_id AND p.active_flg = TRUE
  WHERE u.role <> 'admin'
),
excluded_perms AS (
  SELECT up.permission_id
  FROM target_user u
  JOIN user_permissions up ON up.user_id = u.id AND up.is_excluded = TRUE
  WHERE u.role <> 'admin'
),
combined_user_perms AS (
  SELECT DISTINCT permission_id, code, sort_order
  FROM (
    SELECT permission_id, code, sort_order FROM role_perms
    UNION ALL
    SELECT permission_id, code, sort_order FROM added_perms
  ) raw_perms
  WHERE permission_id NOT IN (SELECT permission_id FROM excluded_perms)
)
SELECT code
FROM (
  SELECT code, sort_order FROM admin_perms
  UNION ALL
  SELECT code, sort_order FROM combined_user_perms
) final_perms
ORDER BY sort_order ASC, code ASC;
$$;

INSERT INTO roles (id, code, name, description, is_system, active_flg)
VALUES
  ('admin', 'admin', 'Quản trị viên', 'Toàn quyền quản trị hệ thống, bài học HSK và phân quyền tài khoản (Super Admin)', TRUE, TRUE),
  ('user', 'user', 'Học viên', 'Học tập, làm bài kiểm tra, đánh dấu từ vựng và quản lý buổi học tự tạo', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (id, code, name, type, parent_code, description, sort_order, active_flg)
VALUES
  ('MENU_SYSTEM', 'MENU_SYSTEM', 'Quản lý bài học hệ thống', 'MENU', NULL, 'Nhóm quyền thao tác với các bài học HSK chuẩn hệ thống', 10, TRUE),
  ('LESSON_SYSTEM_CREATE', 'LESSON_SYSTEM_CREATE', 'Tạo bài học hệ thống', 'ACTION', 'MENU_SYSTEM', 'Cho phép tạo mới bài học hệ thống (is_system = true)', 11, TRUE),
  ('LESSON_SYSTEM_EDIT', 'LESSON_SYSTEM_EDIT', 'Sửa bài học hệ thống', 'ACTION', 'MENU_SYSTEM', 'Cho phép chỉnh sửa nội dung bài học hệ thống', 12, TRUE),
  ('LESSON_SYSTEM_DELETE', 'LESSON_SYSTEM_DELETE', 'Xoá bài học hệ thống', 'ACTION', 'MENU_SYSTEM', 'Cho phép xoá bài học hệ thống', 13, TRUE),
  ('MENU_LEARNING', 'MENU_LEARNING', 'Học tập & Bài cá nhân', 'MENU', NULL, 'Nhóm quyền học tập cơ bản của học viên', 20, TRUE),
  ('LESSON_CUSTOM_CRUD', 'LESSON_CUSTOM_CRUD', 'Quản lý buổi học tự tạo', 'ACTION', 'MENU_LEARNING', 'Tạo, sửa và xoá buổi học cá nhân do chính mình sở hữu', 21, TRUE),
  ('VOCAB_BOOKMARK', 'VOCAB_BOOKMARK', 'Đánh dấu từ vựng', 'ACTION', 'MENU_LEARNING', 'Lưu và đồng bộ từ vựng cần ôn tập vào hồ sơ cá nhân', 22, TRUE),
  ('EXAM_TAKE', 'EXAM_TAKE', 'Làm bài kiểm tra & lưu điểm', 'ACTION', 'MENU_LEARNING', 'Nộp bài kiểm tra và lưu lịch sử điểm số', 23, TRUE),
  ('AI_ASSISTANT_USE', 'AI_ASSISTANT_USE', 'Trợ lý AI & Từ điển Trung-Việt', 'ACTION', 'MENU_LEARNING', 'Sử dụng Từ điển dịch AI Trung-Việt và chat hỏi đáp với Gia sư AI HSK', 24, TRUE),
  ('MENU_ADMIN', 'MENU_ADMIN', 'Quản trị hệ thống', 'MENU', NULL, 'Truy cập màn hình Quản trị & Phân quyền', 30, TRUE),
  ('USER_MANAGE', 'USER_MANAGE', 'Quản lý người dùng', 'ACTION', 'MENU_ADMIN', 'Xem danh sách tài khoản và thay đổi vai trò user/admin', 31, TRUE),
  ('ROLE_MANAGE', 'ROLE_MANAGE', 'Quản lý phân quyền', 'ACTION', 'MENU_ADMIN', 'Cấu hình quyền cho vai trò và tinh chỉnh cấp thêm / hạn chế từng user', 32, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'admin', p.id FROM permissions p
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
VALUES
  ('user', 'MENU_LEARNING'),
  ('user', 'LESSON_CUSTOM_CRUD'),
  ('user', 'VOCAB_BOOKMARK'),
  ('user', 'EXAM_TAKE'),
  ('user', 'AI_ASSISTANT_USE')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 12. Bộ nhớ đệm Từ điển & Dịch AI (Translation Cache)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS translation_cache (
  cache_key TEXT PRIMARY KEY,
  language_code TEXT NOT NULL DEFAULT 'zh',
  direction TEXT NOT NULL CHECK (direction IN ('auto', 'zh_vi', 'vi_zh', 'en_vi', 'vi_en')),
  query_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ai',
  model TEXT,
  payload JSONB NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_translation_cache_updated
  ON translation_cache (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_translation_cache_lang
  ON translation_cache (language_code, updated_at DESC);

-- ----------------------------------------------------------------------------
-- 13. Bảng xếp hạng trò chơi (Game Scores)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL DEFAULT 'zh' REFERENCES languages(code),
  game_mode TEXT NOT NULL CHECK (game_mode IN ('tri_match', 'scramble', 'translation', 'expanded_quiz')),
  score INTEGER NOT NULL CHECK (score >= 0),
  max_score INTEGER CHECK (max_score IS NULL OR max_score >= 0),
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted SMALLINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_game_scores_leaderboard
  ON game_scores (lesson_id, game_mode, score DESC, duration_seconds ASC, played_at DESC)
  WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_game_scores_global_mode
  ON game_scores (game_mode, score DESC, duration_seconds ASC, played_at DESC)
  WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_game_scores_lang_mode
  ON game_scores (language_code, game_mode, score DESC, duration_seconds ASC, played_at DESC)
  WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_game_scores_user
  ON game_scores (user_id, played_at DESC)
  WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_game_scores_purge
  ON game_scores (deleted_at)
  WHERE is_deleted = 1;

-- ----------------------------------------------------------------------------
-- 14. Bộ nhớ đệm AI chấm đáp án trò chơi (Game Grading Cache)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_grading_cache (
  cache_key TEXT PRIMARY KEY,
  language_code TEXT NOT NULL DEFAULT 'zh',
  game_mode TEXT NOT NULL CHECK (game_mode IN ('scramble', 'translation')),
  direction TEXT CHECK (direction IS NULL OR direction IN ('vi_to_zh', 'zh_to_vi', 'vi_to_en', 'en_to_vi')),
  exercise_id TEXT NOT NULL,
  user_answer TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  feedback TEXT NOT NULL,
  suggestion TEXT,
  model TEXT,
  hit_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_grading_cache_exercise
  ON game_grading_cache (exercise_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_game_grading_cache_updated
  ON game_grading_cache (updated_at DESC);
