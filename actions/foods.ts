'use server'

/**
 * 食物库的写操作（Server Actions）。
 *
 * 每个 action 都自己做三件事，缺一不可：
 *   1. 认证 —— requireUserId() 拿不到会话就抛错，绝不「静默失败」
 *   2. 校验 —— FormData 一律当成不可信输入，用 lib/food-input.ts 里的纯函数校验
 *   3. 带 user_id 写入 —— 数据库的 RLS 已经能挡住越权，这里再显式带一遍是双保险
 *
 * 关于 revalidatePath：所有页面都是 force-dynamic，本身不会进服务端缓存，
 * 但浏览器的 Client Router Cache 可能还留着旧的 RSC 数据。用
 * `revalidatePath('/', 'layout')` 一次性清掉整个客户端缓存 —— 这是官方文档里
 * 「revalidating all data」的写法，比逐个写 '/foods' '/' 更不容易漏。
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { createClient, requireUserId } from '@/lib/supabase/server'
import { isUuid, readFoodForm, validateFoodForm, type FoodFormErrors } from '@/lib/food-input'
import type { FoodFormValues } from '@/lib/food-input'
import { round } from '@/lib/nutrition'
import { safeInternalPath } from '@/lib/url'

/**
 * 表单类 action 的返回结构，给 useActionState 用。
 *
 * saved 字段是给「保存并继续添加下一个」用的：那条路径不跳转（要留在本页接着录），
 * 所以需要一个明确信号让客户端把表单清空。
 */
export type FoodFormState = {
  errors: FoodFormErrors
  /** 顶部提示条文案 */
  message: string
  /** 是否保存成功 */
  saved: boolean
} | null

/**
 * 删除/归档失败时用跳转把错误带回列表页。
 *
 * 为什么不直接把错误 return 给界面：这两个 action 是通过 `<form action={fn.bind(null, id)}>`
 * 直接绑定的（不是 useActionState），好处是**没有 JavaScript 也能提交**，代价是返回值没人接。
 * 又不想静默失败 —— 那就跳回列表页用一个 query 参数把话说清楚。
 */
function backToFoodsWithError(message: string): never {
  redirect(`/foods?error=${encodeURIComponent(message)}`)
}

/** 界面上的值 → 数据库列。顺便按 numeric(_,2) 的精度取整，免得库里的值带上长尾小数。 */
function toColumns(values: FoodFormValues) {
  return {
    name: values.name,
    calories_kj_per_100g: round(values.energyKjPer100g, 2),
    protein_g_per_100g: round(values.proteinGPer100g, 2),
    carbs_g_per_100g: round(values.carbsGPer100g, 2),
    fat_g_per_100g: round(values.fatGPer100g, 2),
  }
}

/** 新增食物 */
export async function createFood(
  _prev: FoodFormState,
  formData: FormData,
): Promise<FoodFormState> {
  const userId = await requireUserId()

  const parsed = validateFoodForm(readFoodForm(formData))
  if (!parsed.ok) return { errors: parsed.errors, message: '', saved: false }

  const supabase = await createClient()
  const { error } = await supabase
    .from('foods')
    .insert({ user_id: userId, ...toColumns(parsed.values) })

  if (error) return { errors: {}, message: `保存失败：${error.message}`, saved: false }

  revalidatePath('/', 'layout')

  // 「保存并继续添加下一个」按钮带 intent=another 提交：留在本页，由客户端清空表单。
  // 不用 redirect 回本页 —— 同一路由的跳转不一定重置客户端组件状态，表单可能留着上一条的内容。
  if (formData.get('intent') === 'another') {
    return { errors: {}, message: `已保存「${parsed.values.name}」，接着录下一条`, saved: true }
  }

  // 「在选食物时现场新建一个」这条路会把来源页放在 next 里（见 components/FoodPicker.tsx），
  // 存完直接跳回去，不用用户自己找回来。只认站内相对路径，否则一律回食物库。
  redirect(safeInternalPath(String(formData.get('next') ?? '')) ?? '/foods')
}

/** 修改食物 */
export async function updateFood(
  id: string,
  _prev: FoodFormState,
  formData: FormData,
): Promise<FoodFormState> {
  const userId = await requireUserId()

  if (!isUuid(id)) {
    return { errors: {}, message: '这个食物不存在（链接里的 id 不合法）', saved: false }
  }

  const parsed = validateFoodForm(readFoodForm(formData))
  if (!parsed.ok) return { errors: parsed.errors, message: '', saved: false }

  const supabase = await createClient()
  // 显式带上 user_id：万一 RLS 策略将来被误删，这里也不会改到别人的行
  const { error } = await supabase
    .from('foods')
    .update(toColumns(parsed.values))
    .eq('id', id)
    .eq('user_id', userId)

  if (error) return { errors: {}, message: `保存失败：${error.message}`, saved: false }

  revalidatePath('/', 'layout')
  redirect('/foods')
}

/**
 * 删除或归档。
 *
 * 规则（你选的「历史跟着食物变」的直接后果）：被饮食记录引用过的食物**不能真删**，
 * 否则历史记录会缺一块。所以：
 *   · 没被引用 → 真删除
 *   · 被引用   → 归档（从食物库列表和选择器里消失，但历史里照常显示）
 *
 * 引用数是在这里现查的，不是用列表传过来的那个 —— 列表可能是几分钟前渲染的，
 * 期间用户可能刚好在首页用它加了一条记录。
 */
export async function removeFood(id: string, _formData: FormData): Promise<void> {
  const userId = await requireUserId()
  if (!isUuid(id)) backToFoodsWithError('这个食物不存在')

  const supabase = await createClient()

  const { count, error: countError } = await supabase
    .from('meal_items')
    .select('*', { count: 'exact', head: true })
    .eq('food_id', id)
    .eq('user_id', userId)

  if (countError) backToFoodsWithError(`操作失败：${countError.message}`)

  if ((count ?? 0) > 0) {
    await archiveFood(supabase, userId, id)
    return
  }

  const { error } = await supabase.from('foods').delete().eq('id', id).eq('user_id', userId)

  if (error) {
    // 并发兜底：刚查完没有引用，删的那一瞬间多了一条记录 → 外键 on delete restrict 会拦住。
    // 这种情况改成归档，而不是把一串看不懂的数据库错误甩给用户。
    if (error.code === '23503') {
      await archiveFood(supabase, userId, id)
      return
    }
    backToFoodsWithError(`删除失败：${error.message}`)
  }

  revalidatePath('/', 'layout')
}

/** 把归档的食物恢复到在用状态 */
export async function restoreFood(id: string, _formData: FormData): Promise<void> {
  const userId = await requireUserId()
  if (!isUuid(id)) backToFoodsWithError('这个食物不存在')

  const supabase = await createClient()
  const { error } = await supabase
    .from('foods')
    .update({ archived_at: null })
    .eq('id', id)
    .eq('user_id', userId)

  if (error) backToFoodsWithError(`恢复失败：${error.message}`)

  revalidatePath('/', 'layout')
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/** 把食物标记为已归档，失败就带着原因跳回列表页 */
async function archiveFood(
  supabase: SupabaseServerClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('foods')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)

  if (error) backToFoodsWithError(`归档失败：${error.message}`)

  revalidatePath('/', 'layout')
}
