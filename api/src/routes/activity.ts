import { Hono } from "hono";
import { requireUser } from "../auth/middleware";
import { isAchieved } from "../domain/streak";
import type { AppEnv } from "../env";

export const activityRoutes = new Hono<AppEnv>();

// 月カレンダー用: その月の記録がある日と、連続日数の達成条件を満たしたか
activityRoutes.get("/api/activity", requireUser, async (c) => {
  const month = c.req.query("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return c.json({ error: "invalid month" }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT date, did_round AS didRound, reviews_done AS reviewsDone, cleared_all AS clearedAll
     FROM daily_activity WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date`,
  )
    .bind(c.get("userId"), `${month}-01`, `${month}-31`)
    .all<{ date: string; didRound: number; reviewsDone: number; clearedAll: number }>();
  return c.json(
    results.map((r) => ({
      date: r.date,
      achieved: isAchieved({ date: r.date, didRound: !!r.didRound, reviewsDone: r.reviewsDone, clearedAll: !!r.clearedAll }),
    })),
  );
});
