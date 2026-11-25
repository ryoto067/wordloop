import { useEffect, useState } from "react";
import { SlantLink } from "./SlantButton";

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ReviewDone({
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
