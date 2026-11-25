import { Hono } from "hono";
import { requireUser } from "../auth/middleware";
import type { AppEnv } from "../env";

export const wordRoutes = new Hono<AppEnv>();

export const normEnglish = (s: unknown): string => (typeof s === "string" ? s.trim().toLowerCase() : "");
export const normJapanese = (s: unknown): string => (typeof s === "string" ? s.trim() : "");

wordRoutes.post("/api/words/check", requireUser, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ english?: unknown }>().catch(() => ({}) as { english?: unknown });
  const list = Array.isArray(body.english) ? [...new Set(body.english.map(normEnglish).filter(Boolean))] : [];
  const existing: { english: string; wordId: string; setNames: string[] }[] = [];
  for (const english of list) {
    const w = await c.env.DB.prepare("SELECT id FROM words WHERE user_id = ? AND english = ?")
      .bind(userId, english)
      .first<{ id: string }>();
    if (!w) continue;
    const { results } = await c.env.DB.prepare(
      "SELECT s.name FROM set_words sw JOIN word_sets s ON s.id = sw.set_id WHERE sw.word_id = ? ORDER BY s.created_at, s.id",
    )
      .bind(w.id)
      .all<{ name: string }>();
    existing.push({ english, wordId: w.id, setNames: results.map((r) => r.name) });
  }
  return c.json({ existing });
});

wordRoutes.get("/api/words", requireUser, async (c) => {
  const q = normEnglish(c.req.query("q") ?? "");
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT id, english, japanese, stage, next_review_on AS nextReviewOn, status
     FROM words WHERE user_id = ? AND (english LIKE ? ESCAPE '\\' OR japanese LIKE ? ESCAPE '\\')
     ORDER BY english`,
  )
    .bind(c.get("userId"), like, like)
    .all();
  return c.json(results);
});

wordRoutes.patch("/api/words/:id", requireUser, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const w = await c.env.DB.prepare("SELECT id FROM words WHERE id = ? AND user_id = ?").bind(id, userId).first();
  if (!w) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ english?: unknown; japanese?: unknown }>().catch(() => ({}) as Record<string, unknown>);
  const sets: string[] = [];
  const binds: string[] = [];
  if (body.english !== undefined) {
    const e = normEnglish(body.english);
    if (!e) return c.json({ error: "english required" }, 400);
    sets.push("english = ?");
    binds.push(e);
  }
  if (body.japanese !== undefined) {
    const j = normJapanese(body.japanese);
    if (!j) return c.json({ error: "japanese required" }, 400);
    sets.push("japanese = ?");
    binds.push(j);
  }
  if (sets.length === 0) return c.json({ error: "nothing to update" }, 400);
  try {
    await c.env.DB.prepare(`UPDATE words SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`)
      .bind(...binds, id, userId)
      .run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) return c.json({ error: "already exists" }, 409);
    throw e;
  }
  return c.json({ ok: true });
});

wordRoutes.delete("/api/words/:id", requireUser, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const w = await c.env.DB.prepare("SELECT id FROM words WHERE id = ? AND user_id = ?").bind(id, userId).first();
  if (!w) return c.json({ error: "not found" }, 404);
  if (c.req.query("confirm") !== "1") {
    const used = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM sentence_words WHERE word_id = ?")
      .bind(id)
      .first<{ n: number }>();
    if (used && used.n > 0) return c.json({ usedInSentences: used.n });
  }
  // set_words / sentence_words / round_tests は ON DELETE CASCADE。文章本体は残る
  await c.env.DB.prepare("DELETE FROM words WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return c.json({ ok: true });
});
