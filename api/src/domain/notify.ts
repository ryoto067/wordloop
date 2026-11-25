export type NotifyStats = {
  dueWords: number
  dueSentences: number
  streak: number
  waitingWords: number
  doneToday: boolean
}

export type NotifyKind = 'morning' | 'evening' | 'custom'

const WAITING_WORDS_THRESHOLD = 10

export function buildNotification(
  kind: NotifyKind,
  s: NotifyStats,
): { title: string; body: string } | null {
  let body: string
  if (kind === 'morning') {
    body =
      s.dueWords + s.dueSentences === 0
        ? `今日は復習なし。暗記で🔥${s.streak}日連続をつなごう`
        : `今日の復習 単語 ${s.dueWords}・文章 ${s.dueSentences}。🔥${s.streak}日連続`
  } else {
    if (s.doneToday) return null
    body = `まだ復習が残っています（単語 ${s.dueWords}・文章 ${s.dueSentences}）。🔥${s.streak}日を途切れさせないで`
  }
  if (s.waitingWords >= WAITING_WORDS_THRESHOLD) {
    body += `\n文章にできる単語が${s.waitingWords}語たまりました`
  }
  return { title: 'WordLoop', body }
}
