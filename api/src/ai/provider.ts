import type { Env } from '../env'

export interface TextGen {
  complete(system: string, user: string): Promise<string>
}

const WORKERS_AI_MODEL = '@cf/openai/gpt-oss-120b'

// Workers AI の応答からテキストを取り出す。
// gpt-oss は Responses 形式（output の message.content[].output_text）を返す。
// 念のため chat completions 形式（choices[].message.content）と { response } にも対応する。
export function extractWorkersAiText(res: unknown): string {
  const r = res as any
  if (typeof res === 'string') return res
  if (Array.isArray(r?.output)) {
    const texts: string[] = []
    for (const item of r.output) {
      if (item?.type !== 'message' || !Array.isArray(item.content)) continue
      for (const part of item.content) {
        if (part?.type === 'output_text' && typeof part.text === 'string') texts.push(part.text)
      }
    }
    if (texts.length) return texts.join('')
  }
  const content = r?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (typeof r?.response === 'string') return r.response
  throw new Error('unexpected Workers AI response shape')
}

export function extractClaudeText(res: unknown): string {
  const blocks = (res as any)?.content
  if (!Array.isArray(blocks)) throw new Error('unexpected Claude response shape')
  return blocks
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('')
}

function workersAi(env: Env): TextGen {
  return {
    async complete(system, user) {
      const res = await (env.AI as any).run(WORKERS_AI_MODEL, {
        instructions: system,
        input: user,
        reasoning: { effort: 'low' },
      })
      return extractWorkersAiText(res)
    },
  }
}

function claude(env: Env): TextGen {
  return {
    async complete(system, user) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY ?? '',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: env.CLAUDE_MODEL ?? 'claude-sonnet-5-5',
          max_tokens: 1024,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      })
      if (!res.ok) throw new Error(`Claude API error ${res.status}`)
      return extractClaudeText(await res.json())
    },
  }
}

// テスト用に差し替える（本物の AI は呼ばない）
let override: TextGen | null = null
export function setTextGenOverride(gen: TextGen | null): void {
  override = gen
}

export function getTextGen(env: Env): TextGen {
  if (override) return override
  return env.AI_PROVIDER === 'claude' ? claude(env) : workersAi(env)
}
