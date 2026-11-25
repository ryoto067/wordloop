import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, OfflineError, api } from "./api";
import { answerKey, answeredToday, markAnswered, unmarkAnswered, type CardKind } from "./answered";
import { REVIEWS_TODAY_KEY, useMe } from "./MeContext";
import { enqueue, flush, list, removeFromQueue } from "./offlineQueue";

export type ReviewWord = { id: string; english: string; japanese: string; stage: number; stageDays: number };
export type ReviewSentence = {
  id: string;
  englishMarked: string;
  japanese: string;
  mode: "cloze" | "recall";
  stage: number;
};
type TodayResponse = { words: ReviewWord[]; sentences: ReviewSentence[] };
type Last<T> = { card: T; clientId: string };

function readCachedToday(): TodayResponse | null {
  try {
    const raw = localStorage.getItem(REVIEWS_TODAY_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<TodayResponse> | null) : null;
    return v && Array.isArray(v.words) ? { words: v.words, sentences: Array.isArray(v.sentences) ? v.sentences : [] } : null;
  } catch {
    return null;
  }
}

// 今日すでに答えたカードの key（送信済み＋送信待ち）
async function answeredKeys(): Promise<Set<string>> {
  const keys = answeredToday();
  for (const q of await list()) {
    const b = q.body as { kind?: string; id?: string } | null;
    if (q.kind === "reviews" && (b?.kind === "word" || b?.kind === "sentence") && typeof b.id === "string") {
      keys.add(answerKey(b.kind, b.id));
    }
  }
  return keys;
}

type CardOf<K extends CardKind> = K extends "word" ? ReviewWord : ReviewSentence;

// 単語・文章の復習で共通の流れ（読み込み・オフライン用キャッシュ・回答のキュー・1つ戻す）
export function useReviewSession<K extends CardKind>(kind: K) {
  type Card = CardOf<K>;
  const { refresh } = useMe();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(0);
  const [last, setLast] = useState<Last<Card> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [streak, setStreak] = useState<number | null>(null);
  const pending = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let alive = true;
    (async () => {
      let today: TodayResponse;
      try {
        today = await api<TodayResponse>("/api/reviews/today");
        try {
          localStorage.setItem(REVIEWS_TODAY_KEY, JSON.stringify(today));
        } catch {
          // 保存できなくても動作には影響しない
        }
      } catch (err) {
        if (!(err instanceof OfflineError)) {
          if (alive) setError("読み込めませんでした");
          return;
        }
        const cached = readCachedToday();
        if (!cached) {
          if (alive) setError("オフラインで、保存された復習がありません。つながってからもう一度開いてください");
          return;
        }
        today = cached;
      }
      const done = await answeredKeys();
      if (!alive) return;
      const all = (kind === "word" ? today.words : (today.sentences ?? [])) as Card[];
      const rest = all.filter((c) => !done.has(answerKey(kind, c.id)));
      setCards(rest);
      setTotal(rest.length);
    })().catch(() => {
      if (alive) setError("読み込めませんでした");
    });
    return () => {
      alive = false;
    };
  }, [kind]);

  const finished = cards !== null && index >= cards.length;
  useEffect(() => {
    if (finished) refresh();
  }, [finished, refresh]);

  const send = useCallback(() => {
    pending.current = flush()
      .then((r) => {
        if (typeof r.streak === "number") setStreak(r.streak);
      })
      .catch(() => {});
  }, []);

  const busy = useRef(false);
  const answer = async (card: Card, result: "remembered" | "forgot") => {
    if (busy.current) return;
    busy.current = true;
    const clientId = crypto.randomUUID();
    setMessage(null);
    try {
      await enqueue({
        id: clientId,
        path: "/api/reviews",
        kind: "reviews",
        body: { clientId, kind, id: card.id, result, reviewedAt: new Date().toISOString() },
      });
    } catch {
      setMessage("保存できませんでした。もう一度お試しください");
      return;
    } finally {
      busy.current = false;
    }
    markAnswered(card.id, kind);
    setLast({ card, clientId });
    setIndex((i) => i + 1);
    send();
  };

  const undo = async () => {
    if (!last) return;
    setMessage(null);
    await pending.current; // 送信中のものがあれば、結果を待ってから判断する
    let ok = await removeFromQueue(last.clientId);
    if (!ok) {
      try {
        await api("/api/reviews/undo", { method: "POST", body: JSON.stringify({ clientId: last.clientId }) });
        ok = true;
      } catch (err) {
        if (!(err instanceof ApiError || err instanceof OfflineError)) throw err;
      }
    }
    if (!ok) {
      setMessage("取り消せませんでした");
      return;
    }
    unmarkAnswered(last.card.id, kind);
    setIndex((i) => i - 1);
    setLast(null);
  };

  return { cards, total, index, last, error, message, streak, finished, answer, undo };
}
