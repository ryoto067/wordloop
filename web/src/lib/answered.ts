// 今日すでに答えた単語の id（送信済みも含む）。オフラインで開き直しても二重に復習しないために使う
export const ANSWERED_KEY = "wl_answered_today";

type Stored = { date: string; ids: string[] };

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function read(): Stored {
  try {
    const v = JSON.parse(localStorage.getItem(ANSWERED_KEY) ?? "null") as Stored | null;
    if (v && v.date === today() && Array.isArray(v.ids)) return v;
  } catch {
    // 壊れていたら空から始める
  }
  return { date: today(), ids: [] };
}

function write(v: Stored) {
  try {
    localStorage.setItem(ANSWERED_KEY, JSON.stringify(v));
  } catch {
    // 保存できなくても動作には影響しない
  }
}

export type CardKind = "word" | "sentence";

// 単語の id と文章の id がぶつからないよう、文章だけ接頭辞を付けて保存する（単語は従来どおり）
export function answerKey(kind: CardKind, id: string): string {
  return kind === "sentence" ? `s:${id}` : id;
}

export function answeredToday(): Set<string> {
  return new Set(read().ids);
}

export function markAnswered(id: string, kind: CardKind = "word") {
  const v = read();
  const key = answerKey(kind, id);
  if (!v.ids.includes(key)) write({ ...v, ids: [...v.ids, key] });
}

export function unmarkAnswered(id: string, kind: CardKind = "word") {
  const v = read();
  const key = answerKey(kind, id);
  write({ ...v, ids: v.ids.filter((x) => x !== key) });
}
