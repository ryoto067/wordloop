import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntervalEditor } from "../src/components/IntervalEditor";
import { monthLabel, shiftMonth } from "../src/pages/Records";

describe("shiftMonth / monthLabel", () => {
  it("通常の前後", () => {
    expect(shiftMonth("2026-11", 1)).toBe("2026-12");
    expect(shiftMonth("2026-11", -1)).toBe("2026-10");
  });
  it("年またぎ", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
  it("表示名", () => {
    expect(monthLabel("2026-03")).toBe("2026年3月");
  });
});

describe("IntervalEditor", () => {
  it("昇順でないとエラーを出し、保存を押せない", () => {
    render(<IntervalEditor label="単語" initial={[1, 3]} onSave={async () => {}} />);
    fireEvent.change(screen.getByLabelText("単語 2 段階目の日数"), { target: { value: "1" } });
    expect(screen.getByRole("alert").textContent).toMatch(/大きく/);
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
