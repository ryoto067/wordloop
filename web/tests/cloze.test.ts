import { describe, expect, it } from "vitest";
import { toSegments } from "../src/lib/cloze";

describe("toSegments", () => {
  it("[[surface|lemma]] を blank にする", () => {
    expect(toSegments("She [[abandoned|abandon]] it.")).toEqual([
      { text: "She " },
      { blank: "abandoned", lemma: "abandon" },
      { text: " it." },
    ]);
  });
  it("目印なしの文は text 1 つ", () => {
    expect(toSegments("Plain sentence.")).toEqual([{ text: "Plain sentence." }]);
  });
  it("文頭・文末・連続の目印", () => {
    expect(toSegments("[[Adapt|adapt]] [[fast|fast]]")).toEqual([
      { blank: "Adapt", lemma: "adapt" },
      { text: " " },
      { blank: "fast", lemma: "fast" },
    ]);
  });
  it("空文字は空配列", () => {
    expect(toSegments("")).toEqual([]);
  });
});
