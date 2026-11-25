import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { call, login } from "./helpers";

let alice: { cookie: string };
let bob: { cookie: string };
let aliceId: string;
let bobId: string;
beforeAll(async () => {
  alice = await login("alice-records@example.com");
  bob = await login("bob-records@example.com");
  aliceId = (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind("alice-records@example.com").first<{ id: string }>())!.id;
  bobId = (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind("bob-records@example.com").first<{ id: string }>())!.id;
});

describe("GET /api/sets/:id/rounds", () => {
  it("未ログインは 401、他人・存在しないセットは 404", async () => {
    expect((await call(null, "GET", "/api/sets/x/rounds")).status).toBe(401);
    expect((await call(alice, "GET", "/api/sets/nope/rounds")).status).toBe(404);
  });

  it("周回ごとの時間とテスト結果（1周目は 0/0）を周回順に返す", async () => {
    const first = await call(alice, "POST", "/api/rounds/first", {
      startedAt: "2025-03-01T00:00:00.000Z",
      durationSec: 300,
      words: [
        { english: "rec-a", japanese: "あ" },
        { english: "rec-b", japanese: "い" },
        { english: "rec-c", japanese: "う" },
      ],
      linkExisting: [],
    });
    const { setId } = (await first.json()) as { setId: string };
    const next = await call(alice, "POST", "/api/rounds/next", {
      setId,
      roundNo: 2,
      startedAt: "2025-03-02T00:00:00.000Z",
      durationSec: 120,
    });
    const { roundId, words } = (await next.json()) as { roundId: string; words: { id: string }[] };
    await call(alice, "POST", `/api/rounds/${roundId}/results`, {
      results: words.map((w, i) => ({ wordId: w.id, result: i === 0 ? "forgot" : "remembered" })),
    });

    const res = await call(alice, "GET", `/api/sets/${setId}/rounds`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { roundNo: 1, startedAt: "2025-03-01T00:00:00.000Z", durationSec: 300, remembered: 0, forgot: 0 },
      { roundNo: 2, startedAt: "2025-03-02T00:00:00.000Z", durationSec: 120, remembered: 2, forgot: 1 },
    ]);
    expect((await call(bob, "GET", `/api/sets/${setId}/rounds`)).status).toBe(404);
  });
});

describe("GET /api/activity", () => {
  it("未ログインは 401、月の形式が不正なら 400", async () => {
    expect((await call(null, "GET", "/api/activity?month=2025-03")).status).toBe(401);
    for (const m of ["", "2026-13", "2026-1", "abc", "2026-00"]) {
      expect((await call(alice, "GET", `/api/activity?month=${m}`)).status).toBe(400);
    }
    expect((await call(alice, "GET", "/api/activity")).status).toBe(400);
  });

  it("その月の日ごとの達成を返し、他人のデータや他の月は含まない", async () => {
    const ins = (u: string, date: string, r: number, n: number, c: number) =>
      env.DB.prepare("INSERT INTO daily_activity (user_id, date, did_round, reviews_done, cleared_all) VALUES (?, ?, ?, ?, ?)")
        .bind(u, date, r, n, c)
        .run();
    await ins(aliceId, "2025-02-28", 1, 0, 0);
    await ins(aliceId, "2025-03-03", 1, 0, 0); // 周回
    await ins(aliceId, "2025-03-04", 0, 5, 0); // 未達成
    await ins(aliceId, "2025-03-05", 0, 20, 0); // 20 件
    await ins(aliceId, "2025-03-06", 0, 0, 1); // 全消化
    await ins(bobId, "2025-03-07", 1, 0, 0);
    const res = await call(alice, "GET", "/api/activity?month=2025-03");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { date: "2025-03-03", achieved: true },
      { date: "2025-03-04", achieved: false },
      { date: "2025-03-05", achieved: true },
      { date: "2025-03-06", achieved: true },
    ]);
  });
});
