import { beforeEach, describe, expect, it } from "vitest";
import { clearDraft, elapsedSec, formatTime, loadDraft, saveDraft, type RoundDraft } from "../src/lib/roundDraft";

const base: RoundDraft = {
  mode: "first",
  roundNo: 1,
  startedAt: "2026-11-25T10:00:00.000Z",
  pausedMs: 0,
  words: [],
};
const at = (s: number) => Date.parse(base.startedAt) + s * 1000;

beforeEach(() => localStorage.clear());

describe("elapsedSec", () => {
  it("一時停止していた 30 秒を除く", () => {
    expect(elapsedSec({ ...base, pausedMs: 30_000 }, at(100))).toBe(70);
  });
  it("一時停止中は止まった時点の秒数", () => {
    const d = { ...base, pausedAt: new Date(at(40)).toISOString() };
    expect(elapsedSec(d, at(100))).toBe(40);
  });
  it("STOP 後は stoppedAt で止まる", () => {
    const d = { ...base, pausedMs: 10_000, stoppedAt: new Date(at(60)).toISOString() };
    expect(elapsedSec(d, at(500))).toBe(50);
  });
});

describe("formatTime", () => {
  it("mm:ss、1 時間を過ぎたら h:mm:ss", () => {
    expect(formatTime(65)).toBe("01:05");
    expect(formatTime(3725)).toBe("1:02:05");
  });
});

describe("draft の保存", () => {
  it("loadDraft が保存内容を復元する", () => {
    const d: RoundDraft = { ...base, words: [{ english: "adapt", japanese: "適応する" }], pausedMs: 5000 };
    saveDraft(d);
    expect(loadDraft()).toEqual(d);
  });
  it("clearDraft の後は null", () => {
    saveDraft(base);
    clearDraft();
    expect(loadDraft()).toBeNull();
  });
  it("壊れた内容は null", () => {
    localStorage.setItem("wl_round_draft", "{oops");
    expect(loadDraft()).toBeNull();
  });
});
