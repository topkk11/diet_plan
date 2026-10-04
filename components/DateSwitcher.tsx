/**
 * 前一天 / 后一天 / 回到今天。
 *
 * 全部是普通 `<Link>`，没有一行 JavaScript —— 切日期就是换一个 URL，
 * 于是「切到某天」这件事可以直接收藏、可以前进后退、断网时还能从缓存里翻。
 */

import Link from 'next/link'

import { addDays, formatDateLabel, relativeDayLabel } from '@/lib/date'

const arrowClass =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-lg text-ink-soft'

export function DateSwitcher({ date, today }: { date: string; today: string }) {
  const isToday = date === today
  const label = relativeDayLabel(date, today)

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <Link href={`/?date=${addDays(date, -1)}`} aria-label="前一天" className={arrowClass}>
          ‹
        </Link>

        <div className="min-w-0 flex-1 text-center">
          <div className="truncate font-medium">{label}</div>
          {/* 「今天 / 昨天 / 明天」看不出具体日期，补一行小字；再早的日期本身就带日期，不用重复 */}
          {isToday || label === '昨天' || label === '明天' ? (
            <div className="text-xs text-ink-faint">{formatDateLabel(date, today)}</div>
          ) : null}
        </div>

        <Link href={`/?date=${addDays(date, 1)}`} aria-label="后一天" className={arrowClass}>
          ›
        </Link>
      </div>

      {isToday ? null : (
        <div className="mt-2 text-center">
          <Link href="/" className="text-xs text-brand underline">
            回到今天
          </Link>
        </div>
      )}
    </div>
  )
}
