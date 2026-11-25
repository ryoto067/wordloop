import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("idb-keyval", () => ({
  get: async () => undefined,
  set: async () => undefined,
  del: async () => undefined,
}));
const order: string[] = [];
const disablePush = vi.fn(async () => {
  order.push("disablePush");
});
vi.mock("../src/lib/push", async (orig) => ({ ...(await orig<object>()), disablePush: () => disablePush() }));

import { ME_CACHE_KEY, MeProvider, type Me } from "../src/lib/MeContext";
import { Settings } from "../src/pages/Settings";

const me: Me = {
  id: "u1", name: "t", email: "t@example.com", timezone: "Asia/Tokyo", wordIntervals: [1], sentenceIntervals: [3],
  fontScale: 1, streak: 1, today: { dueWords: 0, dueSentences: 0, waitingWords: 0, doneToday: false },
};
const assign = vi.fn();

beforeEach(() => {
  order.length = 0;
  disablePush.mockClear();
  localStorage.clear();
  localStorage.setItem(ME_CACHE_KEY, JSON.stringify(me));
  localStorage.setItem("wl_round_draft", "{}");
  vi.stubGlobal("location", { assign, pathname: "/settings" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/me") return new Response(JSON.stringify(me));
      if (path === "/api/auth/logout") order.push("logout");
      if (path.startsWith("/api/settings/notify")) return new Response("[]");
      return new Response("{}");
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ログアウト", () => {
  it("通知の購読を解除してからログアウトし、周回の下書きを消す。解除が失敗しても続行する", async () => {
    render(
      <MemoryRouter>
        <MeProvider>
          <Settings />
        </MeProvider>
      </MemoryRouter>,
    );
    disablePush.mockRejectedValueOnce(new Error("push down"));
    fireEvent.click(await screen.findByRole("button", { name: "ログアウト" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
    expect(disablePush).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["logout"]);
    expect(localStorage.getItem("wl_round_draft")).toBeNull();
  });

  it("購読解除は /api/auth/logout より前", async () => {
    render(
      <MemoryRouter>
        <MeProvider>
          <Settings />
        </MeProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "ログアウト" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
    expect(order).toEqual(["disablePush", "logout"]);
  });
});
