'use server'

/**
 * 餐次与饮食条目的写操作（Server Actions）。
 *
 * 命名约定：`xxx(date, ...)` 的第一个参数都是日期，因为它只用于**出错时跳回正确的那一天**。
 * 这些 action 通过 `<form action={fn.bind(null, date, ...)}>` 直接绑定，
 * 好处是**没有 JavaScript 也能提交**；代价是返回值没人接，所以失败只能靠跳转带消息回来。
 *
 * 唯一的例外是 saveItemAmount —— 它被客户端**直接调用**（不是表单），
 * 因为改克数要边打边存，返回值需要用来显示「存上了没有」。
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { DEFAULT_AMOUNT_G } from '@/lib/constants'
import { isValidIsoDate } from '@/lib/date'
import { isUuid } from '@/lib/food-input'
import { parseAmountG, validateMealName } from '@/lib/meal-input'
import { round } from '@/lib/nutrition'
import { createClient, requireUserId } from '@/lib/supabase/server'
import type { MealRow } from '@/lib/types'

/**
 * 所有写操作后都清一次整个客户端路由缓存。
 * 见 actions/foods.ts 里的说明：官方文档把 revalidatePath('/', 'layout') 记为
 * 「revalidating all data」，比逐个列路径更不容易漏。
 */
const revalidateAll = () => revalidatePath('/', 'layout')

/** 非法日期说明链接被改过，退回今天而不是把错误日期写进数据库 */
function normalizeDate(date: string): string {
  if (!isValidIsoDate(date)) redirect('/?error=' + encodeURIComponent('日期不合法，已回到今天'))
  return date
}

function backToDay(date: string, message: string): never {
  redirect(`/?date=${date}&error=${encodeURIComponent(message)}`)
}

function backToPicker(date: string, mealId: string, message: string): never {
  redirect(`/?date=${date}&pick=${mealId}&error=${encodeURIComponent(message)}`)
}

// ---------------------------------------------------------------------------
// 克数
// ---------------------------------------------------------------------------

export type SaveAmountResult = { ok: true } | { ok: false; message: string }

/**
 * 改克数的共同实现：两个入口（浏览器里自动存 / 纯表单提交）共用这一段。
 * 收 string | number 是因为表单给的是字符串、客户端给的是数字，两者都可能是全角。
 */
async function updateAmount(itemId: string, grams: string | number): Promise<SaveAmountResult> {
  const userId = await requireUserId()
  if (!isUuid(itemId)) return { ok: false, message: '这条记录不存在' }

  const parsed = parseAmountG(String(grams))
  if (!parsed.ok) return { ok: false, message: parsed.message }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('meal_items')
    .update({ amount_g: round(parsed.grams, 2) })
    .eq('id', itemId)
    .eq('user_id', userId)
    .select('id')

  if (error) return { ok: false, message: `没保存上：${error.message}` }
  // 没报错但一行都没改到，说明记录被删了或不属于当前用户
  if (!data || data.length === 0) return { ok: false, message: '这条记录已经不在了' }

  return { ok: true }
}

/**
 * 改克数（浏览器里自动保存那条路，被客户端直接调用）。
 *
 * **故意不调用 revalidatePath。** 改克数是最高频的操作，而且界面上小计/合计是
 * 客户端用 per100g 本地重算的（见 lib/food.ts 的说明），不依赖服务端返回。
 * 一旦在这里 revalidate，每打一个数字整页就重渲染一次，输入框会在打字过程中被重置 ——
 * 那正是这个应用最不能忍的体验。
 *
 * 代价是：服务端数据要等下次进页面才对齐。所以这里必须把失败如实返回给界面，
 * 不能让用户以为存上了。
 */
export async function saveItemAmount(itemId: string, grams: number): Promise<SaveAmountResult> {
  return updateAmount(itemId, grams)
}

/**
 * 改克数（纯表单提交那条路：没有 JavaScript 时，改完按回车走这里）。
 *
 * 这条路**必须** revalidate —— 服务端渲染的页面如果不重渲染，用户会看到自己刚改的
 * 数字弹回旧值，那比「慢一点」糟糕得多。有 JavaScript 时不会走到这里
 * （输入框的回车被客户端拦下，改成去重的自动保存）。
 */
export async function saveItemAmountForm(
  date: string,
  itemId: string,
  formData: FormData,
): Promise<void> {
  const day = normalizeDate(date)

  const result = await updateAmount(itemId, String(formData.get('amountG') ?? ''))
  if (!result.ok) backToDay(day, result.message)

  revalidateAll()
}

/** 往某一餐里加一个食物 */
export async function addMealItem(
  date: string,
  mealId: string,
  foodId: string,
  formData: FormData,
): Promise<void> {
  const userId = await requireUserId()
  const day = normalizeDate(date)
  if (!isUuid(mealId) || !isUuid(foodId)) backToDay(day, '这条链接不对，请重新选一个食物')

  const raw = String(formData.get('amountG') ?? '').trim()
  const parsed = raw === '' ? { ok: true as const, grams: DEFAULT_AMOUNT_G } : parseAmountG(raw)
  if (!parsed.ok) backToPicker(day, mealId, parsed.message)

  const supabase = await createClient()
  const { error } = await supabase.from('meal_items').insert({
    // user_id 其实会被数据库触发器按「这一餐属于谁」覆盖掉，这里显式带上只是双保险
    user_id: userId,
    meal_id: mealId,
    food_id: foodId,
    amount_g: round(parsed.grams, 2),
  })

  // 触发器在餐次不属于当前用户时会拒绝，那不是崩溃而是明确的越权尝试
  if (error) backToPicker(day, mealId, `没能加进去：${error.message}`)

  revalidateAll()
  // 不跳转：留在选择器里，用户通常要连着加好几样
}

