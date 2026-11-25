import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ME_CACHE_KEY, MeProvider } from "../src/lib/MeContext";
import { saveDraft } from "../src/lib/roundDraft";
import { RoundStart } from "../src/pages/RoundStart";

vi.mock("idb-keyval", () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(ME_CACHE_KEY, JSON.stringify({ id: "u1", fontScale: 1, streak: 0, today: {} }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
});
afterEach(cleanup);

const renderAt = () =>
  render(
    <MemoryRouter initialEntries={["/round/start"]}>
      <MeProvider>
        <Routes>
          <Route path="/round/start" element={<RoundStart />} />
          <Route path="/round/timer" element={<p>TIMER</p>} />
          <Route path="/round/entry" element={<p>ENTRY</p>} />
        </Routes>
      </MeProvider>
    </MemoryRouter>,
  );

describe("RoundStart", () => {
  it("途中の周回があれば上書きせず再開先へ移る", () => {
    saveDraft({ mode: "first", roundNo: 1, startedAt: new Date().toISOString(), pausedMs: 0, stoppedAt: new Date().toISOString(), words: [{ english: "a", japanese: "あ" }] });
    renderAt();
    expect(screen.getByText("ENTRY")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("wl_round_draft")!).words).toHaveLength(1);
  });
  it("途中の周回がなければ選択画面を出す", () => {
    renderAt();
    expect(screen.getByText("何周目をやる？")).toBeTruthy();
  });
});
