// 目印 [[surface|lemma]] の解析。plain は目印を外した英文、spans は plain 上の位置。
export type MarkSpan = { start: number; end: number; surface: string; lemma: string }

const MARK = /\[\[([^\[\]|]+)\|([^\[\]|]+)\]\]/g

export function parseMarked(text: string): { plain: string; spans: MarkSpan[] } {
  let plain = ''
  let last = 0
  const spans: MarkSpan[] = []
  for (const m of text.matchAll(MARK)) {
    plain += text.slice(last, m.index)
    const surface = m[1].trim()
    spans.push({ start: plain.length, end: plain.length + surface.length, surface, lemma: m[2].trim() })
    plain += surface
    last = m.index + m[0].length
  }
  plain += text.slice(last)
  return { plain, spans }
}

// 目印が付いていない語（lemma 部分は大文字小文字を区別しない）
export function missingLemmas(text: string, lemmas: string[]): string[] {
  const have = new Set(parseMarked(text).spans.map((s) => s.lemma.toLowerCase()))
  return lemmas.filter((l) => !have.has(l.trim().toLowerCase()))
}
