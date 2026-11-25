import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (k: string) => store.get(k),
  set: async (k: string, v: unknown) => void store.set(k, v),
  del: async (k: string) => void store.delete(k),
}));

import { MeProvider, ME_CACHE_KEY, type Me } from "../src/lib/MeContext";
import { loadDraft, saveDraft } from "../src/lib/roundDraft";
import { Entry } from "../src/pages/Entry";

const me: Me = {
  id: "u1", name: "t", email: "t@example.com", timezone: "Asia/Tokyo", wordIntervals: [1], sentenceIntervals: [3],
  fontScale: 1, streak: 1, today: { dueWords: 0, dueSentences: 0, waitingWords: 0, doneToday: false },
};
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
let calls: { path: string; body: any }[] = [];

beforeEach(() => {
  store.clear();
  localStorage.clear();
  localStorage.setItem(ME_CACHE_KEY, JSON.stringify(me));
  calls = [];
  saveDraft({ mode: "first", roundNo: 1, startedAt: new Date(Date.now() - 90_000).toISOString(), pausedMs: 0, stoppedAt: new Date().toISOString(), words: [] });
  vi.stubGlobal("location", { assign: vi.fn(), pathname: "/round/entry" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      if (path === "/api/me") return json(me);
      if (path === "/api/words/check") return json({ existing: body.english.includes("adapt") ? [{ english: "adapt", wordId: "w1", setNames: ["11/18"] }] : [] });
      if (path === "/api/rounds/first") return json({ setId: "s1", roundNo: 1, created: 1, linked: 0, skipped: 0 });
      return json({});
    }),
  );
});
afterEach(cleanup);

const renderEntry = () =>
  render(
    <MemoryRouter initialEntries={["/round/entry"]}>
      <MeProvider>
        <Routes>
          <Route path="/round/entry" element={<Entry />} />
          <Route path="/" element={<p>HOME</p>} />
          <Route path="/round/timer" element={<p>TIMER</p>} />
        </Routes>
      </MeProvider>
    </MemoryRouter>,
  );

describe("Entry", () => {
  it("変換確定の Enter では進まず、確定後の Enter で次へ", () => {
    renderEntry();
    const en = screen.getByLabelText("英単語");
    fireEvent.change(en, { target: { value: "adapt" } });
    fireEvent.keyDown(en, { key: "Enter", isComposing: true });
    expect(document.activeElement).not.toBe(screen.getByLabelText("日本語訳"));
    fireEvent.keyDown(en, { key: "Enter", keyCode: 229 });
    expect(document.activeElement).not.toBe(screen.getByLabelText("日本語訳"));
    fireEvent.keyDown(en, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByLabelText("日本語訳"));
  });

  it("空の英単語で Enter しても何も起きず、日本語の Enter で一覧に追加して英単語へ戻る", () => {
    renderEntry();
    const en = screen.getByLabelText("英単語");
    const ja = screen.getByLabelText("日本語訳");
    fireEvent.keyDown(en, { key: "Enter" });
    expect(document.activeElement).not.toBe(ja);
    fireEvent.change(en, { target: { value: "abandon" } });
    fireEvent.change(ja, { target: { value: "断念する" } });
    fireEvent.keyDown(ja, { key: "Enter", isComposing: true });
    expect(loadDraft()?.words).toEqual([]);
    fireEvent.keyDown(ja, { key: "Enter" });
    expect(loadDraft()?.words).toEqual([{ english: "abandon", japanese: "断念する" }]);
    expect(document.activeElement).toBe(en);
  });

  it("登録済みの案内と「このセットにも入れる」を保存に反映する", async () => {
    renderEntry();
    const en = screen.getByLabelText("英単語");
    const ja = screen.getByLabelText("日本語訳");
    fireEvent.change(en, { target: { value: "adapt" } });
    fireEvent.blur(en);
    expect(await screen.findByText(/登録済み（11\/18）/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/このセットにも入れる/));
    fireEvent.change(ja, { target: { value: "適応する" } });
    fireEvent.keyDown(ja, { key: "Enter" });
    fireEvent.click(screen.getByText("保存して完了"));
    expect(await screen.findByText(/今日覚えた単語 1 語/)).toBeTruthy();
    const post = calls.find((c) => c.path === "/api/rounds/first");
    expect(post?.body.linkExisting).toEqual(["adapt"]);
    expect(post?.body.words).toEqual([{ english: "adapt", japanese: "適応する" }]);
    expect(post?.body.durationSec).toBeGreaterThanOrEqual(89);
    await waitFor(() => expect(loadDraft()).toBeNull());
  });

  it("やめる: 確認すると下書きを捨ててホームへ戻る", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    renderEntry();
    fireEvent.click(screen.getByText("やめる"));
    expect(window.confirm).toHaveBeenCalled();
    expect(loadDraft()).toBeNull();
    expect(screen.getByText("HOME")).toBeTruthy();
  });

  it("やめる: キャンセルなら何もしない", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    renderEntry();
    fireEvent.click(screen.getByText("やめる"));
    expect(loadDraft()).not.toBeNull();
  });

  it("STOP 前の下書きならタイマーへ戻す", () => {
    saveDraft({ mode: "first", roundNo: 1, startedAt: new Date().toISOString(), pausedMs: 0, words: [] });
    renderEntry();
    expect(screen.getByText("TIMER")).toBeTruthy();
  });
});
