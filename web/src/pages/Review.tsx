import { useCallback, useEffect, useRef, useState } from "react";
import { SlantLink } from "../components/SlantButton";
import { FlashCard } from "../components/FlashCard";
import { ApiError, OfflineError, api } from "../lib/api";
import { REVIEWS_TODAY_KEY, useMe } from "../lib/MeContext";
import { enqueue, flush, list, removeFromQueue } from "../lib/offlineQueue";

export type ReviewWord = { id: string; english: string; japanese: string; stage: number; stageDays: number };
type TodayResponse = { words: ReviewWord[]; sentences: unknown[] };
type Last = { card: ReviewWord; clientId: string };

function readCachedToday(): TodayResponse | null {
  try {
    const raw = localStorage.getItem(REVIEWS_TODAY_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<TodayResponse> | null) : null;
    return v && Array.isArray(v.words) ? (v as TodayResponse) : null;
  } catch {
    return null;
  }
}

// 送信待ちの単語復習で、すでに答えたカードの id
async function answeredWordIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const q of await list()) {
    const b = q.body as { kind?: string; id?: string } | null;
    if (q.kind === "reviews" && b?.kind === "word" && typeof b.id === "string") ids.add(b.id);
  }
  return ids;
}

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Review() {
  const { me, refresh } = useMe();
  const [cards, setCards] = useState<ReviewWord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(0);
  const [last, setLast] = useState<Last | null>(null);
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
      const done = await answeredWordIds();
      if (!alive) return;
      const words = today.words.filter((w) => !done.has(w.id));
      setCards(words);
      setTotal(words.length);
    })().catch(() => {
      if (alive) setError("読み込めませんでした");
    });
    return () => {
      alive = false;
    };
  }, []);

  const finished = cards !== null && index >= cards.length;
  useEffect(() => {
    if (finished) refresh();
  }, [finished, refresh]);

  const send = useCallback(() => {
    const p = flush()
      .then((r) => {
        if (typeof r.streak === "number") setStreak(r.streak);
      })
      .catch(() => {});
    pending.current = p;
  }, []);

  const answer = async (card: ReviewWord, result: "remembered" | "forgot") => {
    const clientId = crypto.randomUUID();
    setMessage(null);
    setLast({ card, clientId });
    setIndex((i) => i + 1);
    await enqueue({
      id: clientId,
      path: "/api/reviews",
      kind: "reviews",
      body: { clientId, kind: "word", id: card.id, result, reviewedAt: new Date().toISOString() },
    });
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
    setIndex((i) => i - 1);
    setLast(null);
  };

  if (error) {
    return (
      <div role="alert" className="notice">
        <p>{error}</p>
        <SlantLink to="/" variant="secondary">
          ホームへ
        </SlantLink>
      </div>
    );
  }
  if (!cards) return <p className="muted">読み込み中…</p>;

  if (finished) {
    return (
      <Done base={me?.streak ?? 0} streak={streak} empty={total === 0} message={message} onUndo={last ? () => void undo() : undefined} />
    );
  }

  const card = cards[index];
  return (
    <>
      <div className="tag">
        REVIEW ・ {index + 1} / {total}
      </div>
      <div className="progress" role="progressbar" aria-label="進み具合" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index}>
        <div style={{ width: `${(index / total) * 100}%` }} />
      </div>
      <FlashCard key={card.id} front={card.english} back={card.japanese} onResult={(r) => void answer(card, r)} />
      <p className="muted" style={{ textAlign: "center", margin: 0 }}>
        {card.stageDays}日目の復習
      </p>
      <button type="button" className="link-button" disabled={!last} onClick={() => void undo()}>
        ↶ 1つ戻す
      </button>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
    </>
  );
}

function Done({
  base,
  streak,
  empty,
  message,
  onUndo,
}: {
  base: number;
  streak: number | null;
  empty: boolean;
  message: string | null;
  onUndo?: () => void;
}) {
  const target = streak ?? base;
  const [shown, setShown] = useState(base);
  useEffect(() => {
    if (target <= shown || prefersReducedMotion()) {
      setShown(target);
      return;
    }
    // 増えた分を少し遅れて +1 ずつ見せる
    const t = setTimeout(() => setShown((s) => s + 1), 500);
    return () => clearTimeout(t);
  }, [target, shown]);

  return (
    <>
      <div className="tag">{empty ? "REVIEW" : "COMPLETE"}</div>
      <h1>{empty ? "今日の復習はありません" : "今日の復習、完了！"}</h1>
      <div role="group" aria-label={`連続 ${shown} 日`}>
        <div className="tag">STREAK</div>
        <div className="num-italic" style={{ fontSize: "4.5rem" }} data-testid="streak">
          {shown}
          <span style={{ fontSize: "1rem", color: "var(--orange)", fontStyle: "normal" }}> DAYS 🔥</span>
        </div>
      </div>
      <SlantLink to="/">ホームへ</SlantLink>
      {onUndo && (
        <button type="button" className="link-button" onClick={onUndo}>
          ↶ 1つ戻す
        </button>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
    </>
  );
}
