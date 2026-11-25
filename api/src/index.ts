import { Hono } from "hono";
import { authRoutes } from "./auth/google";
import type { AppEnv, Env } from "./env";
import { meRoutes } from "./routes/me";
import { roundRoutes } from "./routes/rounds";
import { wordRoutes } from "./routes/words";

export const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/", authRoutes);
app.route("/", meRoutes);
app.route("/", wordRoutes);
app.route("/", roundRoutes);

// 通知の送信は Task 9 で実装する
async function scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext) {}

export default { fetch: app.fetch, scheduled };
