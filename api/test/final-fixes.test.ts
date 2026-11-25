import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setTextGenOverride } from "../src/ai/provider";
import { addDays, localDate } from "../src/domain/dates";
import { app } from "../src/index";
import { call, callCounting, login } from "./helpers";

const today = () => localDate(new Date(), "Asia/Tokyo");
const first = (words: { english: string; japanese: string }[], extra: object = {}) => ({
  startedAt: new Date().toISOString(),
  durationSec: 600,
  words,
  linkExisting: [],
  ...extra,
});
const userId = async (email: string) =>
  ((await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first()) as any).id as string;

afterEach(() => {
  setTextGenOverride(null);
  vi.restoreAllMocks();
});

describe("D1 クエリ数は語数に比例しない（Workers Free は 1 リクエスト 50 クエリまで）", () => {
  const sixty = Array.from({ length: 60 }, (_, i) => ({ english: `bulk${String(i).padStart(2, "0")}`, japanese: `語${i}` }));

  it("rounds/first と results は 60 語でも ≤ 6 クエリ。再送は二重に進めない", async () => {
    const u = await login("bulk-rounds@example.com");
    const f = await callCounting(u, "POST", "/api/rounds/first", first(sixty));
    expect(f.res.status).toBe(200);
    expect(f.queries).toBeLessThanOrEqual(6);
    const setId = ((await f.res.json()) as any).setId;
    const nb = (await (await call(u, "POST", "/api/rounds/next", { setId, roundNo: 2, startedAt: new Date().toISOString(), durationSec: 1 })).json()) as any;
    const results = nb.words.map((w: any, i: number) => ({ wordId: w.id, result: i % 2 ? "forgot" : "remembered" }));
    const r = await callCounting(u, "POST", `/api/rounds/${nb.roundId}/results`, { results });
    expect(await r.res.json()).toEqual({ remembered: 30, forgot: 30 });
    expect(r.queries).toBeLessThanOrEqual(6);
    const again = await callCounting(u, "POST", `/api/rounds/${nb.roundId}/results`, { results });
    expect(await again.res.json()).toEqual({ remembered: 0, forgot: 0 });
  });

  it("words/check も 60 語で ≤ 6 クエリ", async () => {
    const u = await login("bulk-rounds@example.com");
    const c = await callCounting(u, "POST", "/api/words/check", { english: sixty.map((w) => w.english) });
    expect(((await c.res.json()) as any).existing).toHaveLength(60);
    expect(c.queries).toBeLessThanOrEqual(6);
  });

  it("results は不明な語 ID を無視して残りを処理する（404 にしない）", async () => {
    const u = await login("skip-rounds@example.com");
    const f = (await (await call(u, "POST", "/api/rounds/first", first([{ english: "sk1", japanese: "あ" }]))).json()) as any;
    const nb = (await (await call(u, "POST", "/api/rounds/next", { setId: f.setId, roundNo: 2, startedAt: new Date().toISOString(), durationSec: 1 })).json()) as any;
    const r = await call(u, "POST", `/api/rounds/${nb.roundId}/results`, {
      results: [{ wordId: "ghost", result: "forgot" }, { wordId: nb.words[0].id, result: "remembered" }],
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ remembered: 1, forgot: 0 });
  });
});

