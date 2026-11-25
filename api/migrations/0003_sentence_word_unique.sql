-- 1 つの語は高々 1 つの文章に属する（二重保存の防止）
CREATE UNIQUE INDEX idx_sentence_words_word ON sentence_words(word_id);
