export type Segment = { text: string } | { blank: string; lemma: string };

// [[surface|lemma]] を穴埋めの空欄（blank）に分ける。目印のない部分は text
export function toSegments(englishMarked: string): Segment[] {
  const out: Segment[] = [];
  const re = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
  let last = 0;
  for (const m of englishMarked.matchAll(re)) {
    if (m.index > last) out.push({ text: englishMarked.slice(last, m.index) });
    out.push({ blank: m[1], lemma: m[2] });
    last = m.index + m[0].length;
  }
  if (last < englishMarked.length) out.push({ text: englishMarked.slice(last) });
  return out;
}
