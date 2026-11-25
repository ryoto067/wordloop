import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (k: string) => store.get(k),
  set: async (k: string, v: unknown) => void store.set(k, v),
  del: async (k: string) => void store.delete(k),
}));

import { ME_CACHE_KEY, MeProvider, REVIEWS_TODAY_KEY, type Me } from "../src/lib/MeContext";
import { ANSWERED_KEY } from "../src/lib/answered";
import { list } from "../src/lib/offlineQueue";
import { DRAFT_KEY, Sentences } from "../src/pages/Sentences";
import { SentenceReview } from "../src/pages/SentenceReview";

const me: Me = {
  id: "u1", name: "t", email: "t@example.com", timezone: "Asia/Tokyo", wordIntervals: [1], sentenceIntervals: [3],
  fontScale: 1, streak: 7, today: { dueWords: 0, dueSentences: 2, waitingWords: 5, doneToday: false },
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const waitingWords = ["a", "b", "c", "d", "e"].map((x) => ({ id: x, english: `w${x}`, japanese: x }));
const generated = { englishMarked: "She [[abandoned|abandon]] it.", japanese: "彼女はそれを諦めた。", wordIds: ["a", "b", "c", "d", "e"] };

let online = true;
let calls: { path: string; body: any }[] = [];
let handlers: Record<string, () => Response> = {};
let today: any;

beforeEach(() => {
  store.clear();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(ME_CACHE_KEY, JSON.stringify(me));
  online = true;
  calls = [];
  handlers = {};
  today = { words: [], sentences: [] };
  vi.stubGlobal("location", { assign: vi.fn(), pathname: "/sentences" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      if (!online) throw new TypeError("offline");
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      if (handlers[path]) return handlers[path]();
      if (path === "/api/me") return json(me);
      if (path === "/api/reviews/today") return json(today);
      if (path === "/api/reviews/undo") return json({});
      if (path === "/api/reviews") return json({ applied: body.items.length, skipped: 0, streak: 8 });
      if (path === "/api/sentences/waiting") return json({ words: waitingWords, canGenerate: true, remainingToday: 9 });
      if (path === "/api/sentences?status=reviewing") return json([]);
      if (path === "/api/sentences/generate") return json(generated);
      return json({}, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderPage = (el: React.ReactNode) =>
  render(
    <MemoryRouter>
      <MeProvider>{el}</MeProvider>
    </MemoryRouter>,
  );

describe("Sentences", () => {
  it("文章待ちの語と残り回数を出し、作成すると下書きがライム強調で出る（sessionStorage にも残る）", async () => {
    renderPage(<Sentences />);
    fireEvent.click(await screen.findByRole("button", { name: "AI で文章を作る（残り 9 回）" }));
    const strong = await screen.findByText("abandoned");
    expect(strong.tagName).toBe("STRONG");
    expect(screen.getByText("彼女はそれを諦めた。")).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem(`${DRAFT_KEY}:u1`)!).wordIds).toHaveLength(5);
    expect(screen.getByRole("link", { name: /文章の復習（2）/ })).toBeTruthy();
  });

  it("連打しても生成APIは1回だけ呼ばれる", async () => {
    renderPage(<Sentences />);
    const btn = await screen.findByRole("button", { name: /AI で文章を作る/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await screen.findByText("abandoned");
    expect(calls.filter((c) => c.path === "/api/sentences/generate")).toHaveLength(1);
  });

  it("再読み込み後も下書きが残る", async () => {
    sessionStorage.setItem(`${DRAFT_KEY}:u1`, JSON.stringify(generated));
    renderPage(<Sentences />);
    expect(await screen.findByText("abandoned")).toBeTruthy();
    expect(calls.some((c) => c.path === "/api/sentences/generate")).toBe(false);
  });

  it.each([
    [429, { error: "daily_limit" }, "今日の AI 作成回数（10回）を使い切りました。明日また作れます"],
    [502, { error: "ai_format" }, "AI の文章がうまく作れませんでした。もう一度お試しください（回数は1回消費されます）"],
  ])("生成が %s のときのメッセージ", async (status, body, text) => {
    handlers["/api/sentences/generate"] = () => json(body, status);
    renderPage(<Sentences />);
    fireEvent.click(await screen.findByRole("button", { name: /AI で文章を作る/ }));
    expect((await screen.findByRole("alert")).textContent).toBe(text);
  });

  it("オフラインで生成すると接続が必要と出る", async () => {
    renderPage(<Sentences />);
    const btn = await screen.findByRole("button", { name: /AI で文章を作る/ });
    online = false;
    fireEvent.click(btn);
    expect((await screen.findByRole("alert")).textContent).toBe("AI で文章を作るにはインターネット接続が必要です");
  });

  it("手直しで説明文とプレビューが出る", async () => {
    sessionStorage.setItem(`${DRAFT_KEY}:u1`, JSON.stringify(generated));
    renderPage(<Sentences />);
    fireEvent.click(await screen.findByRole("button", { name: "手直し" }));
    expect(screen.getByText("[[ ]] を消すと穴埋めに出ません")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("英文（目印つき）"), { target: { value: "Plain [[fast|fast]]." } });
    expect(screen.getByTestId("preview").querySelector("strong")?.textContent).toBe("fast");
  });

  it("保存の警告は確認ダイアログで、OKなら force=1 で再送する", async () => {
    sessionStorage.setItem(`${DRAFT_KEY}:u1`, JSON.stringify(generated));
    let first = true;
    handlers["/api/sentences"] = () => (first ? ((first = false), json({ warning: { missing: ["wb", "wc"] } })) : json({ id: "s1" }));
    handlers["/api/sentences?force=1"] = () => json({ id: "s1", nextReviewOn: "2026-11-28" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage(<Sentences />);
    fireEvent.click(await screen.findByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/sentences?force=1")).toBe(true));
    expect(confirm).toHaveBeenCalledWith("次の単語が文章に含まれていません: wb、wc。このまま保存しますか？");
    await waitFor(() => expect(sessionStorage.getItem(`${DRAFT_KEY}:u1`)).toBeNull());
  });

  it("確認でキャンセルすると保存しない", async () => {
    sessionStorage.setItem(`${DRAFT_KEY}:u1`, JSON.stringify(generated));
    handlers["/api/sentences"] = () => json({ warning: { missing: ["wb"] } });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage(<Sentences />);
    fireEvent.click(await screen.findByRole("button", { name: "保存" }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(calls.some((c) => c.path === "/api/sentences?force=1")).toBe(false);
    expect(sessionStorage.getItem(`${DRAFT_KEY}:u1`)).not.toBeNull();
  });
});

describe("SentenceReview", () => {
  const cloze = { id: "s1", englishMarked: "She [[abandoned|abandon]] the [[plan|plan]].", japanese: "彼女は計画を諦めた。", mode: "cloze", stage: 1 };
  const recall = { id: "s2", englishMarked: "He can [[adapt|adapt]].", japanese: "彼は適応できる。", mode: "recall", stage: 3 };

  it("穴埋め: 全部開くまで判定できず、答えるとキューに入り単語の id と区別して記録される", async () => {
    today = { words: [], sentences: [cloze] };
    renderPage(<SentenceReview />);
    await screen.findByText("STORY ・ 穴埋め");
    const judge = () => screen.getByRole("button", { name: "覚えてた" }) as HTMLButtonElement;
    expect(judge().disabled).toBe(true);
    const blanks = screen.getAllByRole("button", { name: /空欄/ });
    expect(blanks).toHaveLength(2);
    expect(blanks.map((b) => b.getAttribute("aria-label"))).toEqual(["空欄 1/2。押すと答えが見えます", "空欄 2/2。押すと答えが見えます"]);
    fireEvent.click(blanks[0]);
    expect(judge().disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: /空欄/ })[0]);
    expect(screen.getByText("abandoned")).toBeTruthy();
    expect(judge().disabled).toBe(false);
    fireEvent.click(judge());
    await screen.findByText("今日の復習、完了！");
    await waitFor(() => expect(calls.find((c) => c.path === "/api/reviews")?.body.items[0]).toMatchObject({ kind: "sentence", id: "s1", result: "remembered" }));
    expect(JSON.parse(localStorage.getItem(ANSWERED_KEY)!).ids).toEqual(["s:s1"]);
  });

  it("思い出す: 和訳のみ → タップで英文（強調）→ 判定", async () => {
    today = { words: [], sentences: [recall] };
    renderPage(<SentenceReview />);
    await screen.findByText("STORY ・ 英文を思い出す");
    expect(screen.queryByText("adapt")).toBeNull();
    expect((screen.getByRole("button", { name: "忘れてた" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "タップで英文を表示" }));
    expect(screen.getByText("adapt").tagName).toBe("STRONG");
    fireEvent.click(screen.getByRole("button", { name: "忘れてた" }));
    await screen.findByText("今日の復習、完了！");
  });

  it("オフラインでもキャッシュした今日の文章で復習でき、答えた文章は出ない", async () => {
    localStorage.setItem(REVIEWS_TODAY_KEY, JSON.stringify({ words: [], sentences: [recall, cloze] }));
    localStorage.setItem(ANSWERED_KEY, JSON.stringify({ date: new Date().toLocaleDateString("sv"), ids: ["s:s2"] }));
    online = false;
    renderPage(<SentenceReview />);
    await screen.findByText("STORY ・ 穴埋め");
    expect(screen.queryByText("STORY ・ 英文を思い出す")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /空欄/ })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /空欄/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "忘れてた" }));
    await screen.findByText("今日の復習、完了！");
    expect(await list()).toHaveLength(1);
  });

  it("1つ戻すで前の文章に戻る", async () => {
    today = { words: [], sentences: [recall, cloze] };
    renderPage(<SentenceReview />);
    await screen.findByText("STORY ・ 英文を思い出す");
    fireEvent.click(screen.getByRole("button", { name: "タップで英文を表示" }));
    fireEvent.click(screen.getByRole("button", { name: "覚えてた" }));
    await screen.findByText("STORY ・ 穴埋め");
    fireEvent.click(screen.getByRole("button", { name: "↶ 1つ戻す" }));
    await screen.findByText("STORY ・ 英文を思い出す");
    expect(JSON.parse(localStorage.getItem(ANSWERED_KEY)!).ids).not.toContain("s:s2");
  });

  it("単語と文章が同じ id でも答えた記録は別々（文章を答えても単語は隠れない）", async () => {
    localStorage.setItem(ANSWERED_KEY, JSON.stringify({ date: new Date().toLocaleDateString("sv"), ids: ["s:x"] }));
    today = { words: [{ id: "x", english: "adapt", japanese: "適応する", stage: 1, stageDays: 1 }], sentences: [{ ...recall, id: "x" }] };
    const { unmount } = renderPage(<SentenceReview />);
    await screen.findByText("今日の復習はありません");
    unmount();
    const { Review } = await import("../src/pages/Review");
    renderPage(<Review />);
    await screen.findByText("REVIEW ・ 1 / 1");
  });
});
