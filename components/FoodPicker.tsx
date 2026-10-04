/**
 * 往某一餐里加食物的选择器（服务端组件，整个流程不需要 JavaScript）。
 *
 * 它不是一个浮层，而是同一个页面在 URL 带 `?pick=<餐次id>` 时换一种渲染方式。
 * 这么做的原因：浮层要么需要 JS 开关，要么需要复杂的 CSS；而换 URL 得到的
 * 是「前进后退可用、刷新不掉、可以直接收藏」的普通页面，在手机上更可靠。
 *
 * 加完不跳转 —— 用户通常要连着加好几样，加进去的东西会实时出现在上面的「已加入」里。
 */

import Link from 'next/link'

import { addMealItem } from '@/actions/meals'
import { DEFAULT_AMOUNT_G } from '@/lib/constants'
import { foodPer100g, type MealView } from '@/lib/food'
import { formatAmount, formatEnergyBoth, formatMacro } from '@/lib/format'
import { listFoods } from '@/lib/queries'

/** 一次最多列这么多条。手机上一次渲染几千个表单会明显卡，其余的靠搜索找 */
const MAX_ROWS = 50

export async function FoodPicker({
  date,
  meal,
  keyword,
}: {
  date: string
  meal: MealView
  keyword: string
}) {
  const foods = await listFoods({ q: keyword, limit: MAX_ROWS })
  const selfHref = `/?date=${date}&pick=${meal.id}`
  const backHref = `/?date=${date}`
  const truncated = foods.length >= MAX_ROWS

  return (
    <div>
      <header className="mb-3 flex items-center gap-2">
        <Link href={backHref} aria-label="返回当天计划" className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-ink-soft">
          ‹
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold">加到「{meal.name}」</h1>
          <p className="text-xs text-ink-faint">
            {meal.items.length > 0 ? '下面是这一餐已有的' : '这一餐还是空的'}
          </p>
        </div>
      </header>

      {meal.items.length > 0 ? (
        <div className="mb-3 rounded-card border border-line bg-surface-2/60 p-3">
          <ul className="space-y-1 text-sm text-ink-soft">
            {meal.items.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">
                  {item.foodName}
                  <span className="ml-1.5 text-xs text-ink-faint">
                    {formatAmount(item.amountG)}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                  {formatEnergyBoth(item.nutrients.energyKj)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-line pt-2 text-right text-xs tabular-nums text-ink-soft">
            小计 {formatEnergyBoth(meal.totals.energyKj)}
          </p>
        </div>
      ) : null}

      {/* 搜索是普通 GET 表单：按回车就提交，结果直接体现在地址栏 ?q= 里 */}
      <form action="/" method="get" className="mb-3 flex gap-2">
        <input type="hidden" name="date" value={date} />
        <input type="hidden" name="pick" value={meal.id} />
        <input
          type="search"
          name="q"
          defaultValue={keyword}
          placeholder="搜食物名，比如「牛奶」"
          autoComplete="off"
          enterKeyHint="search"
          className="min-h-11 w-full min-w-0 rounded-card border border-line bg-surface px-3.5 text-base outline-none focus:border-brand"
        />
        <button
          type="submit"
          className="min-h-11 shrink-0 rounded-card border border-brand bg-surface px-4 text-sm font-medium text-brand"
        >
          搜索
        </button>
      </form>

      {foods.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-6 text-center">
          <p className="text-sm text-ink-soft">
            {keyword.trim() === '' ? '食物库还是空的。' : '没搜到。'}
          </p>
          <Link
            href={`/foods/new?next=${encodeURIComponent(selfHref)}`}
            className="mt-3 inline-flex min-h-11 items-center rounded-card bg-brand px-5 text-sm font-medium text-white"
          >
            新建一个食物
          </Link>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {foods.map((food) => {
              const per100g = foodPer100g(food)
              return (
                <li
                  key={food.id}
                  className="flex items-center gap-3 rounded-card border border-line bg-surface p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{food.name}</div>
                    <div className="mt-0.5 text-xs text-ink-soft">
                      {formatEnergyBoth(per100g.energyKj)}
                      <span className="text-ink-faint"> / 100g</span>
                    </div>
                    <div className="text-xs text-ink-faint">
                      蛋白 {formatMacro(per100g.proteinG)} · 碳水 {formatMacro(per100g.carbsG)} ·
                      脂肪 {formatMacro(per100g.fatG)}
                    </div>
                  </div>

                  {/*
                    克数先填好再点「加入」—— 大多数时候是 100g 上下，
                    但牛奶一杯 250g、米饭一碗 150g，先改再加快得多。
                  */}
                  <form
                    action={addMealItem.bind(null, date, meal.id, food.id)}
                    className="flex shrink-0 items-center gap-1"
                  >
                    <div className="relative">
                      <input
                        name="amountG"
                        defaultValue={String(DEFAULT_AMOUNT_G)}
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={`${food.name} 的克数`}
                        className="h-10 w-[68px] rounded-lg border border-line bg-surface-2 text-center text-base tabular-nums outline-none focus:border-brand"
                      />
                      <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-ink-faint">
                        g
                      </span>
                    </div>
                    <button
                      type="submit"
                      className="h-10 shrink-0 rounded-lg bg-brand px-3 text-sm font-medium text-white"
                    >
                      加入
                    </button>
                  </form>
                </li>
              )
            })}
          </ul>

          {truncated ? (
            <p className="mt-3 text-center text-xs text-ink-faint">
              只显示了前 {MAX_ROWS} 个，搜一下更快
            </p>
          ) : null}
        </>
      )}

      <div className="mt-4 text-center">
        <Link href={`/foods/new?next=${encodeURIComponent(selfHref)}`} className="text-sm text-brand underline">
          + 新建一个食物
        </Link>
      </div>
    </div>
  )
}
