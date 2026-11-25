import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { getSessionUserId } from "./session";

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", userId);
  await next();
});
