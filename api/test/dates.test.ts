import { describe, expect, it } from 'vitest'
import { addDays, localDate, localHHMM } from '../src/domain/dates'

describe('dates', () => {
  it('localDate は指定タイムゾーンの日付を返す', () => {
    expect(localDate(new Date('2026-11-25T14:59:00Z'), 'Asia/Tokyo')).toBe('2026-11-25')
    expect(localDate(new Date('2026-11-25T15:01:00Z'), 'Asia/Tokyo')).toBe('2026-11-26')
  })
  it('localHHMM は指定タイムゾーンの HH:MM を返す', () => {
    expect(localHHMM(new Date('2026-11-24T22:30:00Z'), 'Asia/Tokyo')).toBe('07:30')
  })
  it('addDays は月・年またぎでも正しい', () => {
    expect(addDays('2026-11-28', 5)).toBe('2026-12-03')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})