/** 删掉一条记录 */
export async function removeMealItem(
  date: string,
  itemId: string,
  _formData: FormData,
): Promise<void> {
  const userId = await requireUserId()
  const day = normalizeDate(date)
  if (!isUuid(itemId)) backToDay(day, '这条记录不存在')

  const supabase = await createClient()
  const { error } = await supabase
    .from('meal_items')
    .delete()
    .eq('id', itemId)
    .eq('user_id', userId)

  if (error) backToDay(day, `删除失败：${error.message}`)

  revalidateAll()
}

// ---------------------------------------------------------------------------
// 餐次本身
// ---------------------------------------------------------------------------

/** 在某一天末尾加一个餐次（用户自己决定一天吃几餐） */
export async function addMeal(date: string, formData: FormData): Promise<void> {
  const userId = await requireUserId()
  const day = normalizeDate(date)

  const named = validateMealName(String(formData.get('name') ?? ''))
  if (!named.ok) backToDay(day, named.message)

  const supabase = await createClient()

  // 排在现有餐次之后。order by desc + limit 1 = 取最大序号
  const { data: last, error: readError } = await supabase
    .from('meals')
    .select('sort_order')
    .eq('date', day)
    .order('sort_order', { ascending: false })
    .limit(1)
  if (readError) backToDay(day, `添加餐次失败：${readError.message}`)

  const nextOrder = (last?.[0]?.sort_order ?? -1) + 1

  const { error } = await supabase
    .from('meals')
    .insert({ user_id: userId, date: day, name: named.name, sort_order: nextOrder })

  if (error) backToDay(day, `添加餐次失败：${error.message}`)

  revalidateAll()
}

/** 重命名餐次 */
export async function renameMeal(
  date: string,
  mealId: string,
  formData: FormData,
): Promise<void> {
  const userId = await requireUserId()
  const day = normalizeDate(date)
  if (!isUuid(mealId)) backToDay(day, '这个餐次不存在')

  const named = validateMealName(String(formData.get('name') ?? ''))
  if (!named.ok) backToDay(day, named.message)

  const supabase = await createClient()
  const { error } = await supabase
    .from('meals')
    .update({ name: named.name })
    .eq('id', mealId)
    .eq('user_id', userId)

  if (error) backToDay(day, `改名失败：${error.message}`)

  revalidateAll()
}

/** 删掉一个餐次（里面的记录由外键 on delete cascade 一起清掉） */
export async function removeMeal(
  date: string,
  mealId: string,
  _formData: FormData,
): Promise<void> {
  const userId = await requireUserId()
  const day = normalizeDate(date)
  if (!isUuid(mealId)) backToDay(day, '这个餐次不存在')

  const supabase = await createClient()
  const { error } = await supabase.from('meals').delete().eq('id', mealId).eq('user_id', userId)

  if (error) backToDay(day, `删除餐次失败：${error.message}`)

  revalidateAll()
}

/**
 * 上移 / 下移一个餐次。
 *
 * 为什么不是简单地「把相邻两行的 sort_order 换一下」：meals 表上**没有**
 * (user_id, date, sort_order) 唯一约束（这是有意的，用户可能想要两个「加餐」），
 * 所以序号是可以重复的。序号一旦重复，交换就等于没动。
 *
 * 这里的做法是：读出当天全部餐次、按显示顺序排好、交换位置，然后把 sort_order
 * 重写成下标 0..n-1。顺带把重复的序号归一化掉。n 最多十来个，多几条 update 无所谓。
 */
export async function moveMeal(
  date: string,
  mealId: string,
  direction: string,
  _formData: FormData,
): Promise<void> {
  const userId = await requireUserId()
  const day = normalizeDate(date)
  if (!isUuid(mealId)) backToDay(day, '这个餐次不存在')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('meals')
    .select('id, sort_order')
    .eq('date', day)
    .order('sort_order')
    .order('created_at')

  if (error) backToDay(day, `调整顺序失败：${error.message}`)

  const list = (data ?? []) as Pick<MealRow, 'id' | 'sort_order'>[]
  const index = list.findIndex((m) => m.id === mealId)
  const target = direction === 'up' ? index - 1 : index + 1

  // 已经在头/尾了，什么都不做（按钮那边也会禁用，这里是并发下的兜底）
  if (index < 0 || target < 0 || target >= list.length) return

  const reordered = [...list]
  ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]

  for (let i = 0; i < reordered.length; i++) {
    if (reordered[i].sort_order === i) continue // 位置没变的行不用写
    const { error: writeError } = await supabase
      .from('meals')
      .update({ sort_order: i })
      .eq('id', reordered[i].id)
      .eq('user_id', userId)
    if (writeError) backToDay(day, `调整顺序失败：${writeError.message}`)
  }

  revalidateAll()
}
