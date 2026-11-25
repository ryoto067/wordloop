import { toSegments } from "../lib/cloze";

// 目印つき英文を、単語部分だけライム＋太字にして表示する
export function MarkedText({ value }: { value: string }) {
  return (
    <>
      {toSegments(value).map((s, i) =>
        "blank" in s ? (
          <strong key={i} className="hl">
            {s.blank}
          </strong>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}
