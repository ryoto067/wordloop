import { useState } from "react";
import { ReviewDone } from "../components/ReviewDone";
import { MarkedText } from "../components/MarkedText";
import { SlantButton, SlantLink } from "../components/SlantButton";
import { toSegments } from "../lib/cloze";
import { useMe } from "../lib/MeContext";
import { useReviewSession, type ReviewSentence } from "../lib/useReviewSession";

type Result = "remembered" | "forgot";

function Judge({ enabled, onResult }: { enabled: boolean; onResult(r: Result): void }) {
  return (
    <div className="two-buttons">
      <SlantButton variant="secondary" disabled={!enabled} onClick={() => onResult("forgot")}>
        忘れてた
      </SlantButton>
      <SlantButton disabled={!enabled} onClick={() => onResult("remembered")}>
        覚えてた
      </SlantButton>
    </div>
  );
}

// 穴埋め: 空欄をタップで答えを表示。全部開くと判定できる
function Cloze({ card, onResult }: { card: ReviewSentence; onResult(r: Result): void }) {
  const segments = toSegments(card.englishMarked);
  const blanks = segments.filter((s) => "blank" in s).length;
  const [open, setOpen] = useState<Set<number>>(new Set());
  const reveal = (i: number) => setOpen((o) => new Set(o).add(i));
  return (
    <>
      <div className="tag">STORY ・ 穴埋め</div>
      <div className="story-card">
        <p className="story-text">
          {segments.map((s, i) =>
            "blank" in s ? (
              open.has(i) ? (
                <strong key={i} className="blank open">
                  {s.blank}
                </strong>
              ) : (
                <button key={i} type="button" className="blank" aria-label="空欄。押すと答えが見えます" onClick={() => reveal(i)}>
                  ?
                </button>
              )
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </p>
        <p className="story-ja">{card.japanese}</p>
        <p className="muted" style={{ margin: 0 }}>
          空欄をタップで答えを表示
        </p>
      </div>
      <Judge enabled={open.size >= blanks} onResult={onResult} />
    </>
  );
}

// 思い出す: 和訳だけ見て英文を思い出し、タップ（Space/Enter）で英文を表示
function Recall({ card, onResult }: { card: ReviewSentence; onResult(r: Result): void }) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <div className="tag">STORY ・ 英文を思い出す</div>
      <div className="story-card">
        <p className="story-text">{card.japanese}</p>
        {shown ? (
          <p className="story-text">
            <MarkedText value={card.englishMarked} />
          </p>
        ) : (
          <button type="button" className="link-button" onClick={() => setShown(true)}>
            タップで英文を表示
          </button>
        )}
      </div>
      <Judge enabled={shown} onResult={onResult} />
    </>
  );
}

export function SentenceReview() {
  const { me } = useMe();
  const { cards, total, index, last, error, message, streak, finished, answer, undo } = useReviewSession("sentence");

  if (error) {
    return (
      <div role="alert" className="notice">
        <p>{error}</p>
        <SlantLink to="/sentences" variant="secondary">
          文章へ
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
  const onResult = (r: Result) => void answer(card, r);
  return (
    <>
      <div className="progress" role="progressbar" aria-label="進み具合" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index}>
        <div style={{ width: `${(index / total) * 100}%` }} />
      </div>
      {card.mode === "cloze" ? <Cloze key={card.id} card={card} onResult={onResult} /> : <Recall key={card.id} card={card} onResult={onResult} />}
      <p className="muted" style={{ textAlign: "center", margin: 0 }}>
        {index + 1} / {total}
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
