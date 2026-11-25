import { Hono } from "hono";
import { requireUser } from "../auth/middleware";
import { localDate } from "../domain/dates";
import { applyRoundTestForgot, startCard } from "../domain/srs";
import type { AppEnv } from "../env";
import { normEnglish, normJapanese } from "./words";

export const roundRoutes = new Hono<AppEnv>();

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

async function getUser(db: D1Database, userId: string) {
  const u = await db
    .prepare("SELECT timezone, word_intervals FROM users WHERE id = ?")
    .bind(userId)
    .first<{ timezone: string; word_intervals: string }>();
  return u ? { timezone: u.timezone, intervals: JSON.parse(u.word_intervals) as number[] } : null;
}

const markDidRound = (db: D1Database, userId: string, date: string) =>
  db
    .prepare(
      "INSERT INTO daily_activity (user_id, date, did_round) VALUES (?, ?, 1) ON CONFLICT(user_id, date) DO UPDATE SET did_round = 1",
    )
    .bind(userId, date);

function validTimes(startedAt: unknown, durationSec: unknown): boolean {
  return (
    typeof startedAt === "string" &&
    !Number.isNaN(Date.parse(startedAt)) &&
    Number.isInteger(durationSec) &&
    (durationSec as number) >= 0
  );
}

roundRoutes.post("/api/rounds/first", requireUser, async (c) => {
  const userId = c.get("userId");
  const user = await getUser(c.env.DB, userId);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (!validTimes(body.startedAt, body.durationSec)) return c.json({ error: "invalid startedAt/durationSec" }, 400);
  if (!Array.isArray(body.words) || body.words.length === 0) return c.json({ error: "words required" }, 400);

  const inputs = new Map<string, string>(); // english -> japanese（同じ語は最初のものを採用）
  for (const w of body.words as { english?: unknown; japanese?: unknown }[]) {
    const english = normEnglish(w?.english);
    const japanese = normJapanese(w?.japanese);
    if (!english || !japanese) return c.json({ error: "english and japanese required" }, 400);
    if (!inputs.has(english)) inputs.set(english, japanese);
  }
  const link = new Set(Array.isArray(body.linkExisting) ? (body.linkExisting as unknown[]).map(normEnglish) : []);

  const today = localDate(new Date(), user.timezone);
  const [, m, d] = today.split("-").map(Number);
  const base = `${m}/${d} セット`;
  const same = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM word_sets WHERE user_id = ? AND (name = ? OR name LIKE ?)")
    .bind(userId, base, `${base}%`)
    .first<{ n: number }>();
  const nth = (same?.n ?? 0) + 1;
  const name = nth === 1 ? base : `${base}${CIRCLED[nth - 1] ?? `(${nth})`}`;

  const setId = crypto.randomUUID();
  const roundId = crypto.randomUUID();
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare("INSERT INTO word_sets (id, user_id, name) VALUES (?, ?, ?)").bind(setId, userId, name),
  ];
  let created = 0;
  let linked = 0;
  let skipped = 0;
  for (const [english, japanese] of inputs) {
    const ex = await c.env.DB.prepare("SELECT id FROM words WHERE user_id = ? AND english = ?")
      .bind(userId, english)
      .first<{ id: string }>();
    let wordId: string;
    if (ex) {
      if (!link.has(english)) {
        skipped++;
        continue;
      }
      wordId = ex.id;
      linked++;
    } else {
      wordId = crypto.randomUUID();
      const card = startCard(today, user.intervals);
      stmts.push(
        c.env.DB.prepare(
          "INSERT INTO words (id, user_id, english, japanese, stage, anchor_on, next_review_on, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'reviewing')",
        ).bind(wordId, userId, english, japanese, card.stage, card.anchorOn, card.nextReviewOn),
      );
      created++;
    }
    stmts.push(c.env.DB.prepare("INSERT INTO set_words (set_id, word_id) VALUES (?, ?)").bind(setId, wordId));
  }
  stmts.push(
    c.env.DB.prepare(
      "INSERT INTO study_rounds (id, user_id, set_id, round_no, started_at, duration_sec) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind(roundId, userId, setId, body.startedAt, body.durationSec),
    markDidRound(c.env.DB, userId, today),
  );
  await c.env.DB.batch(stmts);
  return c.json({ setId, roundNo: 1, created, linked, skipped });
});

