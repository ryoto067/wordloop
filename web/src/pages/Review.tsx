import { SlantLink } from "../components/SlantButton";
import { FlashCard } from "../components/FlashCard";
import { ReviewDone } from "../components/ReviewDone";
import { useMe } from "../lib/MeContext";
import { useReviewSession } from "../lib/useReviewSession";

export function Review() {
  const { me } = useMe();
  const { cards, total, index, last, error, message, streak, finished, answer, undo } = useReviewSession("word");

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
      <ReviewDone base={me?.streak ?? 0} streak={streak} empty={total === 0} message={message} onUndo={last ? () => void undo() : undefined} />
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
