import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { addDays, localDate } from "../src/domain/dates";
import { call, login } from "./helpers";

const today = () => localDate(new Date(), "Asia/Tokyo");
const first = (words: { english: string; japanese: string }[], extra: object = {}) => ({
  startedAt: new Date().toISOString(),
  durationSec: 600,
  words,
  linkExisting: [],
  ...extra,
});

let alice: { cookie: string };
let bob: { cookie: string };
beforeAll(async () => {
  alice = await login("alice-rounds@example.com");
  bob = await login("bob-rounds@example.com");
});

describe("POST /api/rounds/first", () => {
  it("未ログインは 401", async () => {
    expect((await call(null, "POST", "/api/rounds/first", first([]))).status).toBe(401);
    expect((await call(null, "GET", "/api/sets")).status).toBe(401);
  });

  it("3 語登録 → 3 語とも next = today+1、セット名は M/D セット、did_round = 1", async () => {
    const res = await call(alice, "POST", "/api/rounds/first", first([
      { english: "apple", japanese: "りんご" },
      { english: " Banana ", japanese: " バナナ " },
      { english: "cherry", japanese: "さくらんぼ" },
    ]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ roundNo: 1, created: 3, linked: 0, skipped: 0 });
    const t = today();
    for (const e of ["apple", "banana", "cherry"]) {
      const w = await env.DB.prepare("SELECT stage, anchor_on, next_review_on, status FROM words WHERE english = ?").bind(e).first<any>();
      expect(w).toMatchObject({ stage: 0, anchor_on: t, next_review_on: addDays(t, 1), status: "reviewing" });
    }
    const set = await env.DB.prepare("SELECT name FROM word_sets WHERE id = ?").bind(body.setId).first<any>();
    const [, m, d] = t.split("-").map(Number);
    expect(set.name).toBe(`${m}/${d} セット`);
    const act = await env.DB.prepare("SELECT did_round FROM daily_activity WHERE date = ? AND user_id = (SELECT id FROM users WHERE email = 'alice-rounds@example.com')").bind(t).first<any>();
    expect(act.did_round).toBe(1);
    const jp = await env.DB.prepare("SELECT japanese FROM words WHERE english = 'banana'").first<any>();
    expect(jp.japanese).toBe("バナナ");
  });

  it("同じ語（大文字・空白違い）の再登録は skipped、進み具合は不変、linkExisting で linked", async () => {
    await env.DB.prepare("UPDATE words SET stage = 2, anchor_on = '2026-01-01', next_review_on = '2026-01-08' WHERE english = 'apple'").run();
    const res = await call(alice, "POST", "/api/rounds/first", first([
      { english: " Abandon ", japanese: "捨てる" },
      { english: " APPLE ", japanese: "x" },
      { english: "banana", japanese: "y" },
    ], { linkExisting: ["Banana"] }));
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ created: 1, linked: 1, skipped: 1 });
    const w = await env.DB.prepare("SELECT stage, anchor_on, next_review_on, japanese FROM words WHERE english = 'apple'").first<any>();
    expect(w).toMatchObject({ stage: 2, anchor_on: "2026-01-01", next_review_on: "2026-01-08", japanese: "りんご" });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM set_words WHERE set_id = ?").bind(body.setId).first<any>();
    expect(n.n).toBe(2);
  });

  it("同日 2 個目・3 個目のセット名は ②・③", async () => {
    const c = await login("carol-rounds@example.com");
    for (const e of ["one", "two", "three"]) {
      await call(c, "POST", "/api/rounds/first", first([{ english: e, japanese: e }]));
    }
    const sets = (await (await call(c, "GET", "/api/sets")).json()) as any[];
    const [, m, d] = today().split("-").map(Number);
    expect(sets.map((s) => s.name).sort()).toEqual([`${m}/${d} セット`, `${m}/${d} セット②`, `${m}/${d} セット③`].sort());
  });

  it("空の英語・日本語・空配列は 400", async () => {
    expect((await call(alice, "POST", "/api/rounds/first", first([{ english: "  ", japanese: "a" }]))).status).toBe(400);
    expect((await call(alice, "POST", "/api/rounds/first", first([{ english: "a", japanese: " " }]))).status).toBe(400);
    expect((await call(alice, "POST", "/api/rounds/first", first([]))).status).toBe(400);
  });
});

