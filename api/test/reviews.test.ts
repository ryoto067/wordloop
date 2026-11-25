import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { addDays, localDate } from "../src/domain/dates";
import { call, login } from "./helpers";

const today = () => localDate(new Date(), "Asia/Tokyo");
let alice: { cookie: string };
let bob: { cookie: string };
let aliceId: string;
let bobId: string;
let seq = 0;

const userId = async (email: string) =>
  (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<any>()).id as string;

beforeAll(async () => {
  alice = await login("alice-reviews@example.com");
  bob = await login("bob-reviews@example.com");
  aliceId = await userId("alice-reviews@example.com");
  bobId = await userId("bob-reviews@example.com");
});

type Opts = Partial<{ stage: number; anchor: string; next: string; status: string }>;
async function addWord(uid: string, english: string, o: Opts = {}) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO words (id, user_id, english, japanese, stage, anchor_on, next_review_on, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, uid, english, `${english}-ja`, o.stage ?? 0, o.anchor ?? addDays(today(), -1), o.next ?? today(), o.status ?? "reviewing")
    .run();
  return id;
}
async function addSentence(uid: string, o: Opts = {}) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO sentences (id, user_id, english_marked, japanese_text, stage, anchor_on, next_review_on, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, uid, "I [eat] apples.", "私はりんごを食べる", o.stage ?? 0, o.anchor ?? addDays(today(), -3), o.next ?? today(), o.status ?? "reviewing")
    .run();
  return id;
}
const item = (id: string, result: "remembered" | "forgot" = "remembered", extra: object = {}) => ({
  clientId: `c-${++seq}`,
  kind: "word" as const,
  id,
  result,
  reviewedAt: new Date().toISOString(),
  ...extra,
});
const post = (who: { cookie: string }, items: unknown) => call(who, "POST", "/api/reviews", { items });
const word = (id: string) =>
  env.DB.prepare("SELECT stage, anchor_on, next_review_on, status FROM words WHERE id = ?").bind(id).first<any>();
const act = (uid: string, date: string) =>
  env.DB.prepare("SELECT reviews_done, cleared_all FROM daily_activity WHERE user_id = ? AND date = ?").bind(uid, date).first<any>();

describe("GET /api/reviews/today", () => {
  it("未ログインは 401", async () => {
    expect((await call(null, "GET", "/api/reviews/today")).status).toBe(401);
  });

  it("期日分のみ・古い順、stageDays と mode（30 以上は recall）", async () => {
    const u = await login("carol-reviews@example.com");
    const cid = await userId("carol-reviews@example.com");
    const t = today();
    const w1 = await addWord(cid, "newer", { next: t, stage: 1 });
    const w0 = await addWord(cid, "older", { next: addDays(t, -2), stage: 0 });
    await addWord(cid, "future", { next: addDays(t, 1) });
    await addWord(cid, "waiting", { status: "waiting_sentence" });
    const s60 = await addSentence(cid, { stage: 4, next: addDays(t, -1) }); // intervals[4] = 60
    const s14 = await addSentence(cid, { stage: 2, next: t }); // 14
    const s30 = await addSentence(cid, { stage: 3, next: t }); // 30
    await addSentence(cid, { status: "mastered" });
    const body = (await (await call(u, "GET", "/api/reviews/today")).json()) as any;
    expect(body.words.map((w: any) => w.id)).toEqual([w0, w1]);
    expect(body.words[1]).toMatchObject({ english: "newer", japanese: "newer-ja", stage: 1, stageDays: 3 });
    expect(body.sentences.map((s: any) => s.id)).toEqual([s60, s14, s30]);
    expect(body.sentences.map((s: any) => s.mode)).toEqual(["recall", "cloze", "recall"]);
    expect(body.sentences[1]).toMatchObject({ englishMarked: "I [eat] apples.", japanese: "私はりんごを食べる", stage: 2 });
  });
});

