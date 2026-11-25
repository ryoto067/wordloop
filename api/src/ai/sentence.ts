import { missingLemmas } from '../domain/marks'
import type { TextGen } from './provider'

export class AiFormatError extends Error {
  constructor(message = 'AI output format error') {
    super(message)
    this.name = 'AiFormatError'
  }
}

const SYSTEM = `You are an English teacher helping Japanese learners prepare for high school to university entrance exams.
Write a short story of 2 to 4 sentences in natural English at that level, and you MUST use every word in the given list.
Wrap each used word as [[form actually used|original word]], e.g. [[abandoned|abandon]]. The part after | must be exactly the original word given.
Also give a natural Japanese translation.
Reply with ONLY a JSON object: {"english": "...", "japanese": "..."}. No code fences, no extra text.`

// 最初の JSON オブジェクトを取り出す（``` や前後の文章に耐える）
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

export async function generateSentence(
  gen: TextGen,
  words: { english: string; japanese: string }[],
): Promise<{ englishMarked: string; japanese: string }> {
  const user = `Words:\n${words.map((w) => `- ${w.english} (${w.japanese})`).join('\n')}`
  const lemmas = words.map((w) => w.english)
  for (let attempt = 0; attempt < 2; attempt++) {
    const parsed = extractJson(await gen.complete(SYSTEM, user)) as { english?: unknown; japanese?: unknown } | null
    if (
      parsed &&
      typeof parsed.english === 'string' &&
      typeof parsed.japanese === 'string' &&
      missingLemmas(parsed.english, lemmas).length === 0
    ) {
      return { englishMarked: parsed.english, japanese: parsed.japanese }
    }
  }
  throw new AiFormatError()
}
