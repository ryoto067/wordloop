import type { Env } from "../env";

// Web Crypto だけで実装した Web Push（VAPID: RFC 8292 / 暗号化: RFC 8291 aes128gcm）
export type PushSub = { endpoint: string; p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; url: string };
export type SendPush = (env: Env, sub: PushSub, payload: PushPayload) => Promise<{ status: number }>;

const TTL_SECONDS = 60 * 60 * 12;
const RECORD_SIZE = 4096;
type Bytes = Uint8Array<ArrayBuffer>;
const enc = new TextEncoder();
const encode = (s: string): Bytes => new Uint8Array(enc.encode(s));

export function b64uToBytes(s: string): Bytes {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export function bytesToB64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, len: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}

export async function vapidJwt(env: Env, audience: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const pub = b64uToBytes(env.VAPID_PUBLIC_KEY); // 0x04 || x(32) || y(32)
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: env.VAPID_PRIVATE_KEY, x: bytesToB64u(pub.slice(1, 33)), y: bytesToB64u(pub.slice(33, 65)) },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const part = (o: object) => bytesToB64u(encode(JSON.stringify(o)));
  const input = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: audience, exp: nowSec + TTL_SECONDS, sub: env.VAPID_SUBJECT })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encode(input)));
  return `${input}.${bytesToB64u(sig)}`;
}

export async function encryptPayload(sub: PushSub, plaintext: Bytes): Promise<Bytes> {
  const uaPublic = b64uToBytes(sub.p256dh);
  const authSecret = b64uToBytes(sub.auth);
  const as = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", as.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, as.privateKey, 256));

  const prk = await hkdf(authSecret, shared, concat(encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, prk, encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prk, encode("Content-Encoding: nonce\0"), 12);

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = concat(plaintext, new Uint8Array([2])); // 最終レコードの区切り
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, record));

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

export async function sendPush(
  env: Env,
  sub: PushSub,
  payload: PushPayload,
  fetchFn: typeof fetch = fetch,
): Promise<{ status: number }> {
  const jwt = await vapidJwt(env, new URL(sub.endpoint).origin);
  const body = await encryptPayload(sub, encode(JSON.stringify(payload)));
  const res = await fetchFn(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(TTL_SECONDS),
      Urgency: "normal",
    },
    body,
  });
  return { status: res.status };
}
