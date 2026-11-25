import { Hono } from "hono";
import { authRoutes } from "./auth/google";
import type { AppEnv, Env } from "./env";
import { runCron } from "./push/cron";
import { meRoutes } from "./routes/me";
import { pushRoutes } from "./routes/push";
import { settingsRoutes } from "./routes/settings";
import { roundRoutes } from "./routes/rounds";
import { reviewRoutes } from "./routes/reviews";
import { sentenceRoutes } from "./routes/sentences";
import { wordRoutes } from "./routes/words";

export const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/", authRoutes);
app.route("/", meRoutes);
app.route("/", wordRoutes);
app.route("/", roundRoutes);
app.route("/", reviewRoutes);
app.route("/", sentenceRoutes);
app.route("/", settingsRoutes);
app.route("/", pushRoutes);

async function scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
  ctx.waitUntil(runCron(env, new Date(event.scheduledTime)));
}

export default { fetch: app.fetch, scheduled };
