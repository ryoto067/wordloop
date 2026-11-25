import { env } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { localDate } from "../src/domain/dates";

const ORIGIN = "http://localhost:5173";
const KID = "test-key";
let privateKey: CryptoKey;
let jwk: Record<string, unknown>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256", use: "sig" };
});

afterEach(() => vi.restoreAllMocks());

function signIdToken(over: { sub?: string; aud?: string; iss?: string; email?: string; name?: string } = {}) {
  return new SignJWT({ email: over.email ?? "a@example.com", name: over.name ?? "Alice" })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setSubject(over.sub ?? "google-sub-1")
    .setIssuer(over.iss ?? "https://accounts.google.com")
    .setAudience(over.aud ?? env.GOOGLE_CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

function mockGoogle(idToken: string) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ id_token: idToken });
    if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] });
    throw new Error(`unexpected fetch ${url}`);
  });
}

function cookieValue(res: Response, name: string): string | undefined {
  for (const line of res.headers.getSetCookie()) {
    const m = line.match(new RegExp(`^${name}=([^;]*)`));
    if (m && m[1]) return m[1];
  }
  return undefined;
}

const req = (path: string, init?: RequestInit, e: object = env) => app.request(`${ORIGIN}${path}`, init, e);

async function startLogin() {
  const res = await req("/api/auth/google");
  const stateCookie = cookieValue(res, "wl_state")!;
  const state = new URL(res.headers.get("location")!).searchParams.get("state")!;
  return { res, stateCookie, state };
}

