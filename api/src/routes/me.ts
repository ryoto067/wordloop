import { Hono } from "hono";
import { requireUser } from "../auth/middleware";
import type { AppEnv } from "../env";
import { getTodayStats } from "../stats";

export const meRoutes = new Hono<AppEnv>();

type UserRow = {
  id: string;
  name: string;
  email: string;
  timezone: string;
  word_intervals: string;
  sentence_intervals: string;
  font_scale: number;
};

meRoutes.get("/api/me", requireUser, async (c) => {
  const u = await c.env.DB.prepare(
    "SELECT id, name, email, timezone, word_intervals, sentence_intervals, font_scale FROM users WHERE id = ?",
  )
    .bind(c.get("userId"))
    .first<UserRow>();
  if (!u) return c.json({ error: "unauthorized" }, 401);
  const { streak, ...today } = await getTodayStats(c.env.DB, u.id, u.timezone, new Date());
  return c.json({
    id: u.id,
    name: u.name,
    email: u.email,
    timezone: u.timezone,
    wordIntervals: JSON.parse(u.word_intervals) as number[],
    sentenceIntervals: JSON.parse(u.sentence_intervals) as number[],
    fontScale: u.font_scale,
    streak,
    today,
  });
});
