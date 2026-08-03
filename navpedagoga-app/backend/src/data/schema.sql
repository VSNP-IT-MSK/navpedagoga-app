-- НавигаторПедагога — схема БД (PostgreSQL).
-- Совместима с бесплатными хостингами Postgres: Neon, Supabase, Render Postgres (90 дней).
-- Рекомендация: Neon или Supabase — их бесплатный тариф не имеет срока истечения
-- (в отличие от Render Postgres Free, который удаляется через 90 дней).

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- для gen_random_uuid()

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'mentor', 'user')),
  subject TEXT,
  school TEXT,
  region TEXT,
  years_experience INTEGER DEFAULT 0,
  current_stage INTEGER DEFAULT 1, -- см. ALGO_STAGES: 1..6 по алгоритму из диссертации (гл. 3.2)
  mentor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  mentor_status TEXT DEFAULT NULL CHECK (mentor_status IN (NULL, 'pending', 'confirmed')), -- заявка на пару наставник—наставляемый
  approved_by_admin BOOLEAN NOT NULL DEFAULT FALSE, -- регистрация подтверждается администратором (ТЗ п.4.3)
  scores JSONB NOT NULL DEFAULT '{"subject":0,"pedagogy":0,"method":0,"digital":0,"communication":0,"personal":0}',
  avatar_color TEXT DEFAULT 'purple',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_mentor_id ON users(mentor_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Банк реальных диагностических вопросов (Раздел I-V диссертации Поляковой, шкала 1-3:
-- 1 = испытываю затруднения, 2 = получается, но нужно совершенствование, 3 = получается хорошо).
CREATE TABLE IF NOT EXISTS diagnostic_items (
  id SERIAL PRIMARY KEY,
  competency_id TEXT NOT NULL, -- subject|pedagogy|method|digital|communication|personal
  text TEXT NOT NULL,
  weight SMALLINT NOT NULL DEFAULT 1, -- весовая категория пункта (гл. 4.3 ТЗ: баллы дефицита = сумма весов мероприятий)
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS diagnostic_answers (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES diagnostic_items(id) ON DELETE CASCADE,
  score SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 3),
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_diag_answers_user ON diagnostic_answers(user_id);

-- Каталог мероприятий: и вручную добавленные (наставник/админ), и найденные ИИ (закэшированы в roadmaps.raw).
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  event_date TEXT,
  event_time TEXT,
  type TEXT CHECK (type IN ('online', 'offline')),
  area TEXT, -- competency id
  region TEXT DEFAULT 'Все регионы',
  url TEXT,
  source TEXT,
  weight SMALLINT NOT NULL DEFAULT 1, -- баллы закрытия дефицита (ТЗ 4.3: 1 балл = изучение, 10 баллов = курс ПК)
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- sha256(title|region|event_date) в нижнем регистре — не для защиты данных, а для дедупликации:
  -- ИИ ищет мероприятия по региону заново на каждом обновлении дорожной карты (см. cron/refresh-roadmaps),
  -- и без хеша один и тот же вебинар попадал бы в каталог повторно при каждом поиске.
  content_hash TEXT UNIQUE,
  discovered_by_ai BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_area ON events(area);
CREATE INDEX IF NOT EXISTS idx_events_region ON events(region);

CREATE TABLE IF NOT EXISTS event_completions (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reflection TEXT DEFAULT '',
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

-- Дорожная карта хранится как JSONB-снимок (структура задаётся ИИ или офлайн-генератором) +
-- отдельная таблица прогресса по мероприятиям для отчётов/оценок (алгоритм из гл. 3.3, п.8-9).
CREATE TABLE IF NOT EXISTS roadmaps (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  region TEXT,
  summary TEXT,
  priorities JSONB NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL DEFAULT 'offline', -- offline|live
  raw_text TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roadmap_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  competency_id TEXT NOT NULL,
  event_title TEXT NOT NULL,
  event_url TEXT,
  weight SMALLINT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reported', 'rated')),
  report_text TEXT,               -- «Что узнал нового? Что будет использовать в работе?» (гл. 3.2)
  usefulness_rating SMALLINT CHECK (usefulness_rating BETWEEN 1 AND 5), -- наставляемый оценивает мероприятие
  mentor_rating SMALLINT CHECK (mentor_rating BETWEEN 1 AND 5),          -- наставник оценивает отчёт
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_roadmap_progress_user ON roadmap_progress(user_id);

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  category TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);

-- Чат наставник—наставляемый (текстовый; видео-звонки не входят в бесплатный MVP — см. README).
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(from_user_id, to_user_id);

-- Переписка с цифровым ИИ-наставником (отдельно от чата с человеком-наставником).
CREATE TABLE IF NOT EXISTS ai_chats (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'ai')),
  text TEXT NOT NULL,
  chips JSONB,
  action TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_chats_user ON ai_chats(user_id, created_at);

CREATE TABLE IF NOT EXISTS ai_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL DEFAULT 0,
  awaiting_followup BOOLEAN NOT NULL DEFAULT FALSE,
  answers JSONB NOT NULL DEFAULT '{}',
  notes JSONB NOT NULL DEFAULT '{}',
  done BOOLEAN NOT NULL DEFAULT FALSE
);

-- ===================== ИИ-функция: тест после мероприятия =====================
-- Вопросы генерируются один раз на мероприятие (не на пользователя) и кэшируются в БД —
-- это дорогой grounded-запрос к Gemini, незачем повторять его для каждого педагога.
CREATE TABLE IF NOT EXISTS event_quizzes (
  event_id UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  questions JSONB NOT NULL, -- [{ q, options:[4], correctIndex, explain }]
  sources JSONB,
  mode TEXT NOT NULL DEFAULT 'offline',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers JSONB NOT NULL,
  score SMALLINT NOT NULL,
  total SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON quiz_attempts(user_id);

-- ===================== 5 новых ИИ-функций =====================

-- 1) Ежедневный ИИ-дайджест "что дальше" на дашборде (кэш на 24ч, чтобы не жечь квоту).
CREATE TABLE IF NOT EXISTS ai_digests (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) ИИ-ревью отчёта наставляемого до отправки наставнику — только логируется по желанию,
-- отдельного хранения не требует (генерируется on-the-fly в /api/ai/roadmap/progress/review).

-- 3) Методические рекомендации Минпросвещения по слабой компетенции — кэш общий (не per-user),
-- ключ competency+subject, чтобы разные педагоги с тем же предметом переиспользовали ответ.
CREATE TABLE IF NOT EXISTS methodical_tips (
  competency_id TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  sources JSONB,
  mode TEXT NOT NULL DEFAULT 'offline',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (competency_id, subject)
);