describe("POST /api/reviews", () => {
  it("期日 2 語を remembered → next 更新、cleared_all = 1、streak を返す", async () => {
    const a = await addWord(aliceId, "r-a");
    const b = await addWord(aliceId, "r-b");
    const res = await post(alice, [item(a), item(b)]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ applied: 2, skipped: 0 });
    expect(typeof body.streak).toBe("number");
    const w = await word(a);
    expect(w).toMatchObject({ stage: 1, status: "reviewing" });
    expect(w.next_review_on).toBe(addDays(addDays(today(), -1), 3));
    expect(await act(aliceId, today())).toMatchObject({ reviews_done: 2, cleared_all: 1 });
  });

  it("同じ clientId を 2 回送っても 1 回分のみ反映", async () => {
    const w = await addWord(aliceId, "idem");
    const it1 = item(w);
    const before = (await act(aliceId, today())).reviews_done;
    expect(((await (await post(alice, [it1])).json()) as any).applied).toBe(1);
    const again = (await (await post(alice, [it1, it1])).json()) as any;
    expect(again).toMatchObject({ applied: 0, skipped: 2 });
    expect((await word(w)).stage).toBe(1);
    expect((await act(aliceId, today())).reviews_done).toBe(before + 1);
  });

  it("昨日（JST）の reviewedAt は昨日の daily_activity に入る", async () => {
    const y = addDays(today(), -1);
    const w = await addWord(aliceId, "late", { anchor: addDays(y, -1), next: y });
    const reviewedAt = new Date(`${y}T12:00:00+09:00`).toISOString();
    await post(alice, [item(w, "remembered", { reviewedAt })]);
    expect((await act(aliceId, y)).reviews_done).toBe(1);
    const rv = await env.DB.prepare("SELECT reviewed_on FROM word_reviews WHERE word_id = ?").bind(w).first<any>();
    expect(rv.reviewed_on).toBe(y);
  });

  it("reviewedAt の古い順に適用する（結果が順序に依存する 2 件）", async () => {
    const t = today();
    const y = addDays(t, -1);
    const w = await addWord(aliceId, "ordered", { stage: 2, anchor: addDays(t, -10), next: y });
    const early = item(w, "remembered", { reviewedAt: new Date(`${y}T12:00:00+09:00`).toISOString() });
    const late = item(w, "forgot", { reviewedAt: new Date(`${t}T12:00:00+09:00`).toISOString() });
    // 新しい順で送る。正: remembered(昨日) stage 3 → forgot(今日) stage 2・anchor 今日・next 今日+7
    await post(alice, [late, early]);
    expect(await word(w)).toMatchObject({ stage: 2, anchor_on: t, next_review_on: addDays(t, 7) });
    const rows = await env.DB.prepare("SELECT client_id, prev_stage FROM word_reviews WHERE word_id = ?").bind(w).all<any>();
    const prevOf = (cid: string) => rows.results.find((r) => r.client_id === cid).prev_stage;
    expect(prevOf(early.clientId)).toBe(2);
    expect(prevOf(late.clientId)).toBe(3);
  });

  it("同じ clientId が 1 回の新規バッチに 2 件あっても 1 回だけ適用", async () => {
    const w = await addWord(aliceId, "dup-batch");
    const it1 = item(w);
    const body = (await (await post(alice, [it1, { ...it1 }])).json()) as any;
    expect(body).toMatchObject({ applied: 1, skipped: 1 });
    expect((await word(w)).stage).toBe(1);
  });

  it("101 件以上は 400", async () => {
    const w = await addWord(aliceId, "many");
    const res = await post(alice, Array.from({ length: 101 }, () => item(w)));
    expect(res.status).toBe(400);
  });

  it("最終段階を remembered → waiting_sentence", async () => {
    const w = await addWord(aliceId, "grad", { stage: 4, anchor: addDays(today(), -30) });
    await post(alice, [item(w)]);
    expect((await word(w)).status).toBe("waiting_sentence");
  });

  it("文章: graduated → mastered、mode を記録", async () => {
    const s = await addSentence(aliceId, { stage: 4 });
    const res = await post(alice, [item(s, "remembered", { kind: "sentence" })]);
    expect(((await res.json()) as any).applied).toBe(1);
    const row = await env.DB.prepare("SELECT status FROM sentences WHERE id = ?").bind(s).first<any>();
    expect(row.status).toBe("mastered");
    const rv = await env.DB.prepare("SELECT mode FROM sentence_reviews WHERE sentence_id = ?").bind(s).first<any>();
    expect(rv.mode).toBe("recall");
  });

  it("不正な項目（他人の id・不明 id・reviewing 以外）は skipped、他は適用", async () => {
    const mine = await addWord(aliceId, "mine");
    const theirs = await addWord(bobId, "theirs");
    const waiting = await addWord(aliceId, "wait-x", { status: "waiting_sentence" });
    const res = await post(alice, [item(theirs), item("nope"), item(waiting), item(mine)]);
    expect(await res.json()).toMatchObject({ applied: 1, skipped: 3 });
    expect((await word(theirs)).stage).toBe(0);
  });

  it("不正なボディは 400、未ログインは 401", async () => {
    expect((await post(alice, "x")).status).toBe(400);
    expect((await call(alice, "POST", "/api/reviews", {})).status).toBe(400);
    expect((await post(alice, [item("a", "bad" as any)])).status).toBe(400);
    expect((await post(alice, [item("a", "remembered", { reviewedAt: "garbage" })])).status).toBe(400);
    expect((await post(alice, [item("a", "remembered", { kind: "x" })])).status).toBe(400);
    expect((await call(null, "POST", "/api/reviews", { items: [] })).status).toBe(401);
  });

  it("まだ期日のカードが残る日は cleared_all を立てない", async () => {
    const u = await login("dave-reviews@example.com");
    const did = await userId("dave-reviews@example.com");
    const a = await addWord(did, "d-a");
    await addWord(did, "d-b");
    await post(u, [item(a)]);
    expect((await act(did, today())).cleared_all).toBe(0);
  });
});

