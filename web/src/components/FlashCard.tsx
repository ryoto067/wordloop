import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { swipeDecision, type SwipeResult } from "../lib/swipe";
import { SlantButton } from "./SlantButton";

type Props = {
  front: string;
  back: string;
  onResult(result: SwipeResult): void;
};

// これ以上動いたらタップではなくスワイプとして扱う（px）
const TAP_SLOP = 10;

export function FlashCard({ front, back, onResult }: Props) {
  const [flipped, setFlipped] = useState(false);
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  const moved = useRef(false);
  const cardRef = useRef<HTMLButtonElement>(null);

  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    start.current = e.clientX;
    moved.current = false;
  };
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (start.current === null || !flipped) return;
    const d = e.clientX - start.current;
    if (Math.abs(d) > TAP_SLOP) moved.current = true;
    setDx(d);
  };
  const onUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (start.current === null) return;
    const d = e.clientX - start.current;
    start.current = null;
    setDx(0);
    if (!flipped) return;
    const width = cardRef.current?.getBoundingClientRect().width ?? 0;
    const decision = swipeDecision(d, width);
    if (decision) onResult(decision);
  };
  const onCancel = () => {
    start.current = null;
    setDx(0);
  };
  // スワイプ直後の click ではめくらない（タップとキーボード操作は click で届く）
  const onClick = () => {
    if (moved.current) {
      moved.current = false;
      return;
    }
    setFlipped((f) => !f);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!flipped) return;
    if (e.key === "ArrowRight") onResult("remembered");
    else if (e.key === "ArrowLeft") onResult("forgot");
  };

  return (
    <>
      <button
        ref={cardRef}
        type="button"
        className="flashcard"
        style={{ transform: dx ? `translateX(${dx}px) rotate(${dx / 40}deg)` : undefined }}
        aria-label={flipped ? `答え: ${back}。もう一度押すと英単語に戻ります` : `${front}。押すと意味が見えます`}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
      >
        <span className="flashcard-word num-italic">{front}</span>
        {flipped ? (
          <span className="flashcard-meaning">{back}</span>
        ) : (
          <span className="muted flashcard-hint">タップでめくる</span>
        )}
      </button>
      <div className="two-buttons">
        <SlantButton variant="secondary" disabled={!flipped} onClick={() => onResult("forgot")}>
          忘れてた
        </SlantButton>
        <SlantButton disabled={!flipped} onClick={() => onResult("remembered")}>
          覚えてた
        </SlantButton>
      </div>
    </>
  );
}
