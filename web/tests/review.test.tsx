import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (k: string) => store.get(k),
  set: async (k: string, v: unknown) => void store.set(k, v),
  del: async (k: string) => void store.delete(k),
}));

import { REVIEWS_TODAY_KEY, MeProvider, ME_CACHE_KEY, clearMeCache, type Me } from "../src/lib/MeContext";
import { list } from "../src/lib/offlineQueue";
import { Review } from "../src/pages/Review";

const me: Me = {
  id: "u1", name: "t", email: "t@example.com", timezone: "Asia/Tokyo", wordIntervals: [1], sentenceIntervals: [3],
  fontScale: 1, streak: 7, today: { dueWords: 2, dueSentences: 0, waitingWords: 0, doneToday: false },
};
const today = {
  words: [
    { id: "w1", english: "adapt", japanese: "適応する", stage: 1, stageDays: 1 },
    { id: "w2", english: "abandon", japanese: "断念する", stage: 2, stageDays: 3 },
  ],
  sentences: [],
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

let online = true;
let calls: { path: string; body: any }[] = [];
let undoStatus = 200;

beforeEach(() => {
  store.clear();
  localStorage.clear();
  localStorage.setItem(ME_CACHE_KEY, JSON.stringify(me));
  online = true;
  calls = [];
  undoStatus = 200;
  vi.stubGlobal("location", { assign: vi.fn(), pathname: "/review" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      if (!online) throw new TypeError("offline");
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      if (path === "/api/me") return json(me);
      if (path === "/api/reviews/today") return json(today);
      if (path === "/api/reviews") return json({ applied: body.items.length, skipped: 0, streak: 8 });
      if (path === "/api/reviews/undo") return json({}, undoStatus);
      return json({}, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderReview() {
  render(
    <MemoryRouter>
      <MeProvider>
        <Review />
      </MeProvider>
    </MemoryRouter>,
  );
}
const flip = async (word: string) => {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(word) }));
};

describe("Review", () => {
  it("めくる前は判定ボタンが無効で、めくると押せる", async () => {
    renderReview();
    await screen.findByText("REVIEW ・ 1 / 2");
    expect(screen.getByText("1日目の復習")).toBeTruthy();
    expect((screen.getByRole("button", { name: "覚えてた" }) as HTMLButtonElement).disabled).toBe(true);
    await flip("adapt");
    expect((screen.getByRole("button", { name: "覚えてた" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("全部答えると送信され、完了画面で連続日数が +1 される", async () => {
    renderReview();
    await flip("adapt");
    fireEvent.click(screen.getByRole("button", { name: "覚えてた" }));
    await flip("abandon");
    fireEvent.click(screen.getByRole("button", { name: "忘れてた" }));
    await screen.findByText("今日の復習、完了！");
    await waitFor(() => expect(screen.getByTestId("streak").textContent).toContain("8"));
    const posts = calls.filter((c) => c.path === "/api/reviews");
    expect(posts.flatMap((p) => p.body.items.map((i: any) => i.id)).sort()).toEqual(["w1", "w2"]);
    expect(await list()).toHaveLength(0);
  });

  it("オフラインではキャッシュのカードを出し、答えは送信待ちに残る", async () => {
    localStorage.setItem(REVIEWS_TODAY_KEY, JSON.stringify(today));
    online = false;
    renderReview();
    await flip("adapt");
    fireEvent.click(screen.getByRole("button", { name: "覚えてた" }));
    await screen.findByText("REVIEW ・ 2 / 2");
    await waitFor(async () => expect(await list()).toHaveLength(1));
    cleanup();
    renderReview(); // 開き直すと答え済みのカードは出ない
    await screen.findByText("REVIEW ・ 1 / 1");
  });

  it("送信前なら ↶ でキューから外れ、カードが戻る", async () => {
    online = false;
    localStorage.setItem(REVIEWS_TODAY_KEY, JSON.stringify(today));
    renderReview();
    await flip("adapt");
    fireEvent.click(screen.getByRole("button", { name: "覚えてた" }));
    await screen.findByText("REVIEW ・ 2 / 2");
    await waitFor(async () => expect(await list()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /1つ戻す/ }));
    await screen.findByText("REVIEW ・ 1 / 2");
    expect(await list()).toHaveLength(0);
  });

  it("送信済みなら /api/reviews/undo を呼び、409 なら『取り消せませんでした』", async () => {
    renderReview();
    await flip("adapt");
    fireEvent.click(screen.getByRole("button", { name: "覚えてた" }));
    await screen.findByText("REVIEW ・ 2 / 2");
    await waitFor(() => expect(calls.some((c) => c.path === "/api/reviews")).toBe(true));
    undoStatus = 409;
    await waitFor(async () => expect(await list()).toHaveLength(0));
    fireEvent.click(screen.getByRole("button", { name: /1つ戻す/ }));
    await screen.findByText("取り消せませんでした");
    expect(screen.getByText("REVIEW ・ 2 / 2")).toBeTruthy();
    undoStatus = 200;
    fireEvent.click(screen.getByRole("button", { name: /1つ戻す/ }));
    await screen.findByText("REVIEW ・ 1 / 2");
    expect(calls.filter((c) => c.path === "/api/reviews/undo")).toHaveLength(2);
  });

  it("clearMeCache は復習キャッシュと送信待ちも消す", async () => {
    localStorage.setItem(REVIEWS_TODAY_KEY, "{}");
    store.set("wl_offline_queue", [{ id: "a" }]);
    clearMeCache();
    expect(localStorage.getItem(REVIEWS_TODAY_KEY)).toBeNull();
    await waitFor(() => expect(store.has("wl_offline_queue")).toBe(false));
  });
});
