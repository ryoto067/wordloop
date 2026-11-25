import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../env";

export const SESSION_COOKIE = "wl_session";
export const SESSION_DAYS = 90;

const cookieBase = { httpOnly: true, secure: true, sameSite: "Lax", path: "/" } as const;

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomId(byteLength = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** セッションを作り、Cookie をセットする。 */
export async function createSession(c: Context<AppEnv>, userId: string, now = new Date()): Promise<void> {
  const id = randomId(32);
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(id, userId, expires.toISOString())
    .run();
  setCookie(c, SESSION_COOKIE, id, { ...cookieBase, maxAge: SESSION_DAYS * 86400 });
}

/** Cookie のセッションが有効なら userId を返す（期限切れは削除して null）。 */
export async function getSessionUserId(c: Context<AppEnv>, now = new Date()): Promise<string | null> {
  const id = getCookie(c, SESSION_COOKIE);
  if (!id) return null;
  const row = await c.env.DB.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?")
    .bind(id)
    .first<{ user_id: string; expires_at: string }>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return null;
  }
  return row.user_id;
}

export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const id = getCookie(c, SESSION_COOKIE);
  if (id) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
}

/** ユーザーが新規なら notify_times の初期値（朝 07:30・夜 21:00）も作る。 */
export async function upsertUser(
  db: D1Database,
  u: { googleSub: string; email: string; name: string },
): Promise<string> {
  const existing = await db
    .prepare("SELECT id FROM users WHERE google_sub = ?")
    .bind(u.googleSub)
    .first<{ id: string }>();
  if (existing) {
    await db.prepare("UPDATE users SET email = ?, name = ? WHERE id = ?").bind(u.email, u.name, existing.id).run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO users (id, google_sub, email, name) VALUES (?, ?, ?, ?)").bind(id, u.googleSub, u.email, u.name),
    db.prepare("INSERT INTO notify_times (id, user_id, hhmm, kind) VALUES (?, ?, '07:30', 'morning')").bind(crypto.randomUUID(), id),
    db.prepare("INSERT INTO notify_times (id, user_id, hhmm, kind) VALUES (?, ?, '21:00', 'evening')").bind(crypto.randomUUID(), id),
  ]);
  return id;
}
