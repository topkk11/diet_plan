import { DateSwitcher } from '@/components/DateSwitcher'
import { DayView } from '@/components/DayView'
import { FoodPicker } from '@/components/FoodPicker'
import { isValidIsoDate, todayIso } from '@/lib/date'
import { getEnergyTarget, getOrCreateDayPlan } from '@/lib/queries'

/**
 * 首页：某一天的饮食计划。日期走 ?date=YYYY-MM-DD，缺省是今天。
 *
 * ⚠️ 必须动态渲染。Supabase 官方明确指出：Next.js 的静态渲染会导致不同匿名用户的
 * session metadata 被串缓存（也就是可能读到别人的数据）。凡是依赖登录态的页面都要
 * 保留这一行。
 *
 * 同一个 URL 还有第二种形态：带上 `?pick=<餐次id>` 时换成「往这一餐加食物」的选择器。
 * 用 URL 而不是浮层，是为了让返回键、刷新、收藏都能正常工作 —— 见 FoodPicker 的注释。
 */
export const dynamic = 'force-dynamic'

type SearchParams = Promise<{
  date?: string | string[]
  pick?: string | string[]
  q?: string | string[]
  /** 写操作失败时由 Server Action 跳转带过来（见 actions/meals.ts） */
  error?: string | string[]
}>

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export default async function TodayPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const today = todayIso()

  // 手改 URL 传进来的日期一律当成不可信输入；不合法就回到今天而不是报错
  const rawDate = first(params.date)
  const date = isValidIsoDate(rawDate) ? rawDate : today

  const pickId = first(params.pick)
  const keyword = first(params.q)
  const errorMessage = first(params.error)

  // 这一步会顺带把当天的餐次补齐（幂等，见 lib/queries.ts 的说明）
  const [plan, budget] = await Promise.all([getOrCreateDayPlan(date), getEnergyTarget()])
  const pickedMeal = pickId === '' ? null : (plan.meals.find((m) => m.id === pickId) ?? null)

  return (
    <main>
      {errorMessage ? (
        <p
          role="alert"
          className="mb-3 rounded-card border border-over/30 bg-over/10 px-3 py-2 text-sm text-over"
        >
          {errorMessage}
        </p>
      ) : null}

      {pickedMeal ? (
        <FoodPicker date={date} meal={pickedMeal} keyword={keyword} />
      ) : (
        <>
          <h1 className="mb-3 text-xl font-semibold tracking-tight">饮食计划</h1>
          <DateSwitcher date={date} today={today} />
          <DayView date={date} plan={plan} budget={budget} isToday={date === today} />
        </>
      )}
    </main>
  )
}