describe("GET /api/auth/google", () => {
  it("state を wl_state Cookie に入れ Google へ 302", async () => {
    const { res, stateCookie, state } = await startLogin();
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(loc.searchParams.get("scope")).toBe("openid email profile");
    expect(loc.searchParams.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(loc.searchParams.get("redirect_uri")).toBe(`${env.APP_ORIGIN}/api/auth/google/callback`);
    expect(stateCookie.startsWith(`${state}.`)).toBe(true);
    const setCookie = res.headers.getSetCookie().find((l) => l.startsWith("wl_state="))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });
});

describe("GET /api/auth/google/callback", () => {
  it("state 不一致は /login?error=failed へ 302", async () => {
    const { stateCookie } = await startLogin();
    const res = await req("/api/auth/google/callback?code=abc&state=wrong", {
      headers: { cookie: `wl_state=${stateCookie}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=failed");
  });

  it("state Cookie なしは /login?error=failed へ 302", async () => {
    const res = await req("/api/auth/google/callback?code=abc&state=x");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=failed");
  });

  it("Cookie の署名が改ざんされていたら /login?error=failed へ 302", async () => {
    const { state } = await startLogin();
    const res = await req(`/api/auth/google/callback?code=abc&state=${state}`, {
      headers: { cookie: `wl_state=${state}.forged` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=failed");
  });

  it("Google が access_denied を返したら /login?error=denied へ 302", async () => {
    const res = await req("/api/auth/google/callback?error=access_denied");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=denied");
  });

  it("access_denied 以外の error は /login?error=failed へ 302", async () => {
    const res = await req("/api/auth/google/callback?error=server_error");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=failed");
  });

  it("正常: 302 + wl_session、users 1 行・notify_times 2 行、/api/me が通る", async () => {
    const fetchSpy = mockGoogle(await signIdToken());
    const { stateCookie, state } = await startLogin();
    const res = await req(`/api/auth/google/callback?code=abc&state=${state}`, {
      headers: { cookie: `wl_state=${stateCookie}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const tokenCall = fetchSpy.mock.calls.find((c) => String(c[0]) === "https://oauth2.googleapis.com/token")!;
    expect((tokenCall[1]!.body as URLSearchParams).get("code")).toBe("abc");

    const line = res.headers.getSetCookie().find((l) => l.startsWith("wl_session="))!;
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/Secure/i);
    expect(line).toMatch(/SameSite=Lax/i);
    expect(line).toMatch(/Path=\//);
    expect(line).toMatch(/Max-Age=7776000/);
    const session = cookieValue(res, "wl_session")!;
    expect(session.length).toBeGreaterThanOrEqual(43);

    const user = await env.DB.prepare("SELECT id, email, name FROM users WHERE google_sub = 'google-sub-1'").first<{
      id: string; email: string; name: string;
    }>();
    expect(user).toMatchObject({ email: "a@example.com", name: "Alice" });
    const { results: times } = await env.DB.prepare("SELECT hhmm, kind FROM notify_times WHERE user_id = ? ORDER BY hhmm")
      .bind(user!.id)
      .all();
    expect(times).toEqual([
      { hhmm: "07:30", kind: "morning" },
      { hhmm: "21:00", kind: "evening" },
    ]);

    const me = await req("/api/me", { headers: { cookie: `wl_session=${session}` } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      id: user!.id,
      name: "Alice",
      email: "a@example.com",
      timezone: "Asia/Tokyo",
      wordIntervals: [1, 3, 7, 14, 30],
      sentenceIntervals: [3, 7, 14, 30, 60],
      fontScale: 1,
      streak: 0,
      today: { dueWords: 0, dueSentences: 0, waitingWords: 0, doneToday: true },
    });
  });

  it("2 回目のログインは users を増やさない", async () => {
    mockGoogle(await signIdToken({ sub: "google-sub-2", email: "b@example.com" }));
    for (let i = 0; i < 2; i++) {
      const { stateCookie, state } = await startLogin();
      const res = await req(`/api/auth/google/callback?code=abc&state=${state}`, {
        headers: { cookie: `wl_state=${stateCookie}` },
      });
      expect(res.status).toBe(302);
    }
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE google_sub = 'google-sub-2'").first<{ n: number }>();
    expect(n!.n).toBe(1);
    const t = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notify_times WHERE user_id = (SELECT id FROM users WHERE google_sub = 'google-sub-2')",
    ).first<{ n: number }>();
    expect(t!.n).toBe(2);
  });

  it.each([
    ["aud が違う", { aud: "someone-else" }],
    ["iss が違う", { iss: "https://evil.example.com" }],
  ])("id_token の %s は /login?error=failed へ 302 でセッションを作らない", async (_name, over) => {
    mockGoogle(await signIdToken({ ...over, sub: "google-sub-bad", email: "bad@example.com" }));
    const { stateCookie, state } = await startLogin();
    const res = await req(`/api/auth/google/callback?code=abc&state=${state}`, {
      headers: { cookie: `wl_state=${stateCookie}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=failed");
    expect(cookieValue(res, "wl_session")).toBeUndefined();
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE google_sub = 'google-sub-bad'").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});

describe("requireUser / session", () => {
  it("Cookie なしの /api/me は 401", async () => {
    expect((await req("/api/me")).status).toBe(401);
  });

  it("存在しないセッション ID は 401", async () => {
    expect((await req("/api/me", { headers: { cookie: "wl_session=nope" } })).status).toBe(401);
  });

  it("期限切れセッションは 401", async () => {
    await env.DB.prepare("INSERT INTO users (id, google_sub, email, name) VALUES ('u-exp', 'sub-exp', 'e@x.com', 'E')").run();
    await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES ('expired-sid', 'u-exp', ?)")
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();
    expect((await req("/api/me", { headers: { cookie: "wl_session=expired-sid" } })).status).toBe(401);
  });

  it("logout でセッションが消え 401 になる", async () => {
    const devEnv = { ...env, DEV_LOGIN: "1" };
    const login = await req("/api/auth/dev-login", jsonPost({ email: "out@example.com" }), devEnv);
    const session = cookieValue(login, "wl_session")!;
    const cookie = { cookie: `wl_session=${session}` };
    expect((await req("/api/me", { headers: cookie })).status).toBe(200);
    const out = await req("/api/auth/logout", { method: "POST", headers: cookie });
    expect(out.status).toBe(200);
    expect((await req("/api/me", { headers: cookie })).status).toBe(401);
  });
});

function jsonPost(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("POST /api/auth/dev-login", () => {
  it("DEV_LOGIN 未設定は 404", async () => {
    // api/.dev.vars に DEV_LOGIN=1 があっても影響を受けないよう、明示的に未設定にする
    const res = await req("/api/auth/dev-login", jsonPost({ email: "dev@example.com" }), { ...env, DEV_LOGIN: undefined });
    expect(res.status).toBe(404);
  });

  it("DEV_LOGIN=1 ならログインでき、notify_times も作られる", async () => {
    const res = await req("/api/auth/dev-login", jsonPost({ email: "dev@example.com" }), { ...env, DEV_LOGIN: "1" });
    expect(res.status).toBe(200);
    expect(cookieValue(res, "wl_session")).toBeTruthy();
    const u = await env.DB.prepare("SELECT id, google_sub FROM users WHERE email = 'dev@example.com'").first<{
      id: string; google_sub: string;
    }>();
    expect(u!.google_sub).toBe("dev:dev@example.com");
    const t = await env.DB.prepare("SELECT COUNT(*) AS n FROM notify_times WHERE user_id = ?").bind(u!.id).first<{ n: number }>();
    expect(t!.n).toBe(2);
  });
});

describe("GET /api/me の today", () => {
  it("期日・待機・連続日数を集計する", async () => {
    const devEnv = { ...env, DEV_LOGIN: "1" };
    const login = await req("/api/auth/dev-login", jsonPost({ email: "stats@example.com" }), devEnv);
    const session = cookieValue(login, "wl_session")!;
    const u = await env.DB.prepare("SELECT id FROM users WHERE email = 'stats@example.com'").first<{ id: string }>();
    const uid = u!.id;
    const today = localDate(new Date(), "Asia/Tokyo");
    const yesterday = localDate(new Date(Date.now() - 86400_000), "Asia/Tokyo");
    const tomorrow = localDate(new Date(Date.now() + 86400_000), "Asia/Tokyo");
    const w = (id: string, status: string, next: string | null) =>
      env.DB.prepare(
        "INSERT INTO words (id, user_id, english, japanese, anchor_on, next_review_on, status) VALUES (?, ?, ?, 'x', ?, ?, ?)",
      ).bind(id, uid, id, today, next, status);
    await env.DB.batch([
      w("w1", "reviewing", yesterday),
      w("w2", "reviewing", today),
      w("w3", "reviewing", tomorrow),
      w("w4", "waiting_sentence", null),
      env.DB.prepare(
        "INSERT INTO sentences (id, user_id, english_marked, japanese_text, anchor_on, next_review_on, status) VALUES ('s1', ?, 'e', 'j', ?, ?, 'reviewing')",
      ).bind(uid, today, today),
      env.DB.prepare("INSERT INTO daily_activity (user_id, date, did_round) VALUES (?, ?, 1)").bind(uid, yesterday),
      env.DB.prepare("INSERT INTO daily_activity (user_id, date, cleared_all) VALUES (?, ?, 1)").bind(uid, today),
    ]);
    const me = await req("/api/me", { headers: { cookie: `wl_session=${session}` } });
    const body = (await me.json()) as { streak: number; today: unknown };
    expect(body.streak).toBe(2);
    expect(body.today).toEqual({ dueWords: 2, dueSentences: 1, waitingWords: 1, doneToday: false });
  });
});
