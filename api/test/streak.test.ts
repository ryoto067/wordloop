import { describe, expect, it } from 'vitest'
import { currentStreak, isAchieved, type DayActivity } from '../src/domain/streak'

const day = (date: string, o: Partial<DayActivity> = {}): DayActivity => ({
  date,
  didRound: false,
  reviewsDone: 0,
  clearedAll: false,
  ...o,
})

describe('isAchieved', () => {
  it('周回・全消化・20件以上のいずれかで達成', () => {
    expect(isAchieved(day('2026-11-25', { didRound: true }))).toBe(true)
    expect(isAchieved(day('2026-11-25', { clearedAll: true }))).toBe(true)
    expect(isAchieved(day('2026-11-25', { reviewsDone: 20 }))).toBe(true)
  })
  it('reviewsDone 19 は未達成', () => {
    expect(isAchieved(day('2026-11-25', { reviewsDone: 19 }))).toBe(false)
  })
})

describe('currentStreak', () => {
  const ok = (date: string) => day(date, { didRound: true })
  it('今日が達成済みなら今日から数える', () => {
    expect(currentStreak([ok('2026-11-25'), ok('2026-11-24')], '2026-11-25')).toBe(2)
  })
  it('今日未達成でも昨日まで3日連続なら3', () => {
    const days = [ok('2026-11-22'), ok('2026-11-24'), ok('2026-11-23'), day('2026-11-25')]
    expect(currentStreak(days, '2026-11-25')).toBe(3)
  })
  it('昨日が未達成なら0、今日達成なら1', () => {
    const days = [ok('2026-11-23'), day('2026-11-24', { reviewsDone: 19 })]
    expect(currentStreak(days, '2026-11-25')).toBe(0)
    expect(currentStreak([...days, ok('2026-11-25')], '2026-11-25')).toBe(1)
  })
  it('欠けた日は未達成扱いで連続が切れる', () => {
    expect(currentStreak([ok('2026-11-25'), ok('2026-11-23')], '2026-11-25')).toBe(1)
  })
})