describe("POST /api/reviews/undo", () => {
  it("直前の 1 件を採点前に戻し、reviews_done を 1 減らし、cleared_all を再計算", async () => {
    const w = await addWord(aliceId, "undo-me");
    const it1 = item(w);
    const before = await word(w);
    await post(alice, [it1]);
    const done = (await act(aliceId, today())).reviews_done;
    const res = await call(alice, "POST", "/api/reviews/undo", { clientId: it1.clientId });
    expect(res.status).toBe(200);
    expect(await word(w)).toEqual(before);
    const d = await act(aliceId, today());
    expect(d.reviews_done).toBe(done - 1);
    expect(d.cleared_all).toBe(0);
    expect(await env.DB.prepare("SELECT 1 FROM word_reviews WHERE client_id = ?").bind(it1.clientId).first()).toBeNull();
  });

  it("最新でない採点の undo は 409、不明・他人の clientId は 404、clientId なしは 400", async () => {
    const w = await addWord(aliceId, "undo-old", { stage: 1 });
    const first = item(w, "forgot", { reviewedAt: new Date(Date.now() - 1000).toISOString() });
    const second = item(w, "remembered");
    await post(alice, [first, second]);
    expect((await call(alice, "POST", "/api/reviews/undo", { clientId: first.clientId })).status).toBe(409);
    expect((await call(bob, "POST", "/api/reviews/undo", { clientId: second.clientId })).status).toBe(404);
    expect((await call(alice, "POST", "/api/reviews/undo", { clientId: "none" })).status).toBe(404);
    expect((await call(alice, "POST", "/api/reviews/undo", {})).status).toBe(400);
    expect((await call(alice, "POST", "/api/reviews/undo", null)).status).toBe(400);
  });

  it("文章の最終段階 undo で status が reviewing に戻る", async () => {
    const s = await addSentence(aliceId, { stage: 4 });
    const it1 = item(s, "remembered", { kind: "sentence" });
    await post(alice, [it1]);
    await call(alice, "POST", "/api/reviews/undo", { clientId: it1.clientId });
    const row = await env.DB.prepare("SELECT status, stage FROM sentences WHERE id = ?").bind(s).first<any>();
    expect(row).toMatchObject({ status: "reviewing", stage: 4 });
  });
});
