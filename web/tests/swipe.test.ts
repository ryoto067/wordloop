import { describe, expect, it } from "vitest";
import { swipeDecision } from "../src/lib/swipe";

describe("swipeDecision", () => {
  it("幅の半分に届かなければ null", () => {
    expect(swipeDecision(149, 300)).toBeNull();
    expect(swipeDecision(-149, 300)).toBeNull();
    expect(swipeDecision(0, 300)).toBeNull();
  });
  it("右に半分以上で remembered、左で forgot", () => {
    expect(swipeDecision(150, 300)).toBe("remembered");
    expect(swipeDecision(-150, 300)).toBe("forgot");
  });
  it("幅が 0 以下なら判定しない", () => {
    expect(swipeDecision(10, 0)).toBeNull();
  });
});
