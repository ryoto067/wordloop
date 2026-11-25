import { env } from "cloudflare:workers";
import { app } from "../src/index";

export const ORIGIN = "http://localhost:5173";
const devEnv = { ...env, DEV_LOGIN: "1" };

export async function login(email: string): Promise<{ cookie: string }> {
  const res = await app.request(
    `${ORIGIN}/api/auth/dev-login`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) },
    devEnv,
  );
  const m = res.headers.getSetCookie().join(";").match(/wl_session=([^;]+)/);
  return { cookie: `wl_session=${m![1]}` };
}

export function call(who: { cookie: string } | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (who) headers.cookie = who.cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(
    `${ORIGIN}${path}`,
    { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
}
