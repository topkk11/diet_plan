/**
 * 首页顶部的汇总卡：「今天还能吃多少」。
 *
 * 这是整个应用最该一眼看懂的数字，所以顺序是：
 *   还能吃（大字，超标时换成「已超出」并转红）→ 进度条 → 目标/已摄入 → TDEE 和缺口怎么来的。
 * 细节放在下面而不是藏起来 —— 数字算得对不对，用户要能自己核对。
 *
 * 措辞跟着日期走：今天是「还能吃」，翻到别的日期是「当天剩余」。
 * 三天前那一页如果也写「还能吃 320 kJ」，会让人以为现在还能去吃 ——
 * 一个词的差别，但读起来准确得多。
 *
 * 单位：进出的都是 kJ（库里的唯一真相），kcal 只是显示时派生出来的。
 * 算式全部来自 lib/nutrition.ts 的 computeEnergyBudget，这里只负责排版。
 */

import Link from 'next/link'

import { formatEnergyBoth, formatKcal, formatKj } from '@/lib/format'
import { computeEnergyBudget } from '@/lib/nutrition'

/** 来自 user_profile 的两个值；没设过 TDEE 时是 null */
export type BudgetInput = { tdeeKj: number; deficitKj: number } | null

export function SummaryCard({
  input,
  consumedKj,
  isToday = true,
}: {
  input: BudgetInput
  consumedKj: number
  /**
   * 看的是不是今天。**由服务端算好传进来**（app/page.tsx 用 todayIso() 比），
   * 不要在客户端现算 —— 服务端和手机的时钟可能差一点，会渲染出两种结果。
   */
  isToday?: boolean
}) {
  if (input === null) {
    return (
      <section className="rounded-card border border-dashed border-line bg-surface p-4">
        <p className="text-sm text-ink-soft">还没设 TDEE，算不出今天还能吃多少。</p>
        <Link href="/profile" className="mt-1 inline-block text-sm font-medium text-brand">
          去填身高体重（或直接手填 TDEE）→
        </Link>
      </section>
    )
  }

  const budget = computeEnergyBudget(input.tdeeKj, input.deficitKj, consumedKj)
  const { targetIntakeKj, consumedKj: eaten, remainingKj, isOver } = budget

  // 今天用「还能吃」——它是这一页每天都要看的数字，直白一点好；
  // 翻到过去的日期改成「当天剩余」，因为它描述的是那一天，不是一个还能改变的额度。
  const remainingLabel = isOver ? '已超出' : isToday ? '还能吃' : '当天剩余'

  // 目标 ≤ 0 说明缺口设得比总消耗还大（资料页会警告）。这时候按满了算，
  // 不让进度条出现负数宽度那种诡异渲染。
  const percent = targetIntakeKj > 0 ? (eaten / targetIntakeKj) * 100 : 100
  // 留一位小数即可 —— 不处理的话 style 里会出现 width:1.0317470317470317% 这种长尾
  const barWidth = Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink-soft">{remainingLabel}</span>
        <span className="text-xs tabular-nums text-ink-faint">
          已摄入 {Math.round(percent)}%
        </span>
      </div>

      <p
        className={`mt-0.5 text-3xl font-semibold tabular-nums ${
          isOver ? 'text-over' : 'text-ink'
        }`}
      >
        {formatKj(Math.abs(remainingKj))}
      </p>
      <p className={`text-sm tabular-nums ${isOver ? 'text-over' : 'text-ink-faint'}`}>
        ≈ {formatKcal(Math.abs(remainingKj))}
      </p>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(barWidth)}
        aria-label="已摄入占目标摄入的比例"
        className="mt-3 h-2 overflow-hidden rounded-full bg-line"
      >
        <div
          className={`h-full rounded-full ${isOver ? 'bg-over' : 'bg-brand'}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <dl className="mt-3 space-y-0.5 text-xs text-ink-soft">
        <div className="flex justify-between gap-2">
          <dt>目标摄入</dt>
          <dd className="tabular-nums">{formatEnergyBoth(targetIntakeKj)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{isToday ? '今天已吃' : '当天已吃'}</dt>
          <dd className="tabular-nums">{formatEnergyBoth(eaten)}</dd>
        </div>
        <div className="flex justify-between gap-2 text-ink-faint">
          <dt>TDEE − 缺口</dt>
          <dd className="tabular-nums">
            {formatKj(budget.tdeeKj)}
            {budget.deficitKj > 0 ? ` − ${formatKj(budget.deficitKj)}` : ''}
          </dd>
        </div>
      </dl>
    </section>
  )
}
