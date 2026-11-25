import { env } from 'cloudflare:workers'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setTextGenOverride } from '../src/ai/provider'
import type { TextGen } from '../src/ai/provider'
import { addDays, localDate } from '../src/domain/dates'
import { call, login } from './helpers'

const today = () => localDate(new Date(), 'Asia/Tokyo')
let alice: { cookie: string }
let bob: { cookie: string }
let carol: { cookie: string }
let dave: { cookie: string }
let eve: { cookie: string }
let aliceId: string
let bobId: string
let carolId: string
let daveId: string
let eveId: string

const userId = async (email: string) =>
  (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<any>()).id as string

async function addWord(uid: string, english: string, status = 'waiting_sentence') {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO words (id, user_id, english, japanese, anchor_on, next_review_on, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, uid, english, `${english}-ja`, today(), null, status)
    .run()
  return id
}

const wordStatus = async (id: string) =>
  (await env.DB.prepare('SELECT status FROM words WHERE id = ?').bind(id).first<any>()).status as string

// 渡された語をすべて目印付きで使う偽 AI
function fakeGen(): TextGen {
  return {
    async complete(_s, user) {
      const ws = [...user.matchAll(/^- (\S+) /gm)].map((m) => m[1])
      return JSON.stringify({ english: ws.map((w) => `[[${w}|${w}]]`).join(' '), japanese: '和訳' })
    },
  }
}

beforeAll(async () => {
  alice = await login('alice-sent@example.com')
  bob = await login('bob-sent@example.com')
  carol = await login('carol-sent@example.com')
  dave = await login('dave-sent@example.com')
  eve = await login('eve-sent@example.com')
  aliceId = await userId('alice-sent@example.com')
  bobId = await userId('bob-sent@example.com')
  carolId = await userId('carol-sent@example.com')
  daveId = await userId('dave-sent@example.com')
  eveId = await userId('eve-sent@example.com')
})
afterEach(() => setTextGenOverride(null))

describe('GET /api/sentences/waiting', () => {
  it('4 語なら canGenerate:false、5 語で true', async () => {
    for (let i = 0; i < 4; i++) await addWord(bobId, `bw${i}`)
    await addWord(bobId, 'reviewing-one', 'reviewing')
    const r1 = await (await call(bob, 'GET', '/api/sentences/waiting')).json<any>()
    expect(r1.words).toHaveLength(4)
    expect(r1.canGenerate).toBe(false)
    expect(r1.remainingToday).toBe(10)
    await addWord(bobId, 'bw4')
    expect((await (await call(bob, 'GET', '/api/sentences/waiting')).json<any>()).canGenerate).toBe(true)
  })
})

describe('generate / regenerate', () => {
  it('古い順 10 語で生成し、下書きを返す（保存しない）。5 語未満は 400', async () => {
    setTextGenOverride(fakeGen())
    expect((await call(carol, 'POST', '/api/sentences/generate', {})).status).toBe(400)
    const ids: string[] = []
    for (let i = 0; i < 12; i++) ids.push(await addWord(carolId, `cw${String(i).padStart(2, '0')}`))
    const res = await call(carol, 'POST', '/api/sentences/generate', {})
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.wordIds).toEqual(ids.slice(0, 10))
    expect(body.englishMarked).toContain('[[cw00|cw00]]')
    expect(body.japanese).toBe('和訳')
    const n = await env.DB.prepare('SELECT COUNT(*) n FROM sentences WHERE user_id = ?').bind(carolId).first<any>()
    expect(n.n).toBe(0)

    const re = await call(carol, 'POST', '/api/sentences/regenerate', { wordIds: ids.slice(0, 5) })
    expect(re.status).toBe(200)
    expect((await re.json<any>()).wordIds).toHaveLength(5)
    const used = await env.DB.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND date = ?')
      .bind(carolId, today())
      .first<any>()
    expect(used.count).toBe(2)
  })

  it('AI 形式エラーは 502 で消費され、11 回目は 429', async () => {
    for (let i = 0; i < 5; i++) await addWord(daveId, `dw${i}`)
    setTextGenOverride({ complete: async () => 'garbage' })
    const first = await call(dave, 'POST', '/api/sentences/generate', {})
    expect(first.status).toBe(502)
    expect(await first.json()).toEqual({ error: 'ai_format' })
    setTextGenOverride(fakeGen())
    for (let i = 1; i < 10; i++) expect((await call(dave, 'POST', '/api/sentences/generate', {})).status).toBe(200)
    const over = await call(dave, 'POST', '/api/sentences/generate', {})
    expect(over.status).toBe(429)
    expect(await over.json()).toEqual({ error: 'daily_limit' })
    const w = await (await call(dave, 'GET', '/api/sentences/waiting')).json<any>()
    expect(w.remainingToday).toBe(0)
    expect(w.canGenerate).toBe(false)
  })

  it('regenerate は他人の語・対象外の語・空を 400', async () => {
    setTextGenOverride(fakeGen())
    const mine = await addWord(aliceId, 'rg-mine')
    const bobs = await addWord(bobId, 'rg-bobs')
    const rev = await addWord(aliceId, 'rg-rev', 'reviewing')
    expect((await call(alice, 'POST', '/api/sentences/regenerate', { wordIds: [mine, bobs] })).status).toBe(400)
    expect((await call(alice, 'POST', '/api/sentences/regenerate', { wordIds: [rev] })).status).toBe(400)
    expect((await call(alice, 'POST', '/api/sentences/regenerate', { wordIds: [] })).status).toBe(400)
  })
})

