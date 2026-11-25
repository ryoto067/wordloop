import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (k: string) => store.get(k),
  set: async (k: string, v: unknown) => void store.set(k, v),
  del: async (k: string) => void store.delete(k),
}));

import { ApiError, OfflineError } from "../src/lib/api";
import { claimQueue, clearQueue, enqueue, flush, size, type QueuedRequest } from "../src/lib/offlineQueue";

const review = (id: string): QueuedRequest => ({
  id,
  path: "/api/reviews",
  kind: "reviews",
  body: { clientId: id, kind: "word", id: `w-${id}`, result: "remembered", reviewedAt: "2026-11-25T00:00:00Z" },
});
const other = (id: string): QueuedRequest => ({ id, path: "/api/words", kind: "other", body: { n: id } });

beforeEach(async () => {
  store.clear();
  await clearQueue();
});

describe("offlineQueue", () => {
  it("2 件積んで flush 成功なら size 0", async () => {
    await enqueue(review("a"));
    await enqueue(review("b"));
    expect(await size()).toBe(2);
    const send = vi.fn().mockResolvedValue({ applied: 2, skipped: 0, streak: 8 });
    const r = await flush(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0][1] as { items: unknown[] }).items).toHaveLength(2);
    expect(r.streak).toBe(8);
    expect(await size()).toBe(0);
  });

  it("OfflineError なら size 2 のまま", async () => {
    await enqueue(review("a"));
    await enqueue(review("b"));
    await flush(vi.fn().mockRejectedValue(new OfflineError()));
    expect(await size()).toBe(2);
  });

  it("復習は 15 件ずつに分けて送る", async () => {
    for (let i = 0; i < 31; i++) await enqueue(review(`r${i}`));
    const send = vi.fn().mockResolvedValue({ applied: 15, skipped: 0, streak: 1 });
    await flush(send);
    expect(send.mock.calls.map((c) => (c[1] as { items: unknown[] }).items.length)).toEqual([15, 15, 1]);
    expect(await size()).toBe(0);
  });

  it("途中で OfflineError なら送れた分だけ消える", async () => {
    for (let i = 0; i < 20; i++) await enqueue(review(`r${i}`));
    const send = vi
      .fn()
      .mockResolvedValueOnce({ applied: 15, skipped: 0, streak: 1 })
      .mockRejectedValueOnce(new OfflineError());
    await flush(send);
    expect(await size()).toBe(5);
  });

  it("4xx は捨て、5xx は残す", async () => {
    await enqueue(other("x"));
    await enqueue(other("y"));
    const send = vi.fn().mockRejectedValueOnce(new ApiError(400, null)).mockResolvedValueOnce({});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await flush(send);
    expect(await size()).toBe(0);

    await enqueue(other("z"));
    await flush(vi.fn().mockRejectedValue(new ApiError(503, null)));
    expect(await size()).toBe(1);
  });

  it("other は 1 件ずつ順番に送る", async () => {
    await enqueue(other("x"));
    await enqueue(other("y"));
    const send = vi.fn().mockResolvedValue({});
    await flush(send);
    expect(send.mock.calls.map((c) => (c[1] as { n: string }).n)).toEqual(["x", "y"]);
  });

  it("まとめた送信が 400 なら 1 件ずつ送り直し、悪い 1 件だけ捨てる", async () => {
    for (let i = 0; i < 15; i++) await enqueue(review(`r${i}`));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sent: string[] = [];
    const send = vi.fn(async (_p: string, body: unknown) => {
      const items = (body as { items: { clientId: string }[] }).items;
      if (items.length > 1 || items[0].clientId === "r7") throw new ApiError(400, null);
      sent.push(items[0].clientId);
      return { streak: 3 };
    });
    await flush(send);
    expect(sent).toHaveLength(14);
    expect(sent).not.toContain("r7");
    expect(await size()).toBe(0);
  });

  it.each([401, 403, 408, 429, 500])("%i では項目を残す", async (status) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await enqueue(review("a"));
    await enqueue(review("b"));
    await flush(vi.fn().mockRejectedValue(new ApiError(status, null)));
    expect(await size()).toBe(2);
  });

  it("別アカウントならキューを捨て、同じアカウントなら残す", async () => {
    expect(await claimQueue("u1")).toBe(false);
    await enqueue(review("a"));
    expect(await claimQueue("u1")).toBe(false);
    expect(await size()).toBe(1);
    expect(await claimQueue("u2")).toBe(true);
    expect(await size()).toBe(0);
  });
});
