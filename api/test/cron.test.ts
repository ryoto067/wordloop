import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { runCron } from '../src/push/cron'
import { b64uToBytes, bytesToB64u, encryptPayload, sendPush, vapidJwt, type PushPayload, type PushSub } from '../src/push/webpush'
import { login } from './helpers'

// 07:30 JST / 21:00 JST
const MORNING = new Date('2026-11-25T22:30:00Z')
const EVENING = new Date('2026-11-26T12:00:00Z')
const JST_DATE = '2026-11-26'

const userId = async (email: string) =>
  (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<any>()).id as string

async function setup(email: string, times: [string, string][], subs: string[], dueWords = 0) {
  await login(email)
  const uid = await userId(email)
  await env.DB.prepare('DELETE FROM notify_times WHERE user_id = ?').bind(uid).run() // 初期値（07:30/21:00）を外す
  for (const [hhmm, kind] of times) {
    await env.DB.prepare('INSERT INTO notify_times (id, user_id, hhmm, kind) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), uid, hhmm, kind)
      .run()
  }
  for (const endpoint of subs) {
    await env.DB.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), uid, endpoint, 'p', 'a')
      .run()
  }
  for (let i = 0; i < dueWords; i++) {
    await env.DB.prepare(
      "INSERT INTO words (id, user_id, english, japanese, anchor_on, next_review_on, status) VALUES (?, ?, ?, ?, ?, ?, 'reviewing')",
    )
      .bind(crypto.randomUUID(), uid, `w${i}`, `j${i}`, '2026-11-20', JST_DATE)
      .run()
  }
  return uid
}

function recorder(statusFor: (endpoint: string) => number = () => 201) {
  const calls: { endpoint: string; payload: PushPayload }[] = []
  const fn = async (_e: unknown, sub: PushSub, payload: PushPayload) => {
    calls.push({ endpoint: sub.endpoint, payload })
    return { status: statusFor(sub.endpoint) }
  }
  return { calls, fn }
}

const subCount = async (endpoint: string) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).first<any>()).n as number

describe('runCron', () => {
  beforeAll(async () => {
    await setup('cron-morning@example.com', [['07:30', 'morning']], ['https://p.example/morning'], 3)
    await setup('cron-evening@example.com', [['21:00', 'evening']], ['https://p.example/evening-pending'], 2)
    await setup('cron-done@example.com', [['21:00', 'evening']], ['https://p.example/evening-done'], 0)
    await setup('cron-nosub@example.com', [['07:30', 'morning']], [])
    await setup('cron-gone@example.com', [['07:30', 'morning']], ['https://p.example/gone', 'https://p.example/alive'])
  })

  it('sends the morning notification only to users whose local time matches', async () => {
    const r = recorder((e) => (e.endsWith('/gone') ? 410 : 201))
    const res = await runCron(env, MORNING, { sendPush: r.fn })
    const endpoints = r.calls.map((c) => c.endpoint).sort()
    expect(endpoints).toEqual(['https://p.example/alive', 'https://p.example/gone', 'https://p.example/morning'])
    const morning = r.calls.find((c) => c.endpoint.endsWith('/morning'))!
    expect(morning.payload).toEqual({ title: 'WordLoop', body: expect.stringContaining('単語 3'), url: '/' })
    expect(res).toEqual({ sent: 2, removed: 1 })
  })

  it('removes subscriptions that returned 410 and keeps the others', async () => {
    expect(await subCount('https://p.example/gone')).toBe(0)
    expect(await subCount('https://p.example/alive')).toBe(1)
    expect(await subCount('https://p.example/morning')).toBe(1)
  })

  it('sends the evening reminder to pending users but not to users who are done', async () => {
    const r = recorder()
    const res = await runCron(env, EVENING, { sendPush: r.fn })
    expect(r.calls.map((c) => c.endpoint)).toEqual(['https://p.example/evening-pending'])
    expect(r.calls[0].payload.body).toContain('単語 2')
    expect(res).toEqual({ sent: 1, removed: 0 })
  })

  it('sends nothing at a non-matching minute', async () => {
    const r = recorder()
    expect(await runCron(env, new Date('2026-11-25T22:31:00Z'), { sendPush: r.fn })).toEqual({ sent: 0, removed: 0 })
    expect(r.calls).toEqual([])
  })

  it('keeps going when a send throws or returns 5xx', async () => {
    await setup('cron-flaky@example.com', [['12:34', 'custom']], ['https://p.example/boom', 'https://p.example/5xx', 'https://p.example/fine'], 1)
    const calls: string[] = []
    const res = await runCron(env, new Date('2026-11-26T03:34:00Z'), {
      sendPush: async (_e, sub) => {
        calls.push(sub.endpoint)
        if (sub.endpoint.endsWith('/boom')) throw new Error('network down')
        return { status: sub.endpoint.endsWith('/5xx') ? 503 : 201 }
      },
    })
    expect(calls.sort()).toEqual(['https://p.example/5xx', 'https://p.example/boom', 'https://p.example/fine'])
    expect(res).toEqual({ sent: 1, removed: 0 })
    expect(await subCount('https://p.example/boom')).toBe(1)
  })
})

