import Link from 'next/link'

import { HISTORY_DAYS } from '@/lib/constants'
import { relativeDayLabel } from '@/lib/date'
import { formatKcal, formatKj, formatMacro } from '@/lib/format'
import { listDaySummaries } from '@/lib/queries'

/**
 * 历史记录：有记录的日期倒序，每行是当天的热量与三大营养素合计。
 *
 * 点进去直接复用首页那套视图（`/?date=...`），不重复实现 —— 所以这里只需要
 * 一个干净的列表，不需要任何展开/详情逻辑。
 *
 * ⚠️ 和其他页面一样必须动态渲染。
 */
export const dynamic = 'force-dynamic'

export default async function HistoryPage() {
  const summaries = await listDaySummaries()

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">历史记录</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          按日期回看过去的摄入，点任意一天查看当天的完整计划
        </p>
      </header>

      {summaries.length === 0 ? (
        <section className="rounded-card border border-dashed border-line bg-surface p-4">
          <p className="text-sm text-ink-soft">还没有任何记录。</p>
          <p className="mt-1 text-xs text-ink-faint">
            去
            <Link href="/" className="mx-1 font-medium text-brand">
              今天的计划
            </Link>
            里加一条，这里就会出现。
          </p>
          {/* 空身份最常见的成因就是换了手机或清了浏览器数据 —— 顺手把补救入口指出来 */}
          <p className="mt-2 text-xs text-ink-faint">
            如果你本来有数据却看到这个页面，可能在
            <Link href="/profile" className="mx-1 font-medium text-brand">
              我的
            </Link>
            里导入一次备份就能找回来。
          </p>
        </section>
      ) : (
        <>
          <ul className="space-y-2">
            {summaries.map((day) => (
              <li key={day.date}>
                <Link
                  href={`/?date=${day.date}`}
                  className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-4 active:bg-surface-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{relativeDayLabel(day.date)}</p>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {day.itemCount} 条 · 蛋白 {formatMacro(day.totals.proteinG)} · 碳水{' '}
                      {formatMacro(day.totals.carbsG)} · 脂肪 {formatMacro(day.totals.fatG)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-medium tabular-nums">{formatKj(day.totals.energyKj)}</p>
                    <p className="text-xs tabular-nums text-ink-faint">
                      {formatKcal(day.totals.energyKj)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-ink-faint">
            只列有记录的日期，最多回看最近 {HISTORY_DAYS} 天。更早的日期可以在首页用日期切换器翻。
          </p>
        </>
      )}
    </main>
  )
}
