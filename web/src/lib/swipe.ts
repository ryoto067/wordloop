export type SwipeResult = "remembered" | "forgot";

// 横に動いた量 dx がカード幅の半分以上なら判定する（右 = 覚えてた、左 = 忘れてた）
export function swipeDecision(dx: number, cardWidth: number): SwipeResult | null {
  if (!(cardWidth > 0)) return null;
  const threshold = cardWidth / 2;
  if (dx >= threshold) return "remembered";
  if (dx <= -threshold) return "forgot";
  return null;
}
