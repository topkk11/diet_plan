'use client'

/**
 * 某一天的完整计划（餐次卡片 + 条目 + 克数调整 + 合计）。
 *
 * ## 为什么这是客户端组件
 *
 * 因为「改克数要即时反馈」。数字打进去的一瞬间，这一条的热量、这一餐的小计、
 * 全天的合计都要跟着动 —— 如果每一步都等服务端返回，手机上每次都是几百毫秒的迟滞。
 *
 * 所以：服务端把每 100g 的营养值一起送下来（MealItemView.per100g），
 * 界面用 lib/nutrition.ts 里的纯函数本地重算。**算数字的代码全站只有一份**，
 * 客户端和服务端跑的是同一个函数，不会出现「卡片和条目对不上」。
 *
 * ## 克数是怎么保存的
 *
 * 边打边存：改动后等 600ms 没再动就发一次请求（见 actions/meals.ts 的 saveItemAmount）。
 * 那个 action **不调用 revalidatePath** —— 一 revalidate 就会把整页重渲染，
 * 用户正在打的字会被重置。代价是服务端数据要等下次进页面才对齐，所以保存失败
 * 必须如实显示出来，不能让用户以为存上了。
 *
 * ## overrides 这个「覆盖层」是干什么的
 *
 * 本地改过的克数存在 overrides 里，没改过的回落到服务端给的 item.amountG。
 * 这样加/删条目之后（服务端数据变了、组件被重新渲染）新条目能自然拿到正确的初始值，
 * 不需要在 useEffect 里做同步 —— 那种同步很容易写出「用户正在打字时被覆盖」的 bug。
 */

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { SummaryCard, type BudgetInput } from '@/components/SummaryCard'
import {
  addMeal,
  moveMeal,
  removeMeal,
  removeMealItem,
  renameMeal,
  saveItemAmount,
  saveItemAmountForm,
} from '@/actions/meals'
import { AMOUNT_SAVE_DEBOUNCE_MS, AMOUNT_STEPS, LIMITS } from '@/lib/constants'
import type { DayPlan, MealItemView } from '@/lib/food'
import { formatEnergyBoth, formatMacro } from '@/lib/format'
import { parseAmountG, stepAmountG } from '@/lib/meal-input'
import { per100gToAmount, sumNutrients, type Nutrients } from '@/lib/nutrition'

type SaveStatus = 'saving' | 'saved' | 'error'

