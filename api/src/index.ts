import { Hono } from "hono";
import type { AppEnv, Env } from "./env";

export const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ ok: true }));

// 通知の送信は Task 9 で実装する
async function scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext) {}

export default { fetch: app.fetch, scheduled };
