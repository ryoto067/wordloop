import { localHHMM } from "../domain/dates";
import { buildNotification, type NotifyKind } from "../domain/notify";
import type { Env } from "../env";
import { getTodayStats, type TodayStats } from "../stats";
import { sendPush, type SendPush } from "./webpush";

type TimeRow = { user_id: string; kind: NotifyKind; hhmm: string; timezone: string };
type SubRow = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

const SUB_CHUNK = 50; // D1 のバインド変数上限に収めるための分割

export async function runCron(
  env: Env,
  now: Date,
  deps: { sendPush?: SendPush } = {},
): Promise<{ sent: number; removed: number }> {
  const send = deps.sendPush ?? sendPush;
  const { results } = await env.DB.prepare(
    "SELECT n.user_id, n.kind, n.hhmm, u.timezone FROM notify_times n JOIN users u ON u.id = n.user_id",
  ).all<TimeRow>();
  const matched = results.filter((r) => localHHMM(now, r.timezone) === r.hhmm);
  const result = { sent: 0, removed: 0 };
  if (matched.length === 0) return result;

  const userIds = [...new Set(matched.map((m) => m.user_id))];
  const subsByUser = new Map<string, SubRow[]>();
  for (let i = 0; i < userIds.length; i += SUB_CHUNK) {
    const ids = userIds.slice(i, i + SUB_CHUNK);
    const { results: subs } = await env.DB.prepare(
      `SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(...ids)
      .all<SubRow>();
    for (const s of subs) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) ?? []), s]);
  }

  const statsByUser = new Map<string, TodayStats>();
  const removedIds = new Set<string>();
  for (const m of matched) {
    try {
      const subs = subsByUser.get(m.user_id);
      if (!subs?.length) continue;
      let stats = statsByUser.get(m.user_id);
      if (!stats) {
        stats = await getTodayStats(env.DB, m.user_id, m.timezone, now);
        statsByUser.set(m.user_id, stats);
      }
      const n = buildNotification(m.kind, stats);
      if (!n) continue;
      for (const s of subs) {
        if (removedIds.has(s.id)) continue;
        try {
          const { status } = await send(env, s, { ...n, url: "/" });
          if (status === 404 || status === 410) {
            await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(s.id).run();
            removedIds.add(s.id);
            result.removed++;
          } else if (status >= 200 && status < 300) {
            result.sent++;
          } else {
            console.error(`push failed: status ${status}`);
          }
        } catch (e) {
          console.error("push error", e);
        }
      }
    } catch (e) {
      console.error("cron error", e);
    }
  }
  return result;
}