describe('web push crypto', () => {
  async function vapidEnv() {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const pub = new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer)
    const jwk = (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey
    return { kp, e: { ...env, VAPID_PUBLIC_KEY: bytesToB64u(pub), VAPID_PRIVATE_KEY: jwk.d!, VAPID_SUBJECT: 'mailto:test@example.com' } }
  }

  it('signs a verifiable ES256 VAPID JWT', async () => {
    const { kp, e } = await vapidEnv()
    const jwt = await vapidJwt(e, 'https://push.example', 1_000_000)
    const [h, p, s] = jwt.split('.')
    expect(JSON.parse(atob(h))).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')))).toEqual({
      aud: 'https://push.example',
      exp: 1_000_000 + 43200,
      sub: 'mailto:test@example.com',
    })
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, b64uToBytes(s), new TextEncoder().encode(`${h}.${p}`))
    expect(ok).toBe(true)
  })

  it('sends an aes128gcm body the subscriber can decrypt, with VAPID headers', async () => {
    const { e } = await vapidEnv()
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    const uaPub = new Uint8Array((await crypto.subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer)
    const auth = crypto.getRandomValues(new Uint8Array(16))
    const sub: PushSub = { endpoint: 'https://push.example/send/xyz', p256dh: bytesToB64u(uaPub), auth: bytesToB64u(auth) }
    const payload = { title: 'WordLoop', body: '今日の復習 単語 3', url: '/' }

    let seen: { url: string; init: RequestInit } | undefined
    const res = await sendPush(e, sub, payload, (async (url: string, init: RequestInit) => {
      seen = { url, init }
      return new Response(null, { status: 201 })
    }) as unknown as typeof fetch)
    expect(res).toEqual({ status: 201 })

    expect(seen!.url).toBe(sub.endpoint)
    const h = seen!.init.headers as Record<string, string>
    expect(h['Content-Encoding']).toBe('aes128gcm')
    expect(h.TTL).toBe('43200')
    expect(h.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/)
    expect(h.Authorization.endsWith(`k=${e.VAPID_PUBLIC_KEY}`)).toBe(true)

    // 受信側として復号する（RFC 8291）
    const body = seen!.init.body as Uint8Array
    const salt = body.slice(0, 16)
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096)
    expect(body[20]).toBe(65)
    const asPub = body.slice(21, 86)
    const cipher = body.slice(86)
    const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, ua.privateKey, 256))
    const hkdf = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
      new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: 'HKDF', hash: 'SHA-256', salt: s as BufferSource, info: info as BufferSource },
          await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']),
          n * 8,
        ),
      )
    const te = new TextEncoder()
    const info = new Uint8Array([...te.encode('WebPush: info\0'), ...uaPub, ...asPub])
    const prk = await hkdf(auth, shared, info, 32)
    const cek = await hkdf(salt, prk, te.encode('Content-Encoding: aes128gcm\0'), 16)
    const nonce = await hkdf(salt, prk, te.encode('Content-Encoding: nonce\0'), 12)
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce },
        await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']),
        cipher,
      ),
    )
    expect(plain[plain.length - 1]).toBe(2)
    expect(JSON.parse(new TextDecoder().decode(plain.slice(0, -1)))).toEqual(payload)
  })

  it('uses a fresh salt and ephemeral key on every encryption', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    const sub: PushSub = {
      endpoint: 'https://push.example/x',
      p256dh: bytesToB64u(new Uint8Array((await crypto.subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer)),
      auth: bytesToB64u(crypto.getRandomValues(new Uint8Array(16))),
    }
    const a = await encryptPayload(sub, new Uint8Array([104, 105]))
    const b = await encryptPayload(sub, new Uint8Array([104, 105]))
    expect(bytesToB64u(a)).not.toBe(bytesToB64u(b))
  })
})
