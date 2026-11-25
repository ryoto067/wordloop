import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProtectedLayout } from "../src/App";
import { ME_CACHE_KEY, MeProvider, type Me } from "../src/lib/MeContext";
import { Home } from "../src/pages/Home";

const assign = vi.fn();
const me: Me = {
  id: "u1",
  name: "t",
  email: "t@example.com",
  timezone: "Asia/Tokyo",
  wordIntervals: [1],
  sentenceIntervals: [3],
  fontScale: 1,
  streak: 7,
  today: { dueWords: 18, dueSentences: 2, waitingWords: 0, doneToday: false },
};

function renderApp() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <MeProvider>
        <Routes>
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<Home />} />
          </Route>
        </Routes>
      </MeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("location", { assign, pathname: "/" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  assign.mockReset();
});

describe("ProtectedLayout + MeProvider", () => {
  it("オフライン + キャッシュあり: キャッシュを表示しバナーを出し、遷移しない", async () => {
    localStorage.setItem(ME_CACHE_KEY, JSON.stringify(me));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderApp();
    expect(await screen.findByText("オフラインです。つながると自動で同期します")).toBeTruthy();
    expect(screen.getByLabelText("連続 7 日")).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("500: エラーパネルと再読み込みボタン、遷移しない", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    renderApp();
    expect(await screen.findByRole("button", { name: "再読み込み" })).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("401: /login へ遷移する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    renderApp();
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
  });

  it("成功: データを表示し、/api/me を 1 回だけ取得してキャッシュする", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(me), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    expect(await screen.findByLabelText("連続 7 日")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(ME_CACHE_KEY)!)).toEqual(me);
  });

  it("401 は wl_me を消す", async () => {
    localStorage.setItem(ME_CACHE_KEY, JSON.stringify(me));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    renderApp();
    await waitFor(() => expect(localStorage.getItem(ME_CACHE_KEY)).toBeNull());
  });

  it("壊れたキャッシュは無視され、オフラインならエラーパネル", async () => {
    localStorage.setItem(ME_CACHE_KEY, JSON.stringify({ name: "x" }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderApp();
    expect(await screen.findByRole("button", { name: "再読み込み" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("オフライン後に online イベントで再取得し、バナーが消える", async () => {
    localStorage.setItem(ME_CACHE_KEY, JSON.stringify({ ...me, streak: 3 }));
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    await screen.findByRole("status");
    fetchMock.mockResolvedValue(new Response(JSON.stringify(me), { status: 200 }));
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(await screen.findByLabelText("連続 7 日")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
