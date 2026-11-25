import { Hono } from "hono";
import { requireUser } from "../auth/middleware";
import type { AppEnv } from "../env";

export const pushRoutes = new Hono<AppEnv>();

pushRoutes.get("/api/push/public-key", requireUser, (c) => c.json({ publicKey: c.env.VAPID_PUBLIC_KEY }));

pushRoutes.post("/api/push/subscribe", requireUser, async (c) => {
  const b = await c.req.json().catch(() => null);
  const endpoint = b?.endpoint;
  const p256dh = b?.keys?.p256dh;
  const auth = b?.keys?.auth;
  if (![endpoint, p256dh, auth].every((v) => typeof v === "string" && v.length > 0)) {
    return c.json({ error: "invalid subscription" }, 400);
  }
  try {
    if (new URL(endpoint).protocol !== "https:") throw new Error("not https");
  } catch {
    return c.json({ error: "invalid endpoint" }, 400);
  }
  // 同じ endpoint が別ユーザーに紐づいていても、ブラウザのアカウント切替とみなして付け替える
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  )
    .bind(crypto.randomUUID(), c.get("userId"), endpoint, p256dh, auth)
    .run();
  return c.json({ ok: true });
});

pushRoutes.post("/api/push/unsubscribe", requireUser, async (c) => {
  const b = await c.req.json().catch(() => null);
  if (typeof b?.endpoint !== "string") return c.json({ error: "endpoint required" }, 400);
  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?")
    .bind(c.get("userId"), b.endpoint)
    .run();
  return c.json({ ok: true });
});
