import { Hono } from "hono";
import type { Context } from "hono";
import { getTextGen } from "../ai/provider";
import { AiFormatError, generateSentence } from "../ai/sentence";
import { requireUser } from "../auth/middleware";
import { localDate } from "../domain/dates";
import { missingLemmas } from "../domain/marks";
import { startCard } from "../domain/srs";
import type { AppEnv } from "../env";

export const sentenceRoutes = new Hono<AppEnv>();

const DAILY_LIMIT = 10;
const MIN_WORDS = 5;
const MAX_WORDS = 10;

type WordRow = { id: string; english: string; japanese: string };

async function getUser(db: D1Database, userId: string) {
  const u = await db
    .prepare("SELECT timezone, sentence_intervals FROM users WHERE id = ?")
    .bind(userId)
    .first<{ timezone: string; sentence_intervals: string }>();
  return u ? { timezone: u.timezone, intervals: JSON.parse(u.sentence_intervals) as number[] } : null;
}

async function usedToday(db: D1Database, userId: string, date: string): Promise<number> {
  const r = await db
    .prepare("SELECT count FROM ai_usage WHERE user_id = ? AND date = ?")
    .bind(userId, date)
    .first<{ count: number }>();
  return r?.count ?? 0;
}

// 上限内なら +1 して true。生成前に呼ぶので、失敗しても消費される
async function consumeUsage(db: D1Database, userId: string, date: string): Promise<boolean> {
  const r = await db
    .prepare(
      `INSERT INTO ai_usage (user_id, date, count) VALUES (?, ?, 1)
       ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1 WHERE count < ?`,
    )
    .bind(userId, date, DAILY_LIMIT)
    .run();
  return r.meta.changes > 0;
}

async function refundUsage(db: D1Database, userId: string, date: string): Promise<void> {
  await db
    .prepare("UPDATE ai_usage SET count = MAX(count - 1, 0) WHERE user_id = ? AND date = ?")
    .bind(userId, date)
    .run();
}

async function waitingWords(db: D1Database, userId: string, limit: number): Promise<WordRow[]> {
  const { results } = await db
    .prepare(
      "SELECT id, english, japanese FROM words WHERE user_id = ? AND status = 'waiting_sentence' ORDER BY created_at, rowid LIMIT ?",
    )
    .bind(userId, limit)
    .all<WordRow>();
  return results;
}

// wordIds がすべて本人の waiting_sentence なら語を返す。そうでなければ null
async function ownedWaiting(
  db: D1Database,
  userId: string,
  wordIds: unknown,
  min: number,
): Promise<WordRow[] | null> {
  if (!Array.isArray(wordIds) || !wordIds.every((x) => typeof x === "string")) return null;
  const ids = [...new Set(wordIds as string[])];
  if (ids.length < min || ids.length > MAX_WORDS) return null;
  const { results } = await db
    .prepare(
      `SELECT id, english, japanese FROM words WHERE user_id = ? AND status = 'waiting_sentence'
       AND id IN (${ids.map(() => "?").join(",")})`,
    )
    .bind(userId, ...ids)
    .all<WordRow>();
  return results.length === ids.length ? results : null;
}

sentenceRoutes.get("/api/sentences/waiting", requireUser, async (c) => {
  const userId = c.get("userId");
  const user = await getUser(c.env.DB, userId);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const today = localDate(new Date(), user.timezone);
  const remainingToday = Math.max(0, DAILY_LIMIT - (await usedToday(c.env.DB, userId, today)));
  const words = await waitingWords(c.env.DB, userId, -1);
  return c.json({ words, canGenerate: words.length >= MIN_WORDS && remainingToday > 0, remainingToday });
});

async function generateRoute(c: Context<AppEnv>, pick: (userId: string) => Promise<WordRow[] | null>) {
  const userId = c.get("userId");
  const user = await getUser(c.env.DB, userId);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const words = await pick(userId);
  if (!words || words.length === 0) return c.json({ error: "invalid wordIds" }, 400);
  const today = localDate(new Date(), user.timezone);
  if (!(await consumeUsage(c.env.DB, userId, today))) return c.json({ error: "daily_limit" }, 429);
  try {
    const out = await generateSentence(getTextGen(c.env), words);
    return c.json({ ...out, wordIds: words.map((w) => w.id) });
  } catch (e) {
    if (e instanceof AiFormatError) return c.json({ error: "ai_format" }, 502);
    // クォータ・ネットワークなど: 回数は返す
    console.error("ai generate failed", e);
    await refundUsage(c.env.DB, userId, today);
    return c.json({ error: "ai_unavailable" }, 503);
  }
}

sentenceRoutes.post("/api/sentences/generate", requireUser, (c) =>
  generateRoute(c, async (userId) => {
    const words = await waitingWords(c.env.DB, userId, MAX_WORDS);
    return words.length >= MIN_WORDS ? words : null;
  }),
);

