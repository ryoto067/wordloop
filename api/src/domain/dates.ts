// 日付は 'YYYY-MM-DD' 文字列で扱う。

function parts(at: Date, tz: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]))
}

export function localDate(at: Date, tz: string): string {
  const p = parts(at, tz)
  return `${p.year}-${p.month}-${p.day}`
}

export function localHHMM(at: Date, tz: string): string {
  const p = parts(at, tz)
  return `${p.hour}:${p.minute}`
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
