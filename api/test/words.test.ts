import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { call, login } from "./helpers";

const first = (words: { english: string; japanese: string }[]) => ({
  startedAt: new Date().toISOString(), durationSec: 60, words, linkExisting: [],
});

let alice: { cookie: string };
let bob: { cookie: string };
beforeAll(async () => {
  alice = await login("alice-words@example.com");
  bob = await login("bob-words@example.com");
  await call(alice, "POST", "/api/rounds/first", first([
    { english: "zebra", japanese: "シマウマ" }, { english: "zoo", japanese: "動物園" },
  ]));
});

describe("POST /api/words/check", () => {
  it("登録済みの語と所属セット名を返す（正規化して照合）", async () => {
    const res = await call(alice, "POST", "/api/words/check", { english: [" ZEBRA ", "unknown"] });
    const body = (await res.json()) as any;
    expect(body.existing).toHaveLength(1);
    expect(body.existing[0]).toMatchObject({ english: "zebra" });
    expect(body.existing[0].wordId).toBeTruthy();
    expect(body.existing[0].setNames).toHaveLength(1);
  });
  it("他人の語は見えない", async () => {
    const body = (await (await call(bob, "POST", "/api/words/check", { english: ["zebra"] })).json()) as any;
    expect(body.existing).toEqual([]);
  });
});

describe("GET/PATCH/DELETE /api/words", () => {
  it("q で絞り込める", async () => {
    const list = (await (await call(alice, "GET", "/api/words?q=zeb")).json()) as any[];
    expect(list.map((w) => w.english)).toEqual(["zebra"]);
  });

  it("PATCH は正規化して更新、空は 400、重複は 409、他人の語は 404", async () => {
    const [w] = (await (await call(alice, "GET", "/api/words?q=zoo")).json()) as any[];
    expect((await call(alice, "PATCH", `/api/words/${w.id}`, { english: " " })).status).toBe(400);
    expect((await call(alice, "PATCH", `/api/words/${w.id}`, { english: "Zebra" })).status).toBe(409);
    expect((await call(bob, "PATCH", `/api/words/${w.id}`, { japanese: "x" })).status).toBe(404);
    expect((await call(alice, "PATCH", `/api/words/${w.id}`, { english: " Zoos ", japanese: "動物園たち" })).status).toBe(200);
    const row = await env.DB.prepare("SELECT english, japanese FROM words WHERE id = ?").bind(w.id).first<any>();
    expect(row).toEqual({ english: "zoos", japanese: "動物園たち" });
  });

  it("DELETE: 他人は 404、文章に使用中なら件数を返し confirm=1 で削除（文章は残る）", async () => {
    const [w] = (await (await call(alice, "GET", "/api/words?q=zebra")).json()) as any[];
    const uid = (await env.DB.prepare("SELECT id FROM users WHERE email = 'alice-words@example.com'").first<any>()).id;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sentences (id, user_id, english_marked, japanese_text, anchor_on) VALUES ('s1', ?, 'a', 'b', '2026-11-25')").bind(uid),
      env.DB.prepare("INSERT INTO sentence_words (sentence_id, word_id) VALUES ('s1', ?)").bind(w.id),
    ]);
    expect((await call(bob, "DELETE", `/api/words/${w.id}?confirm=1`)).status).toBe(404);
    expect(await (await call(alice, "DELETE", `/api/words/${w.id}`)).json()).toEqual({ usedInSentences: 1 });
    expect(await env.DB.prepare("SELECT 1 FROM words WHERE id = ?").bind(w.id).first()).not.toBeNull();
    expect((await call(alice, "DELETE", `/api/words/${w.id}?confirm=1`)).status).toBe(200);
    expect(await env.DB.prepare("SELECT 1 FROM words WHERE id = ?").bind(w.id).first()).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM sentences WHERE id = 's1'").first()).not.toBeNull();
  });

  it("使われていない語は確認なしで削除できる", async () => {
    const [w] = (await (await call(alice, "GET", "/api/words?q=zoos")).json()) as any[];
    expect((await call(alice, "DELETE", `/api/words/${w.id}`)).status).toBe(200);
  });
});