describe("周回の日付は終了時刻の現地日付", () => {
  it("昨日 23:50 JST に始めて今日同期 → 昨日扱い（did_round・anchor・セット名）", async () => {
    const u = await login("late-rounds@example.com");
    const uid = await userId("late-rounds@example.com");
    const y = addDays(today(), -1);
    const startedAt = new Date(`${y}T23:50:00+09:00`).toISOString();
    const res = await call(u, "POST", "/api/rounds/first", {
      startedAt, durationSec: 300, words: [{ english: "late1", japanese: "あ" }], linkExisting: [],
    });
    expect(res.status).toBe(200);
    const act = await env.DB.prepare("SELECT did_round FROM daily_activity WHERE user_id = ? AND date = ?").bind(uid, y).first<any>();
    expect(act?.did_round).toBe(1);
    const w = await env.DB.prepare("SELECT anchor_on, next_review_on FROM words WHERE user_id = ?").bind(uid).first<any>();
    expect(w).toEqual({ anchor_on: y, next_review_on: addDays(y, 1) });
    const [, m, d] = y.split("-").map(Number);
    const sets = (await (await call(u, "GET", "/api/sets")).json()) as any[];
    expect(sets[0].name).toBe(`${m}/${d} セット`);

    const y2 = addDays(y, -1);
    await call(u, "POST", "/api/rounds/next", {
      setId: sets[0].id, roundNo: 2, startedAt: new Date(`${y2}T23:50:00+09:00`).toISOString(), durationSec: 60,
    });
    const d2 = await env.DB.prepare("SELECT did_round FROM daily_activity WHERE user_id = ? AND date = ?").bind(uid, y2).first<any>();
    expect(d2?.did_round).toBe(1);
  });

  it("範囲外（未来・8 日以上前）は今日", async () => {
    const u = await login("clamp-rounds@example.com");
    const uid = await userId("clamp-rounds@example.com");
    await call(u, "POST", "/api/rounds/first", {
      startedAt: new Date(Date.now() + 3 * 86400_000).toISOString(), durationSec: 0, words: [{ english: "cl1", japanese: "あ" }], linkExisting: [],
    });
    await call(u, "POST", "/api/rounds/first", {
      startedAt: new Date(Date.now() - 30 * 86400_000).toISOString(), durationSec: 0, words: [{ english: "cl2", japanese: "あ" }], linkExisting: [],
    });
    const rows = await env.DB.prepare("SELECT anchor_on FROM words WHERE user_id = ?").bind(uid).all<any>();
    expect(rows.results.map((r: any) => r.anchor_on)).toEqual([today(), today()]);
  });
});

describe("復習: 期日前のカードは適用しない", () => {
  it("next_review_on が復習日より後なら skipped（別端末で先に進んだ分の二重適用防止）", async () => {
    const u = await login("future-rev@example.com");
    const uid = await userId("future-rev@example.com");
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO words (id, user_id, english, japanese, stage, anchor_on, next_review_on, status) VALUES (?, ?, 'fc', 'あ', 1, ?, ?, 'reviewing')",
    ).bind(id, uid, today(), addDays(today(), 3)).run();
    const res = await call(u, "POST", "/api/reviews", {
      items: [{ clientId: "fut-1", kind: "word", id, result: "remembered", reviewedAt: new Date().toISOString() }],
    });
    expect(await res.json()).toMatchObject({ applied: 0, skipped: 1 });
    const w = await env.DB.prepare("SELECT stage, next_review_on FROM words WHERE id = ?").bind(id).first<any>();
    expect(w).toEqual({ stage: 1, next_review_on: addDays(today(), 3) });
  });
});

describe("文章: AI 障害・保存失敗", () => {
  let u: { cookie: string };
  let uid: string;
  beforeAll(async () => {
    u = await login("fail-sent@example.com");
    uid = await userId("fail-sent@example.com");
    for (let i = 0; i < 5; i++) {
      await env.DB.prepare(
        "INSERT INTO words (id, user_id, english, japanese, anchor_on, next_review_on, status) VALUES (?, ?, ?, 'あ', ?, NULL, 'waiting_sentence')",
      ).bind(crypto.randomUUID(), uid, `fw${i}`, today()).run();
    }
  });

  it("AI の通信・クォータ障害は 503 ai_unavailable で、回数は返却される", async () => {
    setTextGenOverride({ complete: async () => { throw new Error("quota exceeded"); } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call(u, "POST", "/api/sentences/generate", {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ai_unavailable" });
    const w = (await (await call(u, "GET", "/api/sentences/waiting")).json()) as any;
    expect(w.remainingToday).toBe(10);
    const row = await env.DB.prepare("SELECT count FROM ai_usage WHERE user_id = ?").bind(uid).first<any>();
    expect(row.count).toBe(0);
  });

  it("UNIQUE 以外の保存エラーは 500 save_failed（409 にしない）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const word = await env.DB.prepare("SELECT id, english FROM words WHERE user_id = ? LIMIT 1").bind(uid).first<any>();
    const db: any = new Proxy(env.DB, {
      get(t: any, k) {
        if (k === "batch") return async () => { throw new Error("D1_ERROR: network connection lost"); };
        const v = t[k];
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const res = await app.request(
      "http://localhost:5173/api/sentences",
      {
        method: "POST",
        headers: { cookie: u.cookie, "content-type": "application/json" },
        body: JSON.stringify({ englishMarked: `[[${word.english}|${word.english}]]`, japanese: "訳", wordIds: [word.id] }),
      },
      { ...env, DB: db },
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "save_failed" });
  });
});
