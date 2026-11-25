export function StreakNumber({ days }: { days: number }) {
  return (
    <div role="group" aria-label={`連続 ${days} 日`}>
      <div className="tag">STREAK</div>
      <div className="num-italic" style={{ fontSize: "4.5rem" }}>
        {days}
        <span style={{ fontSize: "1rem", color: "var(--orange)", fontStyle: "normal" }}> DAYS 🔥</span>
      </div>
    </div>
  );
}