describe('POST /api/sentences', () => {
  it('保存すると文章は today+3、語は in_sentence', async () => {
    const a = await addWord(aliceId, 'save-a')
    const b = await addWord(aliceId, 'save-b')
    const res = await call(alice, 'POST', '/api/sentences', {
      englishMarked: '[[Save-A|save-a]] and [[save-b|save-b]].',
      japanese: '訳',
      wordIds: [a, b],
    })
    expect(res.status).toBe(200)
    const { id } = await res.json<any>()
    const s = await env.DB.prepare('SELECT * FROM sentences WHERE id = ?').bind(id).first<any>()
    expect(s.status).toBe('reviewing')
    expect(s.stage).toBe(0)
    expect(s.anchor_on).toBe(today())
    expect(s.next_review_on).toBe(addDays(today(), 3))
    expect(await wordStatus(a)).toBe('in_sentence')
    expect(await wordStatus(b)).toBe('in_sentence')
    const n = await env.DB.prepare('SELECT COUNT(*) n FROM sentence_words WHERE sentence_id = ?').bind(id).first<any>()
    expect(n.n).toBe(2)
  })

  it('欠けた語は warning（200・未保存）、force=1 で保存し欠けた語も in_sentence', async () => {
    const a = await addWord(aliceId, 'miss-a')
    const b = await addWord(aliceId, 'miss-b')
    const payload = { englishMarked: '[[miss-a|miss-a]] only.', japanese: '訳', wordIds: [a, b] }
    const warn = await call(alice, 'POST', '/api/sentences', payload)
    expect(warn.status).toBe(200)
    expect(await warn.json()).toEqual({ warning: { missing: ['miss-b'] } })
    expect(await wordStatus(b)).toBe('waiting_sentence')
    const ok = await call(alice, 'POST', '/api/sentences?force=1', payload)
    expect((await ok.json<any>()).id).toBeTruthy()
    expect(await wordStatus(b)).toBe('in_sentence')
  })

  it('他人の語・対象外の語は 400', async () => {
    const bobs = await addWord(bobId, 'sv-bobs')
    const rev = await addWord(aliceId, 'sv-rev', 'reviewing')
    for (const wordIds of [[bobs], [rev]]) {
      const res = await call(alice, 'POST', '/api/sentences', { englishMarked: 'x', japanese: 'y', wordIds })
      expect(res.status).toBe(400)
    }
    expect(await wordStatus(bobs)).toBe('waiting_sentence')
  })
})

