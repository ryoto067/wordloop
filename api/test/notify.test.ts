import { describe, expect, it } from 'vitest'
import { buildNotification, type NotifyStats } from '../src/domain/notify'

const stats = (o: Partial<NotifyStats> = {}): NotifyStats => ({
  dueWords: 5,
  dueSentences: 2,
  streak: 3,
  waitingWords: 0,
  doneToday: false,
  ...o,
})

describe('buildNotification', () => {
  it('morning', () => {
    expect(buildNotification('morning', stats())).toEqual({
      title: 'WordLoop',
      body: '今日の復習 単語 5・文章 2。🔥3日連続',
    })
  })
  it('morning 復習0件', () => {
    expect(buildNotification('morning', stats({ dueWords: 0, dueSentences: 0 }))).toEqual({
      title: 'WordLoop',
      body: '今日は復習なし。暗記で🔥3日連続をつなごう',
    })
  })
  it('evening 未完了', () => {
    expect(buildNotification('evening', stats())).toEqual({
      title: 'WordLoop',
      body: 'まだ復習が残っています（単語 5・文章 2）。🔥3日を途切れさせないで',
    })
  })
  it('evening/custom 完了済みは null', () => {
    expect(buildNotification('evening', stats({ doneToday: true }))).toBeNull()
    expect(buildNotification('custom', stats({ doneToday: true }))).toBeNull()
  })
  it('custom 未完了は evening と同じ文面', () => {
    expect(buildNotification('custom', stats())?.body).toBe(
      'まだ復習が残っています（単語 5・文章 2）。🔥3日を途切れさせないで',
    )
  })
  it('waitingWords が10以上なら末尾に追記', () => {
    expect(buildNotification('morning', stats({ waitingWords: 10 }))?.body).toBe(
      '今日の復習 単語 5・文章 2。🔥3日連続\n文章にできる単語が10語たまりました',
    )
    expect(buildNotification('morning', stats({ waitingWords: 9 }))?.body).not.toContain('たまりました')
  })
})
