import { Hono } from "hono";
import { requireUser } from "../auth/middleware";
import { localDate } from "../domain/dates";
import { applyResult, type Card } from "../domain/srs";
import type { AppEnv } from "../env";
import { getTodayStats } from "../stats";

export const reviewRoutes = new Hono<AppEnv>();

type Kind = "word" | "sentence";
type Result = "remembered" | "forgot";
type Item = { clientId: string; kind: Kind; id: string; result: Result; reviewedAt: string; at: number };

type UserRow = { timezone: string; word_intervals: string; sentence_intervals: string };
type CardRow = { stage: number; anchor_on: string; next_review_on: string | null; status: string };

const T = {
  word: { table: "words", reviews: "word_reviews", fk: "word_id" },
  sentence: { table: "sentences", reviews: "sentence_reviews", fk: "sentence_id" },
} as const;

const SENTENCE_RECALL_DAYS = 30;

const stageDays = (intervals: number[], stage: number) => intervals[Math.min(stage, intervals.length - 1)];

async function getUser(db: D1Database, userId: string) {
  const u = await db
    .prepare("SELECT timezone, word_intervals, sentence_intervals FROM users WHERE id = ?")
    .bind(userId)
    .first<UserRow>();
  if (!u) return null;
  return {
    timezone: u.timezone,
    word: JSON.parse(u.word_intervals) as number[],
    sentence: JSON.parse(u.sentence_intervals) as number[],
  };
}

