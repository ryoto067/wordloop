import { describe, expect, it } from "vitest";
import { validateIntervals } from "../src/lib/intervals";

describe("validateIntervals", () => {
  it("正しい間隔は null", () => {
    expect(validateIntervals(["1", "3", "7"])).toBeNull();
    expect(validateIntervals(["365"])).toBeNull();
  });
  it("0 段階・9 段階はエラー", () => {
    expect(validateIntervals([])).toMatch(/1〜8/);
    expect(validateIntervals(["1", "2", "3", "4", "5", "6", "7", "8", "9"])).toMatch(/1〜8/);
  });
  it("整数でない・範囲外・空欄はエラー", () => {
    expect(validateIntervals(["1.5"])).toMatch(/1〜365/);
    expect(validateIntervals(["0"])).toMatch(/1〜365/);
    expect(validateIntervals(["366"])).toMatch(/1〜365/);
    expect(validateIntervals([""])).toMatch(/1〜365/);
  });
  it("昇順でないとエラー", () => {
    expect(validateIntervals(["3", "3"])).toMatch(/大きく/);
    expect(validateIntervals(["7", "3"])).toMatch(/大きく/);
  });
});
