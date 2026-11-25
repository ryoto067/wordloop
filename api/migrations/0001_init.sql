-- WordLoop 初期スキーマ（日付列は 'YYYY-MM-DD' の TEXT）
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  word_intervals TEXT NOT NULL DEFAULT '[1,3,7,14,30]',
  sentence_intervals TEXT NOT NULL DEFAULT '[3,7,14,30,60]',
  font_scale REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE words (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  english TEXT NOT NULL,            -- 保存時に trim().toLowerCase()
  japanese TEXT NOT NULL,
  stage INTEGER NOT NULL DEFAULT 0,
  anchor_on TEXT NOT NULL,
  next_review_on TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- reviewing / waiting_sentence / in_sentence
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, english)
);
CREATE INDEX idx_words_due ON words(user_id, status, next_review_on);

CREATE TABLE word_sets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE set_words (
  set_id TEXT NOT NULL REFERENCES word_sets(id) ON DELETE CASCADE,
  word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  PRIMARY KEY (set_id, word_id)
);

CREATE TABLE study_rounds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id TEXT NOT NULL REFERENCES word_sets(id) ON DELETE CASCADE,
  round_no INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE round_tests (
  round_id TEXT NOT NULL REFERENCES study_rounds(id) ON DELETE CASCADE,
  word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  result TEXT NOT NULL
);

CREATE TABLE word_reviews (
  id TEXT PRIMARY KEY,
  word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL UNIQUE,
  reviewed_on TEXT NOT NULL,
  result TEXT NOT NULL,
  prev_stage INTEGER NOT NULL,
  prev_anchor_on TEXT NOT NULL,
  prev_next_review_on TEXT,
  prev_status TEXT NOT NULL
);

CREATE TABLE sentences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  english_marked TEXT NOT NULL,
  japanese_text TEXT NOT NULL,
  stage INTEGER NOT NULL DEFAULT 0,
  anchor_on TEXT NOT NULL,
  next_review_on TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active / mastered
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sentences_due ON sentences(user_id, status, next_review_on);

CREATE TABLE sentence_words (
  sentence_id TEXT NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE
);

CREATE TABLE sentence_reviews (
  id TEXT PRIMARY KEY,
  sentence_id TEXT NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL UNIQUE,
  reviewed_on TEXT NOT NULL,
  mode TEXT NOT NULL,               -- cloze / recall
  result TEXT NOT NULL,
  prev_stage INTEGER NOT NULL,
  prev_anchor_on TEXT NOT NULL,
  prev_next_review_on TEXT,
  prev_status TEXT NOT NULL
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE notify_times (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hhmm TEXT NOT NULL,
  kind TEXT NOT NULL                -- morning / evening / custom
);

CREATE TABLE daily_activity (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  did_round INTEGER NOT NULL DEFAULT 0,
  reviews_done INTEGER NOT NULL DEFAULT 0,
  cleared_all INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE ai_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
