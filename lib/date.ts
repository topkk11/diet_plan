/**
 * 日期处理。
 *
 * 为什么不用 `new Date().toISOString().slice(0, 10)`：那是 **UTC** 日期。
 * 北京时间晚上 8 点之后，UTC 还是前一天，用户会发现「今天」记到了昨天上。
 * 所以这里所有「今天是几号」的判断都强制走固定时区。
 */

/** 固定时区。中国没有夏令时，所以这个常量是安全的 */
export const TIMEZONE = 'Asia/Shanghai'

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * 取指定时刻在该时区的日期，格式 YYYY-MM-DD。
 * 用 formatToParts 逐个取值，不依赖 locale 的日期排列顺序。
 */
export function todayIso(now: Date = new Date()): string {
  const parts = partsFormatter.formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** 严格校验 YYYY-MM-DD（包括 2 月 30 日这种不存在的日期） */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.toISOString().slice(0, 10) === value
}

/**
 * 日期加减天数。用 UTC 正午做基准，避免时区偏移把日期挪走一天
 * （中国时区是 +08:00，正午 UTC 对应本地 20:00，前后都离边界很远）。
 */
export function addDays(iso: string, days: number): string {
  const base = new Date(`${iso}T12:00:00Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/** 2026-10-05 → "周一" */
export function weekdayLabel(iso: string): string {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay()
  return WEEKDAYS[day]
}

/** 2026-10-05 → "10月5日 周一"（跨年时带上年份） */
export function formatDateLabel(iso: string, today: string = todayIso()): string {
  const [, month, day] = iso.split('-')
  const sameYear = iso.slice(0, 4) === today.slice(0, 4)
  const date = `${Number(month)}月${Number(day)}日`
  return sameYear ? `${date} ${weekdayLabel(iso)}` : `${iso.slice(0, 4)}年${date}`
}

/** 相对今天的说法："今天" / "昨天" / "明天" / 否则返回具体的 "10月5日 周一" */
export function relativeDayLabel(iso: string, today: string = todayIso()): string {
  if (iso === today) return '今天'
  if (iso === addDays(today, -1)) return '昨天'
  if (iso === addDays(today, 1)) return '明天'
  return formatDateLabel(iso, today)
}

/** 该日期是否在今天之后（未来日期不许记体重之类，但计划可以预填） */
export function isFuture(iso: string, today: string = todayIso()): boolean {
  return iso > today
}
