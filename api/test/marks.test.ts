import { describe, expect, it } from 'vitest'
import { extractClaudeText, extractWorkersAiText } from '../src/ai/provider'
import type { TextGen } from '../src/ai/provider'
import { AiFormatError, extractJson, generateSentence } from '../src/ai/sentence'
import { missingLemmas, parseMarked } from '../src/domain/marks'

describe('parseMarked', () => {
  it('目印を外し plain 上の位置を返す', () => {
    const r = parseMarked('She [[abandoned|abandon]] it.')
    expect(r.plain).toBe('She abandoned it.')
    expect(r.spans).toEqual([{ start: 4, end: 13, surface: 'abandoned', lemma: 'abandon' }])
  })
  it('複数の目印と目印なし', () => {
    const r = parseMarked('[[Cats|cat]] and [[dogs|dog]].')
    expect(r.plain).toBe('Cats and dogs.')
    expect(r.spans.map((s) => [s.start, s.end])).toEqual([
      [0, 4],
      [9, 13],
    ])
    expect(parseMarked('plain text').spans).toEqual([])
  })
})

describe('missingLemmas', () => {
  it('欠けた語を返す（lemma は大文字小文字を区別しない）', () => {
    expect(missingLemmas('A [[Cats|Cat]] [[ran|run]].', ['cat', 'run', 'dog'])).toEqual(['dog'])
    expect(missingLemmas('x', [])).toEqual([])
  })
})

describe('extractJson', () => {
  it('フェンスや前後の文章に耐える', () => {
    expect(extractJson('Sure!\n```json\n{"a":"x}y","b":1}\n```\nbye')).toEqual({ a: 'x}y', b: 1 })
    expect(extractJson('no json')).toBeNull()
    expect(extractJson('{broken')).toBeNull()
  })
})

const words = [
  { english: 'abandon', japanese: '捨てる' },
  { english: 'cat', japanese: '猫' },
]
const good = JSON.stringify({ english: 'She [[abandoned|abandon]] a [[cat|cat]].', japanese: '彼女は猫を捨てた。' })
const seqGen = (outs: string[]): TextGen & { calls: number } => ({
  calls: 0,
  async complete() {
    return outs[this.calls++]
  },
})

describe('generateSentence', () => {
  it('1 回目が壊れていても 2 回目で成功', async () => {
    const gen = seqGen(['oops', '```json\n' + good + '\n```'])
    expect(await generateSentence(gen, words)).toEqual({
      englishMarked: 'She [[abandoned|abandon]] a [[cat|cat]].',
      japanese: '彼女は猫を捨てた。',
    })
    expect(gen.calls).toBe(2)
  })
  it('語が欠けていれば再試行、2 回とも駄目なら AiFormatError', async () => {
    const missing = JSON.stringify({ english: 'She [[abandoned|abandon]] it.', japanese: 'x' })
    const gen = seqGen([missing, 'bad'])
    await expect(generateSentence(gen, words)).rejects.toBeInstanceOf(AiFormatError)
    expect(gen.calls).toBe(2)
  })
})

describe('アダプタ', () => {
  it('Workers AI（Responses 形式）', () => {
    const res = {
      output: [
        { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'thinking' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"a":1}' }] },
      ],
    }
    expect(extractWorkersAiText(res)).toBe('{"a":1}')
  })
  it('Workers AI（chat completions 形式）', () => {
    expect(extractWorkersAiText({ choices: [{ message: { content: 'hi' } }] })).toBe('hi')
    expect(() => extractWorkersAiText({})).toThrow()
  })
  it('Claude の text ブロック', () => {
    expect(
      extractClaudeText({ content: [{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }] }),
    ).toBe('ab')
  })
})
