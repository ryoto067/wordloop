import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfflineError, api } from "../src/lib/api";

const assign = vi.fn();

beforeEach(() => {
  vi.stubGlobal("location", { assign, pathname: "/" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  assign.mockReset();
});

describe("api()", () => {
  it("credentials: include 付きで JSON を返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ a: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await api<{ a: number }>("/api/me")).toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/api/me", expect.objectContaining({ credentials: "include" }));
  });

  it("401 で /login へ遷移する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(api("/api/me")).rejects.toThrow();
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("すでに /login にいる場合は遷移しない", async () => {
    vi.stubGlobal("location", { assign, pathname: "/login" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(api("/api/me")).rejects.toThrow();
    expect(assign).not.toHaveBeenCalled();
  });

  it("fetch が reject したら OfflineError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api("/api/me")).rejects.toBeInstanceOf(OfflineError);
  });

  it("その他のエラーは status 付きの ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    await expect(api("/api/me")).rejects.toMatchObject({ status: 500 });
  });
});