-- 4) Автосборка цифрового портфолио (этап 6 алгоритма из диссертации).
CREATE TABLE IF NOT EXISTS portfolios (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5) Умные напоминания о неактивности — не требуют своей таблицы, считаются "на лету"
-- по MAX(created_at) в ai_chats/roadmap_progress/event_completions (см. routes/ai.js).

-- ===================== LMS: группы, задания, конструктор тестов, геймификация =====================

-- Наставник объединяет своих подтверждённых подопечных в группы (аналог курса/когорты в Moodle).
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_groups_mentor ON groups(mentor_id);

CREATE TABLE IF NOT EXISTS group_members (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- Конструктор тестов: наставник вручную собирает тест из вопросов с 4 вариантами ответа.
-- Отдельно от event_quizzes (те генерирует ИИ по мероприятию) — этот банк собирает человек.
CREATE TABLE IF NOT EXISTS custom_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS custom_test_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES custom_tests(id) ON DELETE CASCADE,
  q TEXT NOT NULL,
  options JSONB NOT NULL, -- ["...","...","...","..."]
  correct_index SMALLINT NOT NULL,
  points SMALLINT NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_custom_test_questions_test ON custom_test_questions(test_id);

-- Задания: свободная задача (текстовый ответ) или привязанный тест из конструктора.
-- Назначаются либо на группу целиком, либо на конкретных педагогов — цели лежат в assignment_targets.
CREATE TABLE IF NOT EXISTS assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  test_id UUID REFERENCES custom_tests(id) ON DELETE SET NULL, -- NULL = свободное задание с текстовым ответом
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  due_date TIMESTAMPTZ,
  coin_reward SMALLINT NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assignment_targets (
  assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'submitted', 'graded')),
  answer_text TEXT, -- ответ на свободное задание
  test_answers JSONB, -- ответы на тест, если assignment.test_id задан
  score SMALLINT, -- авто (тест) или вручную (свободное задание)
  total SMALLINT,
  mentor_feedback TEXT,
  submitted_at TIMESTAMPTZ,
  graded_at TIMESTAMPTZ,
  PRIMARY KEY (assignment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_assignment_targets_user ON assignment_targets(user_id);

-- Виртуальное поощрение: монеты + очки опыта (прогресс-бар/уровень). users.coins и users.xp —
-- текущий баланс/итог для быстрого чтения на дашборде; coin_transactions — журнал начислений.
ALTER TABLE users ADD COLUMN IF NOT EXISTS coins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS coin_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coin_tx_user ON coin_transactions(user_id, created_at);
