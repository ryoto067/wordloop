import { localDate } from "./domain/dates";
import { currentStreak, type DayActivity } from "./domain/streak";

export type TodayStats = {
  dueWords: number;
  dueSentences: number;
  waitingWords: number;
  doneToday: boolean;
  streak: number;
};

type Count = { n: number };
type ActivityRow = { date: string; did_round: number; reviews_done: number; cleared_all: number };

export async function getTodayStats(db: D1Database, userId: string, tz: string, now: Date): Promise<TodayStats> {
  const today = localDate(now, tz);
  const [due, sdue, waiting, acts] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM words WHERE user_id = ? AND status = 'reviewing' AND next_review_on <= ?").bind(userId, today),
    db.prepare("SELECT COUNT(*) AS n FROM sentences WHERE user_id = ? AND status = 'reviewing' AND next_review_on <= ?").bind(userId, today),
    db.prepare("SELECT COUNT(*) AS n FROM words WHERE user_id = ? AND status = 'waiting_sentence'").bind(userId),
    db.prepare("SELECT date, did_round, reviews_done, cleared_all FROM daily_activity WHERE user_id = ?").bind(userId),
  ]);
  const dueWords = (due.results[0] as Count).n;
  const dueSentences = (sdue.results[0] as Count).n;
  const days: DayActivity[] = (acts.results as ActivityRow[]).map((r) => ({
    date: r.date,
    didRound: r.did_round === 1,
    reviewsDone: r.reviews_done,
    clearedAll: r.cleared_all === 1,
  }));
  return {
    dueWords,
    dueSentences,
    waitingWords: (waiting.results[0] as Count).n,
    doneToday: dueWords + dueSentences === 0,
    streak: currentStreak(days, today),
  };
}