describe('PATCH / GET /api/sentences', () => {
  it('編集（警告・force）、一覧に語つき、他人は 404', async () => {
    const a = await addWord(eveId, 'ed-a')
    const b = await addWord(eveId, 'ed-b')
    const { id } = await (
      await call(eve, 'POST', '/api/sentences', {
        englishMarked: '[[ed-a|ed-a]] [[ed-b|ed-b]]',
        japanese: '旧',
        wordIds: [a, b],
      })
    ).json<any>()

    const edit = { englishMarked: '[[ed-a|ED-A]] only', japanese: '新' }
    const warn = await call(eve, 'PATCH', `/api/sentences/${id}`, edit)
    expect(await warn.json()).toEqual({ warning: { missing: ['ed-b'] } })
    expect((await (await call(eve, 'GET', '/api/sentences?status=reviewing')).json<any>())[0].japanese).toBe('旧')

    expect((await call(eve, 'PATCH', `/api/sentences/${id}?force=1`, edit)).status).toBe(200)
    const list = await (await call(eve, 'GET', '/api/sentences?status=reviewing')).json<any>()
    expect(list).toHaveLength(1)
    expect(list[0].japanese).toBe('新')
    expect(list[0].words.map((w: any) => w.english)).toEqual(['ed-a', 'ed-b'])
    expect(await (await call(eve, 'GET', '/api/sentences?status=mastered')).json()).toEqual([])
    expect((await call(eve, 'GET', '/api/sentences?status=bogus')).status).toBe(400)

    expect((await call(alice, 'PATCH', `/api/sentences/${id}`, { englishMarked: 'x', japanese: 'y' })).status).toBe(404)
    expect((await call(null, 'GET', '/api/sentences')).status).toBe(401)
  })
})

describe('二重保存・件数上限', () => {
  it('同じ語の 2 回目の保存は拒否され、文章は 1 つだけ', async () => {
    const fay = await login('fay-sent@example.com')
    const fayId = await userId('fay-sent@example.com')
    const a = await addWord(fayId, 'dup-a')
    const payload = { englishMarked: '[[dup-a|dup-a]]', japanese: '訳', wordIds: [a] }
    expect((await call(fay, 'POST', '/api/sentences', payload)).status).toBe(200)
    expect([400, 409]).toContain((await call(fay, 'POST', '/api/sentences', payload)).status)
    const n = await env.DB.prepare('SELECT COUNT(*) n FROM sentences WHERE user_id = ?').bind(fayId).first<any>()
    expect(n.n).toBe(1)
  })

  it('競合（検証後に別の文章へ使われた語）は 409 で何も書かない', async () => {
    const gus = await login('gus-sent@example.com')
    const gusId = await userId('gus-sent@example.com')
    const a = await addWord(gusId, 'race-a')
    const other = crypto.randomUUID()
    await env.DB.prepare(
      "INSERT INTO sentences (id, user_id, english_marked, japanese_text, anchor_on, status) VALUES (?, ?, 'x', 'y', ?, 'reviewing')",
    ).bind(other, gusId, today()).run()
    await env.DB.prepare('INSERT INTO sentence_words (sentence_id, word_id) VALUES (?, ?)').bind(other, a).run()
    const res = await call(gus, 'POST', '/api/sentences', { englishMarked: '[[race-a|race-a]]', japanese: '訳', wordIds: [a] })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_used' })
    const n = await env.DB.prepare('SELECT COUNT(*) n FROM sentences WHERE user_id = ?').bind(gusId).first<any>()
    expect(n.n).toBe(1)
  })

  it('wordIds が 11 件は 400（保存・再生成）、再生成は 4 件でも 400 で回数を消費しない', async () => {
    const hal = await login('hal-sent@example.com')
    const halId = await userId('hal-sent@example.com')
    setTextGenOverride(fakeGen())
    const ids: string[] = []
    for (let i = 0; i < 11; i++) ids.push(await addWord(halId, `hw${i}`))
    expect((await call(hal, 'POST', '/api/sentences', { englishMarked: 'x', japanese: 'y', wordIds: ids })).status).toBe(400)
    expect((await call(hal, 'POST', '/api/sentences/regenerate', { wordIds: ids })).status).toBe(400)
    expect((await call(hal, 'POST', '/api/sentences/regenerate', { wordIds: ids.slice(0, 4) })).status).toBe(400)
    const used = await env.DB.prepare('SELECT count FROM ai_usage WHERE user_id = ?').bind(halId).first<any>()
    expect(used).toBeNull()
  })
})