describe("GET /api/sets", () => {
  it("新しい順で wordCount / lastRoundNo を返す", async () => {
    const d = await login("dave-rounds@example.com");
    await call(d, "POST", "/api/rounds/first", first([{ english: "d1", japanese: "a" }]));
    await call(d, "POST", "/api/rounds/first", first([{ english: "d2", japanese: "a" }, { english: "d3", japanese: "b" }]));
    const sets = (await (await call(d, "GET", "/api/sets")).json()) as any[];
    expect(sets).toHaveLength(2);
    expect(sets[0]).toMatchObject({ wordCount: 2, lastRoundNo: 1 });
    expect(sets[1]).toMatchObject({ wordCount: 1, lastRoundNo: 1 });
    expect(sets[0].id).toBeTruthy();
    expect(sets[0].createdAt).toBeTruthy();
  });
});

describe("周回 2 以降", () => {
  it("next → results: forgot の語だけ next = today+1 / stage-1、他人の set・round は 404", async () => {
    const e = await login("erin-rounds@example.com");
    const f = (await (await call(e, "POST", "/api/rounds/first", first([
      { english: "e1", japanese: "あ" }, { english: "e2", japanese: "い" },
    ]))).json()) as any;
    const t = today();
    await env.DB.prepare("UPDATE words SET stage = 2, anchor_on = '2026-01-01', next_review_on = '2026-12-31' WHERE english = 'e1'").run();
    await env.DB.prepare("UPDATE words SET stage = 2, anchor_on = '2026-01-01', next_review_on = '2026-12-31', status = 'waiting_sentence' WHERE english = 'e2'").run();

    expect((await call(bob, "POST", "/api/rounds/next", { setId: f.setId, roundNo: 2, startedAt: new Date().toISOString(), durationSec: 5 })).status).toBe(404);
    const nx = await call(e, "POST", "/api/rounds/next", { setId: f.setId, roundNo: 2, startedAt: new Date().toISOString(), durationSec: 300 });
    expect(nx.status).toBe(200);
    const nb = (await nx.json()) as any;
    expect(nb.words.map((w: any) => w.english).sort()).toEqual(["e1", "e2"]);
    const sets = (await (await call(e, "GET", "/api/sets")).json()) as any[];
    expect(sets[0].lastRoundNo).toBe(2);

    const results = nb.words.map((w: any) => ({ wordId: w.id, result: "forgot" }));
    expect((await call(bob, "POST", `/api/rounds/${nb.roundId}/results`, { results })).status).toBe(404);
    const r = await call(e, "POST", `/api/rounds/${nb.roundId}/results`, { results });
    expect(await r.json()).toEqual({ remembered: 0, forgot: 2 });
    const w1 = await env.DB.prepare("SELECT stage, anchor_on, next_review_on FROM words WHERE english = 'e1'").first<any>();
    expect(w1).toEqual({ stage: 1, anchor_on: t, next_review_on: addDays(t, 1) });
    const w2 = await env.DB.prepare("SELECT stage, next_review_on FROM words WHERE english = 'e2'").first<any>();
    expect(w2).toEqual({ stage: 2, next_review_on: "2026-12-31" });
  });

  it("remembered は記録のみで進み具合は不変", async () => {
    const g = await login("gina-rounds@example.com");
    const f = (await (await call(g, "POST", "/api/rounds/first", first([{ english: "g1", japanese: "あ" }]))).json()) as any;
    const nb = (await (await call(g, "POST", "/api/rounds/next", { setId: f.setId, roundNo: 2, startedAt: new Date().toISOString(), durationSec: 1 })).json()) as any;
    const r = await call(g, "POST", `/api/rounds/${nb.roundId}/results`, { results: [{ wordId: nb.words[0].id, result: "remembered" }] });
    expect(await r.json()).toEqual({ remembered: 1, forgot: 0 });
    const w = await env.DB.prepare("SELECT stage, next_review_on FROM words WHERE english = 'g1'").first<any>();
    expect(w).toEqual({ stage: 0, next_review_on: addDays(today(), 1) });
  });
});
