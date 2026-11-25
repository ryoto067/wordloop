-- round_tests / sentence_words に複合キーを追加（SQLite はテーブル再作成が必要）
CREATE TABLE round_tests_new (
  round_id TEXT NOT NULL REFERENCES study_rounds(id) ON DELETE CASCADE,
  word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  result TEXT NOT NULL,
  PRIMARY KEY (round_id, word_id)
);
INSERT OR IGNORE INTO round_tests_new SELECT round_id, word_id, result FROM round_tests;
DROP TABLE round_tests;
ALTER TABLE round_tests_new RENAME TO round_tests;

CREATE TABLE sentence_words_new (
  sentence_id TEXT NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  PRIMARY KEY (sentence_id, word_id)
);
INSERT OR IGNORE INTO sentence_words_new SELECT sentence_id, word_id FROM sentence_words;
DROP TABLE sentence_words;
ALTER TABLE sentence_words_new RENAME TO sentence_words;
