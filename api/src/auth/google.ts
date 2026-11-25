import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv } from "../env";
import { base64url, createSession, destroySession, randomId, upsertUser } from "./session";

const STATE_COOKIE = "wl_state";
const STATE_MAX_AGE = 600;
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/api/auth/google", async (c) => {
  const state = randomId(16);
  const sig = await hmac(c.env.SESSION_SECRET, state);
  setCookie(c, STATE_COOKIE, `${state}.${sig}`, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: STATE_MAX_AGE,
  });
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${c.env.APP_ORIGIN}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
});

authRoutes.get("/api/auth/google/callback", async (c) => {
  const fail = (code: "denied" | "failed") => c.redirect(`/login?error=${code}`, 302);
  const oauthError = c.req.query("error");
  if (oauthError) {
    deleteCookie(c, STATE_COOKIE, { path: "/", secure: true });
    return fail(oauthError === "access_denied" ? "denied" : "failed");
  }
  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookie = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/", secure: true });
  if (!code || !state || !cookie) return fail("failed");
  const [cState, cSig] = cookie.split(".");
  if (!cState || !cSig || !safeEqual(cState, state) || !safeEqual(cSig, await hmac(c.env.SESSION_SECRET, cState))) {
    return fail("failed");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${c.env.APP_ORIGIN}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return fail("failed");
  const { id_token } = (await tokenRes.json()) as { id_token?: string };
  if (!id_token) return fail("failed");

  let payload;
  try {
    ({ payload } = await jwtVerify(id_token, jwks, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: c.env.GOOGLE_CLIENT_ID,
    }));
  } catch {
    return fail("failed");
  }
  const email = typeof payload.email === "string" ? payload.email : null;
  if (!payload.sub || !email) return fail("failed");

  const userId = await upsertUser(c.env.DB, {
    googleSub: payload.sub,
    email,
    name: typeof payload.name === "string" && payload.name ? payload.name : email,
  });
  await createSession(c, userId);
  return c.redirect("/", 302);
});

authRoutes.post("/api/auth/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

// E2E 用。DEV_LOGIN=1 のときだけ有効
authRoutes.post("/api/auth/dev-login", async (c) => {
  if (c.env.DEV_LOGIN !== "1") return c.notFound();
  const body = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
  const email = body.email?.trim();
  if (!email) return c.json({ error: "email required" }, 400);
  const userId = await upsertUser(c.env.DB, { googleSub: `dev:${email}`, email, name: email.split("@")[0] });
  await createSession(c, userId);
  return c.json({ ok: true, userId });
});
