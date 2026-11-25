import { Hono } from "hono";
import { requireUser } from "../auth/middleware";
import type { AppEnv } from "../env";

export const settingsRoutes = new Hono<AppEnv>();

const FONT_SCALES = [0.9, 1, 1.15]; // 小・中・大
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const KINDS = ["morning", "evening", "custom"];

function validIntervals(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length >= 1 &&
    v.length <= 8 &&
    v.every((n, i) => Number.isInteger(n) && n >= 1 && n <= 365 && (i === 0 || n > v[i - 1]))
  );
}

function validTimezone(v: unknown): v is string {
  if (typeof v !== "string" || v === "") return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

type UserRow = { timezone: string; word_intervals: string; sentence_intervals: string; font_scale: number };

async function readSettings(db: D1Database, userId: string) {
  const u = await db
    .prepare("SELECT timezone, word_intervals, sentence_intervals, font_scale FROM users WHERE id = ?")
    .bind(userId)
    .first<UserRow>();
  if (!u) return null;
  return {
    timezone: u.timezone,
    wordIntervals: JSON.parse(u.word_intervals) as number[],
    sentenceIntervals: JSON.parse(u.sentence_intervals) as number[],
    fontScale: u.font_scale,
  };
}

settingsRoutes.get("/api/settings", requireUser, async (c) => {
  const s = await readSettings(c.env.DB, c.get("userId"));
  return s ? c.json(s) : c.json({ error: "unauthorized" }, 401);
});

settingsRoutes.patch("/api/settings", requireUser, async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "invalid body" }, 400);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.timezone !== undefined) {
    if (!validTimezone(b.timezone)) return c.json({ error: "invalid timezone" }, 400);
    sets.push("timezone = ?");
    vals.push(b.timezone);
  }
  if (b.wordIntervals !== undefined) {
    if (!validIntervals(b.wordIntervals)) return c.json({ error: "invalid wordIntervals" }, 400);
    sets.push("word_intervals = ?");
    vals.push(JSON.stringify(b.wordIntervals));
  }
  if (b.sentenceIntervals !== undefined) {
    if (!validIntervals(b.sentenceIntervals)) return c.json({ error: "invalid sentenceIntervals" }, 400);
    sets.push("sentence_intervals = ?");
    vals.push(JSON.stringify(b.sentenceIntervals));
  }
  if (b.fontScale !== undefined) {
    if (!FONT_SCALES.includes(b.fontScale)) return c.json({ error: "invalid fontScale" }, 400);
    sets.push("font_scale = ?");
    vals.push(b.fontScale);
  }
  const userId = c.get("userId");
  if (sets.length > 0) {
    await c.env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, userId).run();
  }
  const s = await readSettings(c.env.DB, userId);
  return s ? c.json(s) : c.json({ error: "unauthorized" }, 401);
});

type TimeRow = { id: string; hhmm: string; kind: string };

settingsRoutes.get("/api/settings/notify-times", requireUser, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, hhmm, kind FROM notify_times WHERE user_id = ? ORDER BY hhmm, id",
  )
    .bind(c.get("userId"))
    .all<TimeRow>();
  return c.json(results);
});

settingsRoutes.post("/api/settings/notify-times", requireUser, async (c) => {
  const b = await c.req.json().catch(() => null);
  if (typeof b?.hhmm !== "string" || !HHMM.test(b.hhmm) || !KINDS.includes(b.kind)) {
    return c.json({ error: "invalid notify time" }, 400);
  }
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO notify_times (id, user_id, hhmm, kind) VALUES (?, ?, ?, ?)")
    .bind(id, c.get("userId"), b.hhmm, b.kind)
    .run();
  return c.json({ id, hhmm: b.hhmm, kind: b.kind }, 201);
});

settingsRoutes.patch("/api/settings/notify-times/:id", requireUser, async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return c.json({ error: "invalid body" }, 400);
  if (b.hhmm !== undefined && (typeof b.hhmm !== "string" || !HHMM.test(b.hhmm))) return c.json({ error: "invalid hhmm" }, 400);
  if (b.kind !== undefined && !KINDS.includes(b.kind)) return c.json({ error: "invalid kind" }, 400);
  const userId = c.get("userId");
  const cur = await c.env.DB.prepare("SELECT id, hhmm, kind FROM notify_times WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .first<TimeRow>();
  if (!cur) return c.json({ error: "not found" }, 404);
  const next = { id: cur.id, hhmm: b.hhmm ?? cur.hhmm, kind: b.kind ?? cur.kind };
  await c.env.DB.prepare("UPDATE notify_times SET hhmm = ?, kind = ? WHERE id = ? AND user_id = ?")
    .bind(next.hhmm, next.kind, cur.id, userId)
    .run();
  return c.json(next);
});

settingsRoutes.delete("/api/settings/notify-times/:id", requireUser, async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM notify_times WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("userId"))
    .run();
  if (r.meta.changes === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