// date 時点で期日が来ている reviewing カードが 0 件か
async function noneDue(db: D1Database, userId: string, date: string): Promise<boolean> {
  const r = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM words WHERE user_id = ?1 AND status = 'reviewing' AND next_review_on <= ?2)
            + (SELECT COUNT(*) FROM sentences WHERE user_id = ?1 AND status = 'reviewing' AND next_review_on <= ?2) AS n`,
    )
    .bind(userId, date)
    .first<{ n: number }>();
  return (r?.n ?? 0) === 0;
}

reviewRoutes.get("/api/reviews/today", requireUser, async (c) => {
  const userId = c.get("userId");
  const user = await getUser(c.env.DB, userId);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const today = localDate(new Date(), user.timezone);
  const [w, s] = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT id, english, japanese, stage FROM words WHERE user_id = ? AND status = 'reviewing' AND next_review_on <= ? ORDER BY next_review_on, created_at, rowid",
    ).bind(userId, today),
    c.env.DB.prepare(
      "SELECT id, english_marked, japanese_text, stage FROM sentences WHERE user_id = ? AND status = 'reviewing' AND next_review_on <= ? ORDER BY next_review_on, created_at, rowid",
    ).bind(userId, today),
  ]);
  const words = (w.results as { id: string; english: string; japanese: string; stage: number }[]).map((r) => ({
    ...r,
    stageDays: stageDays(user.word, r.stage),
  }));
  const sentences = (
    s.results as { id: string; english_marked: string; japanese_text: string; stage: number }[]
  ).map((r) => ({
    id: r.id,
    englishMarked: r.english_marked,
    japanese: r.japanese_text,
    mode: stageDays(user.sentence, r.stage) >= SENTENCE_RECALL_DAYS ? "recall" : "cloze",
    stage: r.stage,
  }));
  return c.json({ words, sentences });
});

function parseItems(body: unknown): Item[] | null {
  const raw = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(raw)) return null;
  const items: Item[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const at = typeof r?.reviewedAt === "string" ? Date.parse(r.reviewedAt) : NaN;
    if (
      typeof r?.clientId !== "string" || !r.clientId ||
      (r.kind !== "word" && r.kind !== "sentence") ||
      typeof r.id !== "string" ||
      (r.result !== "remembered" && r.result !== "forgot") ||
      Number.isNaN(at)
    ) {
      return null;
    }
    items.push({ clientId: r.clientId, kind: r.kind, id: r.id, result: r.result, reviewedAt: r.reviewedAt as string, at });
  }
  return items;
}

reviewRoutes.post("/api/reviews", requireUser, async (c) => {
  const userId = c.get("userId");
  const db = c.env.DB;
  const user = await getUser(db, userId);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  const items = parseItems(body);
  if (!items) return c.json({ error: "invalid items" }, 400);

  items.sort((a, b) => a.at - b.at); // 安定ソート: 同時刻は送信順
  let applied = 0;
  let skipped = 0;
  const touched = new Set<string>();

  for (const it of items) {
    const t = T[it.kind];
    const dup = await db
      .prepare("SELECT 1 FROM word_reviews WHERE client_id = ?1 UNION ALL SELECT 1 FROM sentence_reviews WHERE client_id = ?1")
      .bind(it.clientId)
      .first();
    const card = dup
      ? null
      : await db
          .prepare(`SELECT stage, anchor_on, next_review_on, status FROM ${t.table} WHERE id = ? AND user_id = ?`)
          .bind(it.id, userId)
          .first<CardRow>();
    if (!card || card.status !== "reviewing" || card.next_review_on === null) {
      skipped++;
      continue;
    }
    const date = localDate(new Date(it.at), user.timezone);
    const intervals = user[it.kind];
    const before: Card = { stage: card.stage, anchorOn: card.anchor_on, nextReviewOn: card.next_review_on };
    const { graduated, ...after } = applyResult(before, it.result, date, intervals);
    const status = graduated ? (it.kind === "word" ? "waiting_sentence" : "mastered") : "reviewing";
    const prev = [card.stage, card.anchor_on, card.next_review_on, card.status] as const;
    const review =
      it.kind === "word"
        ? db
            .prepare(
              "INSERT INTO word_reviews (id, word_id, client_id, reviewed_on, result, prev_stage, prev_anchor_on, prev_next_review_on, prev_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(crypto.randomUUID(), it.id, it.clientId, date, it.result, ...prev)
        : db
            .prepare(
              "INSERT INTO sentence_reviews (id, sentence_id, client_id, reviewed_on, mode, result, prev_stage, prev_anchor_on, prev_next_review_on, prev_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(
              crypto.randomUUID(), it.id, it.clientId, date,
              stageDays(intervals, card.stage) >= SENTENCE_RECALL_DAYS ? "recall" : "cloze",
              it.result, ...prev,
            );
    await db.batch([
      review,
      db
        .prepare(`UPDATE ${t.table} SET stage = ?, anchor_on = ?, next_review_on = ?, status = ? WHERE id = ?`)
        .bind(after.stage, after.anchorOn, after.nextReviewOn, status, it.id),
      db
        .prepare(
          "INSERT INTO daily_activity (user_id, date, reviews_done) VALUES (?, ?, 1) ON CONFLICT(user_id, date) DO UPDATE SET reviews_done = reviews_done + 1",
        )
        .bind(userId, date),
    ]);
    touched.add(date);
    applied++;
  }

  for (const date of touched) {
    if (await noneDue(db, userId, date)) {
      await db.prepare("UPDATE daily_activity SET cleared_all = 1 WHERE user_id = ? AND date = ?").bind(userId, date).run();
    }
  }
  const stats = await getTodayStats(db, userId, user.timezone, new Date());
  return c.json({ applied, skipped, streak: stats.streak });
});

reviewRoutes.post("/api/reviews/undo", requireUser, async (c) => {
  const userId = c.get("userId");
  const db = c.env.DB;
  const body = await c.req.json<{ clientId?: unknown }>().catch(() => ({}) as { clientId?: unknown });
  if (typeof body.clientId !== "string" || !body.clientId) return c.json({ error: "clientId required" }, 400);

  type ReviewRow = {
    rowid: number; card_id: string; reviewed_on: string;
    prev_stage: number; prev_anchor_on: string; prev_next_review_on: string | null; prev_status: string;
  };
  for (const kind of ["word", "sentence"] as const) {
    const t = T[kind];
    const r = await db
      .prepare(
        `SELECT r.rowid AS rowid, r.${t.fk} AS card_id, r.reviewed_on, r.prev_stage, r.prev_anchor_on, r.prev_next_review_on, r.prev_status
         FROM ${t.reviews} r JOIN ${t.table} x ON x.id = r.${t.fk} WHERE r.client_id = ? AND x.user_id = ?`,
      )
      .bind(body.clientId, userId)
      .first<ReviewRow>();
    if (!r) continue;
    const later = await db
      .prepare(`SELECT 1 FROM ${t.reviews} WHERE ${t.fk} = ? AND rowid > ?`)
      .bind(r.card_id, r.rowid)
      .first();
    if (later) return c.json({ error: "not the latest review" }, 409);
    await db.batch([
      db
        .prepare(`UPDATE ${t.table} SET stage = ?, anchor_on = ?, next_review_on = ?, status = ? WHERE id = ?`)
        .bind(r.prev_stage, r.prev_anchor_on, r.prev_next_review_on, r.prev_status, r.card_id),
      db.prepare(`DELETE FROM ${t.reviews} WHERE client_id = ?`).bind(body.clientId),
      db
        .prepare("UPDATE daily_activity SET reviews_done = MAX(reviews_done - 1, 0) WHERE user_id = ? AND date = ?")
        .bind(userId, r.reviewed_on),
    ]);
    const cleared = (await noneDue(db, userId, r.reviewed_on)) ? 1 : 0;
    await db
      .prepare("UPDATE daily_activity SET cleared_all = ? WHERE user_id = ? AND date = ?")
      .bind(cleared, userId, r.reviewed_on)
      .run();
    return c.json({ ok: true });
  }
  return c.json({ error: "not found" }, 404);
});