roundRoutes.get("/api/sets", requireUser, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name,
            (SELECT COUNT(*) FROM set_words sw WHERE sw.set_id = s.id) AS wordCount,
            COALESCE((SELECT MAX(round_no) FROM study_rounds r WHERE r.set_id = s.id), 0) AS lastRoundNo,
            s.created_at AS createdAt
     FROM word_sets s WHERE s.user_id = ? ORDER BY s.created_at DESC, s.rowid DESC`,
  )
    .bind(c.get("userId"))
    .all();
  return c.json(results);
});

roundRoutes.post("/api/rounds/next", requireUser, async (c) => {
  const userId = c.get("userId");
  const user = await getUser(c.env.DB, userId);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (typeof body.setId !== "string") return c.json({ error: "setId required" }, 400);
  if (!Number.isInteger(body.roundNo) || (body.roundNo as number) < 2) return c.json({ error: "invalid roundNo" }, 400);
  if (!validTimes(body.startedAt, body.durationSec)) return c.json({ error: "invalid startedAt/durationSec" }, 400);
  const set = await c.env.DB.prepare("SELECT id FROM word_sets WHERE id = ? AND user_id = ?")
    .bind(body.setId, userId)
    .first();
  if (!set) return c.json({ error: "not found" }, 404);

  const roundId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO study_rounds (id, user_id, set_id, round_no, started_at, duration_sec) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(roundId, userId, body.setId, body.roundNo, body.startedAt, body.durationSec),
    markDidRound(c.env.DB, userId, localDate(new Date(), user.timezone)),
  ]);
  const { results } = await c.env.DB.prepare(
    "SELECT w.id, w.english, w.japanese FROM set_words sw JOIN words w ON w.id = sw.word_id WHERE sw.set_id = ? ORDER BY w.english",
  )
    .bind(body.setId)
    .all<{ id: string; english: string; japanese: string }>();
  return c.json({ roundId, words: results });
});

roundRoutes.post("/api/rounds/:roundId/results", requireUser, async (c) => {
  const userId = c.get("userId");
  const user = await getUser(c.env.DB, userId);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const round = await c.env.DB.prepare("SELECT id, set_id FROM study_rounds WHERE id = ? AND user_id = ?")
    .bind(c.req.param("roundId"), userId)
    .first<{ id: string; set_id: string }>();
  if (!round) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ results?: unknown }>().catch(() => ({}) as { results?: unknown });
  if (!Array.isArray(body.results)) return c.json({ error: "results required" }, 400);

  const items: { wordId: string; result: "remembered" | "forgot" }[] = [];
  for (const r of body.results as { wordId?: unknown; result?: unknown }[]) {
    if (typeof r?.wordId !== "string" || (r.result !== "remembered" && r.result !== "forgot")) {
      return c.json({ error: "invalid results" }, 400);
    }
    items.push({ wordId: r.wordId, result: r.result });
  }

  const today = localDate(new Date(), user.timezone);
  let remembered = 0;
  let forgot = 0;
  const stmts: D1PreparedStatement[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.wordId)) continue;
    seen.add(it.wordId);
    const w = await c.env.DB.prepare(
      `SELECT w.stage, w.anchor_on, w.next_review_on, w.status FROM set_words sw JOIN words w ON w.id = sw.word_id
       WHERE sw.set_id = ? AND sw.word_id = ? AND w.user_id = ?`,
    )
      .bind(round.set_id, it.wordId, userId)
      .first<{ stage: number; anchor_on: string; next_review_on: string; status: string }>();
    if (!w) return c.json({ error: "not found" }, 404);
    const done = await c.env.DB.prepare("SELECT 1 FROM round_tests WHERE round_id = ? AND word_id = ?")
      .bind(round.id, it.wordId)
      .first();
    if (done) continue; // 再送は二重に進めない
    stmts.push(
      c.env.DB.prepare("INSERT INTO round_tests (round_id, word_id, result) VALUES (?, ?, ?)").bind(round.id, it.wordId, it.result),
    );
    if (it.result === "remembered") {
      remembered++;
      continue;
    }
    forgot++;
    if (w.status === "reviewing") {
      const next = applyRoundTestForgot(
        { stage: w.stage, anchorOn: w.anchor_on, nextReviewOn: w.next_review_on },
        today,
        user.intervals,
      );
      stmts.push(
        c.env.DB.prepare("UPDATE words SET stage = ?, anchor_on = ?, next_review_on = ? WHERE id = ?").bind(
          next.stage, next.anchorOn, next.nextReviewOn, it.wordId,
        ),
      );
    }
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ remembered, forgot });
});