export function DayView({
  date,
  plan,
  budget,
  isToday,
}: {
  date: string
  plan: DayPlan
  /** TDEE 与缺口，来自资料页。没设过是 null，汇总卡会提示去填。 */
  budget: BudgetInput
  /**
   * 看的是不是今天。服务端算好传进来的 —— 这个组件是客户端组件，
   * 在这里现读时钟会和首屏 HTML 对不上（见 SummaryCard 的同名参数）。
   */
  isToday: boolean
}) {
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [status, setStatus] = useState<Record<string, SaveStatus>>({})

  /** 每个条目一个定时器；重复改动只保留最后一次 */
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  /** 还没发出去的克数（定时器到点时读它） */
  const queued = useRef(new Map<string, number>())

  const amountOf = (item: MealItemView): number => overrides[item.id] ?? item.amountG
  const nutrientsOf = (item: MealItemView): Nutrients =>
    per100gToAmount(item.per100g, amountOf(item))

  /** 真正把请求发出去 */
  const commit = useCallback(async (itemId: string) => {
    const grams = queued.current.get(itemId)
    if (grams === undefined) return
    queued.current.delete(itemId)

    setStatus((s) => ({ ...s, [itemId]: 'saving' }))
    try {
      const result = await saveItemAmount(itemId, grams)
      setStatus((s) => ({ ...s, [itemId]: result.ok ? 'saved' : 'error' }))
    } catch {
      // 网络断掉时 server action 会直接抛错，这里必须接住
      setStatus((s) => ({ ...s, [itemId]: 'error' }))
    }
  }, [])

  const schedule = useCallback(
    (itemId: string, grams: number) => {
      queued.current.set(itemId, grams)
      const map = timers.current
      const existing = map.get(itemId)
      if (existing !== undefined) clearTimeout(existing)
      map.set(
        itemId,
        setTimeout(() => {
          map.delete(itemId)
          void commit(itemId)
        }, AMOUNT_SAVE_DEBOUNCE_MS),
      )
    },
    [commit],
  )

  /** 改克数：先更新界面，再排队保存 */
  const changeAmount = useCallback(
    (itemId: string, grams: number) => {
      setOverrides((o) => ({ ...o, [itemId]: grams }))
      schedule(itemId, grams)
    },
    [schedule],
  )

  /** 立刻保存（点步进按钮、或者输入框失焦时用）——那些是明确的操作，不该再等 600ms */
  const flushNow = useCallback(
    (itemId: string) => {
      const map = timers.current
      const timer = map.get(itemId)
      if (timer === undefined) return
      clearTimeout(timer)
      map.delete(itemId)
      void commit(itemId)
    },
    [commit],
  )

  // 离开这个页面时把还没到点的改动补发出去。这里不再 setState，所以不用 await。
  useEffect(() => {
    const map = timers.current
    const queue = queued.current
    return () => {
      for (const timer of map.values()) clearTimeout(timer)
      map.clear()
      for (const [itemId, grams] of queue) void saveItemAmount(itemId, grams)
      queue.clear()
    }
  }, [])

  const dayTotals = sumNutrients(
    plan.meals.flatMap((meal) => meal.items.map((item) => nutrientsOf(item))),
  )

  return (
    <div className="space-y-3">
      {/*
        汇总卡也在这个客户端组件里：它要跟着克数的改动实时变（「还能吃」是这一页的主角），
        所以 consumedKj 用的是上面本地算出来的 dayTotals，而不是服务端渲染时的快照。
      */}
      <SummaryCard input={budget} consumedKj={dayTotals.energyKj} isToday={isToday} />

      {plan.meals.map((meal, index) => {
        const mealTotals = sumNutrients(meal.items.map((item) => nutrientsOf(item)))
        const hasItems = meal.items.length > 0

        // 卡片上**不能**加 overflow-hidden（那样圆角最省事）：管理面板是绝对定位的，
        // 而它的定位祖先在这个卡片内部，overflow-hidden 会把面板裁掉一半。
        // 所以改成把圆角分别给头部和底部。
        return (
          <section key={meal.id} className="rounded-card border border-line bg-surface">
            <header className="flex items-center gap-1 rounded-t-card border-b border-line py-1.5 pr-1.5 pl-3.5">
              <h2 className="min-w-0 flex-1 truncate font-medium">{meal.name}</h2>

              {/*
                餐次管理藏在「⋯」后面：改名 / 上移 / 下移 / 删除都不常用，
                但都需要两步操作才能造成破坏，正好当作一层误触保护。
              */}
              <details key={`${meal.id}-${meal.name}`} className="relative shrink-0">
                <summary
                  aria-label={`管理「${meal.name}」`}
                  className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg text-ink-faint [&::-webkit-details-marker]:hidden"
                >
                  ⋯
                </summary>

                <div className="absolute top-full right-0 z-20 mt-1 w-60 rounded-card border border-line bg-surface p-3 shadow-lg">
                  <form action={renameMeal.bind(null, date, meal.id)} className="flex gap-2">
                    <input
                      name="name"
                      defaultValue={meal.name}
                      maxLength={LIMITS.mealNameLength}
                      aria-label="餐次名"
                      className="min-h-10 w-full min-w-0 rounded-lg border border-line bg-surface-2 px-3 text-base outline-none focus:border-brand"
                    />
                    <button
                      type="submit"
                      className="min-h-10 shrink-0 rounded-lg bg-brand px-3 text-sm font-medium text-white"
                    >
                      改名
                    </button>
                  </form>

                  <div className="mt-2 flex gap-2">
                    <form action={moveMeal.bind(null, date, meal.id, 'up')} className="flex-1">
                      <button
                        type="submit"
                        disabled={index === 0}
                        className="min-h-10 w-full rounded-lg border border-line text-sm text-ink-soft disabled:opacity-40"
                      >
                        ↑ 上移
                      </button>
                    </form>
                    <form action={moveMeal.bind(null, date, meal.id, 'down')} className="flex-1">
                      <button
                        type="submit"
                        disabled={index === plan.meals.length - 1}
                        className="min-h-10 w-full rounded-lg border border-line text-sm text-ink-soft disabled:opacity-40"
                      >
                        ↓ 下移
                      </button>
                    </form>
                  </div>

                  <form action={removeMeal.bind(null, date, meal.id)} className="mt-2">
                    <button
                      type="submit"
                      className="min-h-10 w-full rounded-lg bg-over px-3 text-sm font-medium text-white"
                    >
                      删除这一餐
                      {hasItems ? `（含 ${meal.items.length} 条记录）` : ''}
                    </button>
                  </form>
                </div>
              </details>
            </header>

            {hasItems ? (
              <ul>
                {meal.items.map((item) => {
                  const nutrients = nutrientsOf(item)
                  const itemStatus = status[item.id]

                  return (
                    <li
                      key={item.id}
                      className="border-b border-line px-3.5 py-2.5 last:border-b-0 last:pb-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-sm">{item.foodName}</span>
                          {item.foodArchived ? (
                            <span className="ml-1.5 text-[11px] text-ink-faint">已归档</span>
                          ) : null}
                        </div>
                        <span className="shrink-0 text-sm tabular-nums text-ink-soft">
                          {formatEnergyBoth(nutrients.energyKj)}
                        </span>
                      </div>

                      <div className="mt-1.5 flex items-end gap-2">
                        <AmountControl
                          date={date}
                          itemId={item.id}
                          foodName={item.foodName}
                          grams={amountOf(item)}
                          status={itemStatus}
                          onChange={(grams) => changeAmount(item.id, grams)}
                          onCommit={() => flushNow(item.id)}
                        />

                        <form
                          action={removeMealItem.bind(null, date, item.id)}
                          className="ml-auto shrink-0"
                        >
                          <button
                            type="submit"
                            aria-label={`删掉 ${item.foodName}`}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint"
                          >
                            ✕
                          </button>
                        </form>
                      </div>

                      {itemStatus === 'saving' ? (
                        <p className="mt-1 text-right text-[11px] text-ink-faint">保存中…</p>
                      ) : null}
                      {itemStatus === 'error' ? (
                        <p className="mt-1 text-right text-[11px] text-over">
                          没保存上，改一下克数再试
                        </p>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="px-3.5 py-3 text-sm text-ink-faint">这一餐还没记东西</p>
            )}

            <div className="flex items-center justify-between gap-2 rounded-b-card border-t border-line bg-surface-2/60 px-3.5 py-2">
              <Link
                href={`/?date=${date}&pick=${meal.id}`}
                className="text-sm font-medium text-brand"
              >
                + 添加食物
              </Link>
              <span className="text-xs tabular-nums text-ink-soft">
                小计 {formatEnergyBoth(mealTotals.energyKj)}
              </span>
            </div>
          </section>
        )
      })}

      <details className="rounded-card border border-dashed border-line bg-surface">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-1 text-sm font-medium text-brand [&::-webkit-details-marker]:hidden">
          + 加一个餐次
        </summary>
        <form action={addMeal.bind(null, date)} className="flex gap-2 px-3 pb-3">
          <input
            name="name"
            placeholder="比如：夜宵"
            maxLength={LIMITS.mealNameLength}
            aria-label="新餐次的名字"
            className="min-h-11 w-full min-w-0 rounded-card border border-line bg-surface-2 px-3.5 text-base outline-none focus:border-brand"
          />
          <button
            type="submit"
            className="min-h-11 shrink-0 rounded-card bg-brand px-4 text-sm font-medium text-white"
          >
            添加
          </button>
        </form>
      </details>

      <section className="rounded-card border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">全天合计</span>
          <span className="text-lg font-semibold tabular-nums">
            {formatEnergyBoth(dayTotals.energyKj)}
          </span>
        </div>
        <div className="mt-1 text-xs text-ink-faint">
          蛋白 {formatMacro(dayTotals.proteinG)} · 碳水 {formatMacro(dayTotals.carbsG)} · 脂肪{' '}
          {formatMacro(dayTotals.fatG)}
        </div>
      </section>
    </div>
  )
}

/**
 * 克数调整：左右各两个步进按钮，中间是可以直接打的数字框。
 *
 * 用本地 draft 而不是直接把父组件的值塞进 value：用户把内容全删掉（空字符串）时
 * 解析会失败，如果 value 直接绑父组件的值，光标里的内容会被弹回去，没法重新输入。
 * 非法输入就只影响显示，不影响合计（合计仍按上一个合法值算），失焦时还原。
 *
 * 外面套的 `<form>` 是给**没有 JavaScript** 的情况兜底的（改完按回车就提交）。
 * 有 JavaScript 时输入框的回车被拦下改成失焦，走的是去重的自动保存 ——
 * 两条路都通到 actions/meals.ts 里同一段更新逻辑。
 */
function AmountControl({
  date,
  itemId,
  foodName,
  grams,
  status,
  onChange,
  onCommit,
}: {
  date: string
  itemId: string
  foodName: string
  grams: number
  status?: SaveStatus
  onChange: (grams: number) => void
  onCommit: () => void
}) {
  const [draft, setDraft] = useState(() => String(grams))

  // 外部值变了（点了步进、或者服务端刷新后）要跟上
  useEffect(() => {
    setDraft(String(grams))
  }, [grams])

  function step(delta: number) {
    const parsed = parseAmountG(draft)
    const base = parsed.ok ? parsed.grams : grams
    const next = stepAmountG(base, delta)
    setDraft(String(next))
    onChange(next)
    onCommit()
  }

  return (
    <form
      action={saveItemAmountForm.bind(null, date, itemId)}
      className="flex items-center gap-1"
    >
      {[...AMOUNT_STEPS].reverse().map((size) => (
        <StepButton
          key={`minus-${size}`}
          label={`−${size}`}
          aria={`${foodName} 减少 ${size} 克`}
          onClick={() => step(-size)}
        />
      ))}

      <div className="relative">
        <input
          name="amountG"
          value={draft}
          onChange={(event) => {
            const raw = event.target.value
            setDraft(raw)
            // 只有解析得出合法数字时才同步给父组件 —— 打到一半的「2」不该让合计乱跳
            const parsed = parseAmountG(raw)
            if (parsed.ok) onChange(parsed.grams)
          }}
          onKeyDown={(event) => {
            // 回车不提交表单，改成失焦 —— 失焦会立刻走自动保存那条路
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
          onBlur={() => {
            const parsed = parseAmountG(draft)
            if (!parsed.ok) {
              setDraft(String(grams)) // 还原成上一个合法值
              return
            }
            setDraft(String(parsed.grams))
            onCommit()
          }}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          aria-label={`${foodName} 的克数`}
          className={`h-9 w-20 rounded-lg border bg-surface-2 text-center text-base tabular-nums outline-none focus:border-brand ${
            status === 'error' ? 'border-over' : 'border-line'
          }`}
        />
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-ink-faint">
          g
        </span>
      </div>

      {AMOUNT_STEPS.map((size) => (
        <StepButton
          key={`plus-${size}`}
          label={`+${size}`}
          aria={`${foodName} 增加 ${size} 克`}
          onClick={() => step(size)}
        />
      ))}
    </form>
  )
}

function StepButton({
  label,
  aria,
  onClick,
}: {
  label: string
  aria: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={aria}
      className="h-9 min-w-9 shrink-0 rounded-lg border border-line text-xs tabular-nums text-ink-soft"
    >
      {label}
    </button>
  )
}
