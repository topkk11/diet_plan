import Link from 'next/link'

import { FoodRowActions } from '@/components/FoodRowActions'
import { formatEnergyBoth, formatMacro } from '@/lib/format'
import { foodPer100g } from '@/lib/food'
import { listFoods } from '@/lib/queries'

/** 依赖登录态，必须动态渲染（见 app/page.tsx 里的详细说明） */
export const dynamic = 'force-dynamic'

type SearchParams = Promise<{
  q?: string | string[]
  archived?: string | string[]
  /** 删除/归档失败时由 Server Action 跳转带过来（见 actions/foods.ts） */
  error?: string | string[]
}>

/** searchParams 的值可能是 string 也可能是 string[]，统一取第一个 */
function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export default async function FoodsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const keyword = first(params.q)
  const showArchived = first(params.archived) === '1'
  const errorMessage = first(params.error)

  const foods = await listFoods({ q: keyword, archived: showArchived })
  const isSearching = keyword.trim() !== ''

  return (
    <main>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">食物库</h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            {showArchived ? '已归档（历史还在用）' : '热量按 kJ/100g 记，kcal 是算出来的'}
          </p>
        </div>
        <Link
          href="/foods/new"
          className="flex min-h-10 shrink-0 items-center rounded-card bg-brand px-3.5 text-sm font-medium text-white"
        >
          + 添加
        </Link>
      </header>

      {errorMessage ? (
        <p
          role="alert"
          className="mb-3 rounded-card border border-over/30 bg-over/10 px-3 py-2 text-sm text-over"
        >
          {errorMessage}
        </p>
      ) : null}

      {/*
        搜索用最朴素的 GET 表单：不需要一行 JavaScript，手机上按回车就提交，
        而且结果页可以直接收藏/刷新。搜完关键词还留在地址栏 ?q= 里。
      */}
      <form action="/foods" method="get" className="mb-3">
        {showArchived ? <input type="hidden" name="archived" value="1" /> : null}
        <div className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={keyword}
            placeholder="搜食物名，比如「牛奶」"
            autoComplete="off"
            enterKeyHint="search"
            className="min-h-11 w-full rounded-card border border-line bg-surface px-3.5 text-base outline-none focus:border-brand"
          />
          <button
            type="submit"
            className="min-h-11 shrink-0 rounded-card border border-brand bg-surface px-4 text-sm font-medium text-brand"
          >
            搜索
          </button>
        </div>
      </form>

      <div className="mb-3 flex items-center justify-between gap-2 text-xs">
        <span className="text-ink-faint">
          {isSearching ? `「${keyword.trim()}」找到 ${foods.length} 条` : `共 ${foods.length} 条`}
        </span>
        <div className="flex gap-3">
          {isSearching ? <Link href={showArchived ? '/foods?archived=1' : '/foods'} className="text-ink-soft underline">清空搜索</Link> : null}
          <Link
            href={showArchived ? '/foods' : '/foods?archived=1'}
            className="text-brand underline"
          >
            {showArchived ? '返回在用' : '看已归档'}
          </Link>
        </div>
      </div>

      {foods.length === 0 ? (
        <EmptyState isSearching={isSearching} showArchived={showArchived} />
      ) : (
        <ul className="space-y-2">
          {foods.map((food) => {
            const per100g = foodPer100g(food)
            return (
              <li
                key={food.id}
                className="flex items-start gap-3 rounded-card border border-line bg-surface p-3.5"
              >
                <Link href={`/foods/${food.id}/edit`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{food.name}</span>
                    {food.archived_at ? (
                      <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-faint">
                        已归档
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-sm text-ink-soft">
                    {formatEnergyBoth(per100g.energyKj)}
                    <span className="text-ink-faint"> / 100g</span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-faint">
                    蛋白 {formatMacro(per100g.proteinG)} · 碳水 {formatMacro(per100g.carbsG)} · 脂肪{' '}
                    {formatMacro(per100g.fatG)}
                  </div>
                </Link>

                <FoodRowActions
                  foodId={food.id}
                  refCount={food.refCount}
                  archived={food.archived_at !== null}
                />
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}

function EmptyState({
  isSearching,
  showArchived,
}: {
  isSearching: boolean
  showArchived: boolean
}) {
  if (isSearching) {
    return (
      <p className="rounded-card border border-line bg-surface p-6 text-center text-sm text-ink-soft">
        没搜到。换个说法试试，或者
        <Link href="/foods/new" className="text-brand underline">
          新增一条
        </Link>
        。
      </p>
    )
  }

  if (showArchived) {
    return (
      <p className="rounded-card border border-line bg-surface p-6 text-center text-sm text-ink-soft">
        还没有归档的食物。
      </p>
    )
  }

  return (
    <div className="rounded-card border border-line bg-surface p-6 text-center">
      <p className="text-sm text-ink-soft">食物库还是空的。</p>
      <p className="mt-1 text-xs text-ink-faint">
        从你今天吃的东西开始录，比如牛奶、鸡蛋、米饭。以后加餐时直接选就行。
      </p>
      <Link
        href="/foods/new"
        className="mt-4 inline-flex min-h-11 items-center rounded-card bg-brand px-5 text-sm font-medium text-white"
      >
        添加第一个食物
      </Link>
    </div>
  )
}
