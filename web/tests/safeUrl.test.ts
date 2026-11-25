import { describe, expect, it } from "vitest";
import { safeNotificationUrl } from "../src/lib/safeUrl";

const O = "https://app.example";
describe("safeNotificationUrl", () => {
  it("同一オリジンの相対パスは通す", () => {
    expect(safeNotificationUrl("/review", O)).toBe("https://app.example/review");
    expect(safeNotificationUrl("https://app.example/x?y=1", O)).toBe("https://app.example/x?y=1");
  });
  it.each(["https://evil.example/", "//evil.example", "javascript:alert(1)", 42, null, undefined])("%s はトップへ", (v) => {
    expect(safeNotificationUrl(v, O)).toBe("https://app.example/");
  });
});
