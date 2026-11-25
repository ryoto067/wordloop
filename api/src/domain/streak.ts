import { addDays } from './dates'

export type DayActivity = {
  date: string
  didRound: boolean
  reviewsDone: number
  clearedAll: boolean
}

export const DAILY_REVIEW_GOAL = 20

export function isAchieved(d: DayActivity): boolean {
  return d.didRound || d.clearedAll || d.reviewsDone >= DAILY_REVIEW_GOAL
}

// days は未ソート・欠けありでもよい（欠けた日は未達成扱い）。
export function currentStreak(days: DayActivity[], today: string): number {
  const achieved = new Set(days.filter(isAchieved).map((d) => d.date))
  let cursor = achieved.has(today) ? today : addDays(today, -1)
  let count = 0
  while (achieved.has(cursor)) {
    count++
    cursor = addDays(cursor, -1)
  }
  return count
}