sentenceRoutes.post("/api/sentences/regenerate", requireUser, async (c) => {
  const body = await c.req.json<{ wordIds?: unknown }>().catch(() => ({}) as { wordIds?: unknown });
  return generateRoute(c, (userId) => ownedWaiting(c.env.DB, userId, body.wordIds, MIN_WORDS));
});

function validText(b: Record<string, unknown>): b is { englishMarked: string; japanese: string } {
  return (
    typeof b.englishMarked === "string" &&
    b.englishMarked.trim() !== "" &&
    typeof b.japanese === "string" &&
    b.japanese.trim() !== ""
  );
}

sentenceRoutes.post("/api/sentences", requireUser, async (c) => {
  const userId = c.get("userId");
  const user = await getUser(c.env.DB, userId);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (!validText(body)) return c.json({ error: "englishMarked and japanese required" }, 400);
  const words = await ownedWaiting(c.env.DB, userId, (body as Record<string, unknown>).wordIds, 1);
  if (!words) return c.json({ error: "invalid wordIds" }, 400);

  const missing = missingLemmas(body.englishMarked, words.map((w) => w.english));
  if (missing.length > 0 && c.req.query("force") !== "1") return c.json({ warning: { missing } });

  const today = localDate(new Date(), user.timezone);
  const card = startCard(today, user.intervals);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO sentences (id, user_id, english_marked, japanese_text, stage, anchor_on, next_review_on, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'reviewing')",
      ).bind(id, userId, body.englishMarked, body.japanese, card.stage, card.anchorOn, card.nextReviewOn),
      ...words.map((w) =>
        c.env.DB.prepare("INSERT INTO sentence_words (sentence_id, word_id) VALUES (?, ?)").bind(id, w.id),
      ),
      ...words.map((w) =>
        c.env.DB.prepare("UPDATE words SET status = 'in_sentence', next_review_on = NULL WHERE id = ? AND status = 'waiting_sentence'").bind(w.id),
      ),
    ]);
  } catch (e) {
    // 同じ語が別の文章に保存済み（バッチは原子的）なら UNIQUE 制約違反。それ以外は保存失敗
    if (String(e).includes("UNIQUE")) return c.json({ error: "already_used" }, 409);
    console.error("save sentence failed", e);
    return c.json({ error: "save_failed" }, 500);
  }
  return c.json({ id, nextReviewOn: card.nextReviewOn });
});

sentenceRoutes.patch("/api/sentences/:id", requireUser, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (!validText(body)) return c.json({ error: "englishMarked and japanese required" }, 400);
  const id = c.req.param("id");
  const s = await c.env.DB.prepare("SELECT id FROM sentences WHERE id = ? AND user_id = ?").bind(id, userId).first();
  if (!s) return c.json({ error: "not found" }, 404);
  const { results } = await c.env.DB.prepare(
    "SELECT w.english FROM sentence_words sw JOIN words w ON w.id = sw.word_id WHERE sw.sentence_id = ?",
  )
    .bind(id)
    .all<{ english: string }>();
  const missing = missingLemmas(body.englishMarked, results.map((w) => w.english));
  if (missing.length > 0 && c.req.query("force") !== "1") return c.json({ warning: { missing } });
  await c.env.DB.prepare("UPDATE sentences SET english_marked = ?, japanese_text = ? WHERE id = ?")
    .bind(body.englishMarked, body.japanese, id)
    .run();
  return c.json({ ok: true });
});

sentenceRoutes.get("/api/sentences", requireUser, async (c) => {
  const userId = c.get("userId");
  const status = c.req.query("status") ?? "reviewing";
  if (status !== "reviewing" && status !== "mastered") return c.json({ error: "invalid status" }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT id, english_marked AS englishMarked, japanese_text AS japanese, stage,
            next_review_on AS nextReviewOn, status, created_at AS createdAt
     FROM sentences WHERE user_id = ? AND status = ? ORDER BY created_at DESC, rowid DESC`,
  )
    .bind(userId, status)
    .all<{ id: string }>();
  const { results: ws } = await c.env.DB.prepare(
    `SELECT sw.sentence_id AS sentenceId, w.id, w.english, w.japanese FROM sentence_words sw
     JOIN words w ON w.id = sw.word_id JOIN sentences s ON s.id = sw.sentence_id
     WHERE s.user_id = ? AND s.status = ? ORDER BY w.english`,
  )
    .bind(userId, status)
    .all<{ sentenceId: string; id: string; english: string; japanese: string }>();
  return c.json(
    results.map((s) => ({
      ...s,
      words: ws.filter((w) => w.sentenceId === s.id).map(({ id, english, japanese }) => ({ id, english, japanese })),
    })),
  );
});
