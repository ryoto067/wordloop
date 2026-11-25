// 通知の url は同一オリジンのときだけ使う。それ以外はトップへ
export function safeNotificationUrl(raw: unknown, origin: string): string {
  const fallback = `${origin}/`;
  if (typeof raw !== "string") return fallback;
  try {
    const u = new URL(raw, origin);
    return u.origin === origin ? u.href : fallback;
  } catch {
    return fallback;
  }
}
