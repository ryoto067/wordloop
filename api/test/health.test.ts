import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const TABLES = [
  "users", "sessions", "word_sets", "set_words", "study_rounds", "round_tests",
  "words", "word_reviews", "sentences", "sentence_words", "sentence_reviews",
  "push_subscriptions", "notify_times", "daily_activity", "ai_usage",
];

describe("health", () => {
  it("GET /api/health は 200 { ok: true }", async () => {
    const res = await exports.default.fetch("http://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("マイグレーション適用後に 15 テーブルがすべて存在する", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ).all<{ name: string }>();
    const names = results.map((r) => r.name);
    for (const t of TABLES) expect(names).toContain(t);
  });
});
