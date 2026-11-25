import { beforeAll, describe, expect, it } from 'vitest'
import { call, login } from './helpers'

let alice: { cookie: string }
let bob: { cookie: string }

beforeAll(async () => {
  alice = await login('settings-alice@example.com')
  bob = await login('settings-bob@example.com')
})

describe('GET/PATCH /api/settings', () => {
  it('returns defaults and requires login', async () => {
    expect((await call(null, 'GET', '/api/settings')).status).toBe(401)
    const res = await call(alice, 'GET', '/api/settings')
    expect(await res.json()).toEqual({
      timezone: 'Asia/Tokyo',
      wordIntervals: [1, 3, 7, 14, 30],
      sentenceIntervals: [3, 7, 14, 30, 60],
      fontScale: 1,
    })
  })

  it('updates valid values and returns the new settings', async () => {
    const res = await call(alice, 'PATCH', '/api/settings', {
      timezone: 'America/New_York',
      wordIntervals: [2, 5],
      sentenceIntervals: [1, 2, 3, 4, 5, 6, 7, 365],
      fontScale: 1.15,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      timezone: 'America/New_York',
      wordIntervals: [2, 5],
      sentenceIntervals: [1, 2, 3, 4, 5, 6, 7, 365],
      fontScale: 1.15,
    })
    const me = (await (await call(alice, 'GET', '/api/me')).json()) as any
    expect(me.wordIntervals).toEqual([2, 5])
  })

  it('allows partial updates', async () => {
    const res = await call(bob, 'PATCH', '/api/settings', { fontScale: 0.9 })
    expect(((await res.json()) as any).fontScale).toBe(0.9)
  })

  it.each([
    ['not ascending', { wordIntervals: [3, 1] }],
    ['duplicate', { wordIntervals: [3, 3] }],
    ['empty', { wordIntervals: [] }],
    ['too many', { sentenceIntervals: [1, 2, 3, 4, 5, 6, 7, 8, 9] }],
    ['out of range high', { wordIntervals: [1, 366] }],
    ['zero', { wordIntervals: [0, 1] }],
    ['non-integer', { wordIntervals: [1.5, 2] }],
    ['not array', { wordIntervals: 3 }],
    ['bad timezone', { timezone: 'Mars/Olympus' }],
    ['bad fontScale', { fontScale: 2 }],
  ])('rejects %s with 400 and changes nothing', async (_n, body) => {
    const before = await (await call(bob, 'GET', '/api/settings')).json()
    expect((await call(bob, 'PATCH', '/api/settings', body)).status).toBe(400)
    expect(await (await call(bob, 'GET', '/api/settings')).json()).toEqual(before)
  })
})

describe('notify-times', () => {
  it('has the default morning/evening times, then create / update / delete', async () => {
    const hhmms = async () =>
      ((await (await call(alice, 'GET', '/api/settings/notify-times')).json()) as any[]).map((t) => `${t.hhmm}/${t.kind}`)
    expect(await hhmms()).toEqual(['07:30/morning', '21:00/evening'])

    const created = await call(alice, 'POST', '/api/settings/notify-times', { hhmm: '12:00', kind: 'custom' })
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as any
    expect(await hhmms()).toEqual(['07:30/morning', '12:00/custom', '21:00/evening'])

    const patched = await call(alice, 'PATCH', `/api/settings/notify-times/${id}`, { hhmm: '08:15' })
    expect(await patched.json()).toEqual({ id, hhmm: '08:15', kind: 'custom' })
    const kindOnly = await call(alice, 'PATCH', `/api/settings/notify-times/${id}`, { kind: 'morning' })
    expect(await kindOnly.json()).toEqual({ id, hhmm: '08:15', kind: 'morning' })

    expect((await call(alice, 'DELETE', `/api/settings/notify-times/${id}`)).status).toBe(200)
    expect(await hhmms()).toEqual(['07:30/morning', '21:00/evening'])
  })

  it('validates hhmm and kind', async () => {
    for (const body of [
      { hhmm: '7:30', kind: 'morning' },
      { hhmm: '24:00', kind: 'morning' },
      { hhmm: '07:60', kind: 'morning' },
      { hhmm: '07:30', kind: 'noon' },
      { kind: 'custom' },
    ]) {
      expect((await call(alice, 'POST', '/api/settings/notify-times', body)).status).toBe(400)
    }
  })

  it("returns 404 for another user's id and leaves it intact", async () => {
    const { id } = (await (await call(alice, 'POST', '/api/settings/notify-times', { hhmm: '10:00', kind: 'custom' })).json()) as any
    expect((await call(bob, 'PATCH', `/api/settings/notify-times/${id}`, { hhmm: '11:00' })).status).toBe(404)
    expect((await call(bob, 'DELETE', `/api/settings/notify-times/${id}`)).status).toBe(404)
    const theirs = (await (await call(bob, 'GET', '/api/settings/notify-times')).json()) as any[]
    expect(theirs.some((t) => t.id === id)).toBe(false)
    const mine = (await (await call(alice, 'GET', '/api/settings/notify-times')).json()) as any[]
    expect(mine.find((t) => t.id === id)?.hhmm).toBe('10:00')
  })
})

describe('push subscription routes', () => {
  const sub = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'P', auth: 'A' } }

  it('serves the public key', async () => {
    const res = await call(alice, 'GET', '/api/push/public-key')
    expect(res.status).toBe(200)
    expect(Object.keys((await res.json()) as object)).toEqual(['publicKey'])
  })

  it('upserts by endpoint and unsubscribes', async () => {
    const { env } = await import('cloudflare:workers')
    expect((await call(alice, 'POST', '/api/push/subscribe', sub)).status).toBe(200)
    expect((await call(alice, 'POST', '/api/push/subscribe', { ...sub, keys: { p256dh: 'P2', auth: 'A2' } })).status).toBe(200)
    const rows = (await env.DB.prepare('SELECT p256dh FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).all()).results
    expect(rows).toEqual([{ p256dh: 'P2' }])

    expect((await call(alice, 'POST', '/api/push/subscribe', { endpoint: 'x' })).status).toBe(400)
    expect((await call(alice, 'POST', '/api/push/subscribe', { ...sub, endpoint: 'http://insecure.example.com' })).status).toBe(400)

    // 他人の endpoint は消せない
    await call(bob, 'POST', '/api/push/unsubscribe', { endpoint: sub.endpoint })
    expect((await env.DB.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).all()).results).toHaveLength(1)
    await call(alice, 'POST', '/api/push/unsubscribe', { endpoint: sub.endpoint })
    expect((await env.DB.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).all()).results).toHaveLength(0)
  })
})
