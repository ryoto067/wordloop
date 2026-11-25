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

// D1 へのクエリ数を数える（first/all/run/raw は各 1、batch は全体で 1）
export async function callCounting(who: { cookie: string } | null, method: string, path: string, body?: unknown) {
  let queries = 0;
  const RAW = Symbol("raw");
  const wrapStmt = (stmt: any): any =>
    new Proxy(stmt, {
      get(t, k) {
        if (k === RAW) return t;
        if (k === "bind") return (...a: unknown[]) => wrapStmt(t.bind(...a));
        if (k === "first" || k === "all" || k === "run" || k === "raw") {
          return (...a: unknown[]) => {
            queries++;
            return t[k](...a);
          };
        }
        const v = t[k];
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  const db: any = new Proxy(env.DB, {
    get(t: any, k) {
      if (k === "prepare") return (sql: string) => wrapStmt(t.prepare(sql));
      if (k === "batch") {
        return (stmts: any[]) => {
          queries++;
          return t.batch(stmts.map((s) => s[RAW] ?? s));
        };
      }
      const v = t[k];
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  const headers: Record<string, string> = {};
  if (who) headers.cookie = who.cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(
    `${ORIGIN}${path}`,
    { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DB: db },
  );
  return { res, queries };
}
