/**
 * 服务端数据读取。全部在 Server Component 里调用。
 *
 * 注意：每次都要 `await createClient()` 新建客户端，不要缓存 —— 见 lib/supabase/server.ts。
 *
 * RLS 已经在数据库层按 auth.uid() 过滤好了，所以这里的查询**不需要**手写
 * `.eq('user_id', ...)`。但如果依赖 RLS 而忘了它，一旦策略被误删就会读到别人的数据，
 * 所以写操作（Server Action）里仍然会显式带上 user_id，做双保险。
 */

import { createClient } from '@/lib/supabase/server'
import { asNumber } from '@/lib/num'
import { isUuid, sanitizeSearchTerm } from '@/lib/food-input'
import { buildDayPlan, foodPer100g, type DayPlan, type FoodNutrientColumns } from '@/lib/food'
import { toTdeeInput } from '@/lib/profile-input'
import { calcTdee } from '@/lib/tdee'
import { HISTORY_DAYS, HISTORY_MEAL_SCAN_LIMIT } from '@/lib/constants'
import { per100gToAmount, sumNutrients, type Nutrients } from '@/lib/nutrition'
import type { FoodRow, MealItemRow, MealRow, ProfileRow } from '@/lib/types'

/** 当前会话的用户信息，用于「连接自检」显示 */
export async function getSessionUser() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return {
    id: data.user.id,
    isAnonymous: data.user.is_anonymous === true,
    createdAt: data.user.created_at,
  }
}

/** 读当前用户的个人资料。正常情况下一行总是存在（由数据库触发器建好） */
export async function getProfile(): Promise<ProfileRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('user_profile').select('*').maybeSingle()
  if (error) throw new Error(`读取个人资料失败：${error.message}`)
  return (data as ProfileRow | null) ?? null
}

/** 食物库里还有多少个未归档的食物 */
export async function countActiveFoods(): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('foods')
    .select('*', { count: 'exact', head: true })
    .is('archived_at', null)
  if (error) throw new Error(`统计食物失败：${error.message}`)
  return count ?? 0
}

/**
 * 食物库列表项：食物本身 + 「被多少条饮食记录引用」。
 *
 * 为什么要带引用数：决定这个食物能不能**真删除**。
 * 你们的规则是「历史跟着食物变」，所以被历史引用过的食物只能归档、不能删。
 * 与其等用户点了删除才告诉他「不行」，不如一开始就把按钮做成「归档」并写清原因。
 */
export type FoodListItem = FoodRow & { refCount: number }

/**
 * 读食物库列表。
 *
 * @param q 搜索关键词，空则不筛选。会用 sanitizeSearchTerm 清洗后做 ilike 模糊匹配。
 * @param archived false（默认）只看在用的；true 只看已归档的（归档 = 从库里隐藏但历史还在用）
 *
 * 关于 `meal_items(count)`：这是 PostgREST 的关联计数语法，靠外键关系自动聚合，
 * 一次查询就带回每行的引用数，不用为每个食物再查一遍。
 */
export async function listFoods(
  options: { q?: string; archived?: boolean; limit?: number } = {},
): Promise<FoodListItem[]> {
  const supabase = await createClient()
  const keyword = sanitizeSearchTerm(options.q ?? '')

  let query = supabase
    .from('foods')
    .select('*, meal_items(count)')
    .order('name', { ascending: true })

  query = options.archived
    ? query.not('archived_at', 'is', null)
    : query.is('archived_at', null)

  if (keyword !== '') query = query.ilike('name', `%${keyword}%`)
  if (options.limit !== undefined) query = query.limit(options.limit)

  const { data, error } = await query
  if (error) throw new Error(`读取食物库失败：${error.message}`)

  return (data ?? []).map((row) => {
    const { meal_items: counts, ...food } = row as FoodRow & {
      meal_items?: { count: number }[]
    }
    return { ...food, refCount: Number(counts?.[0]?.count ?? 0) }
  })
}

/** 读单个食物（编辑页用）。id 非法或不属于当前用户时返回 null。 */
export async function getFood(id: string): Promise<FoodRow | null> {
  if (!isUuid(id)) return null

  const supabase = await createClient()
  const { data, error } = await supabase.from('foods').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`读取食物失败：${error.message}`)
  return (data as FoodRow | null) ?? null
}

/**
 * 打开某一天：先把当天的餐次结构补齐，再读出完整计划。
 *
 * 为什么允许「渲染页面时写数据库」：渲染本身不该有副作用，但这里的写是**幂等**的
 * （ensure_day_meals 内部先判断当天是否已有餐次），而且只可能创建当前用户自己、
 * 且请求的那一天的行。做成数据库函数而不是在 TS 里写「查→判断→插」三步，就是为了
 * 让它在并发下也安全（见 supabase/migrations/0001_init.sql 里那段注释）。
 *
 * 副作用是：用户翻到哪一天，哪一天就会有一份空餐次。这是刻意的取舍 ——
 * 换来的是「打开某天就能直接开始记」，不用先点一次「初始化」。
 */
export async function getOrCreateDayPlan(date: string): Promise<DayPlan> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('ensure_day_meals', { p_date: date })
  if (error) throw new Error(`准备当天的餐次失败：${error.message}`)

  return getDayPlan(date)
}

/**
 * 读某一天的完整饮食计划。
 *
 * 三次查询而不是一次嵌套查询：数据量很小（一天几十条），分开查更好读也更好排错。
 */
export async function getDayPlan(date: string): Promise<DayPlan> {
  const supabase = await createClient()

  const { data: mealRows, error: mealError } = await supabase
    .from('meals')
    .select('*')
    .eq('date', date)
    .order('sort_order')
  if (mealError) throw new Error(`读取餐次失败：${mealError.message}`)

  const meals = (mealRows ?? []) as MealRow[]
  if (meals.length === 0) return buildDayPlan(date, [], [], [])

  const mealIds = meals.map((m) => m.id)

  const { data: itemRows, error: itemError } = await supabase
    .from('meal_items')
    .select('*')
    .in('meal_id', mealIds)
    .order('created_at')
  if (itemError) throw new Error(`读取饮食记录失败：${itemError.message}`)

  const items = (itemRows ?? []) as MealItemRow[]
  if (items.length === 0) return buildDayPlan(date, meals, [], [])

  // 已归档的食物也要能读到 —— 历史记录里它还得出示名称和营养值
  const foodIds = [...new Set(items.map((i) => i.food_id))]
  const { data: foodRows, error: foodError } = await supabase
    .from('foods')
    .select('*')
    .in('id', foodIds)
  if (foodError) throw new Error(`读取食物失败：${foodError.message}`)

  return buildDayPlan(date, meals, items, (foodRows ?? []) as FoodRow[])
}

/**
 * 加上 asNumber 的 profile 数值视图，避免组件里到处写转换。
 *
 * 前面的字段就是 lib/profile-input.ts 的 ProfileFormValues（多一个 timezone），
 * 所以资料页可以直接把它交给 profileToRaw() 预填表单，首页也可以直接交给
 * toTdeeInput()。
 */
export function profileNumbers(profile: ProfileRow | null) {
  if (!profile) return null
  return {
    heightCm: profile.height_cm === null ? null : asNumber(profile.height_cm),
    weightKg: profile.weight_kg === null ? null : asNumber(profile.weight_kg),
    age: profile.age === null ? null : asNumber(profile.age),
    gender: profile.gender,
    weeklyExerciseHours: asNumber(profile.weekly_exercise_hours),
    manualTdeeKj: profile.manual_tdee_kj === null ? null : asNumber(profile.manual_tdee_kj),
    deficitKj: asNumber(profile.calorie_deficit_kj),
    timezone: profile.timezone,
  }
}

/**
 * 首页汇总卡要的两个数：每日总消耗与热量缺口。
 *
 * TDEE 取「手动覆盖优先，否则按公式估算」之后的**最终值**（见 lib/tdee.ts）——
 * 就是说这张卡永远和资料页上显示的数字一致，不会一个用一个口径。
 *
 * @returns 既没填齐身体数据、也没手动设 TDEE 时返回 null，UI 应引导去资料页
 */
export async function getEnergyTarget(): Promise<{ tdeeKj: number; deficitKj: number } | null> {
  const numbers = profileNumbers(await getProfile())
  if (numbers === null) return null

  const tdee = calcTdee(toTdeeInput(numbers), numbers.manualTdeeKj)
  if (tdee === null) return null

  return { tdeeKj: tdee.tdeeKj, deficitKj: numbers.deficitKj }
}

/** 历史列表的一行：某个有记录的日期，以及当天的合计 */
export type DaySummary = {
  /** YYYY-MM-DD */
  date: string
  /** 当天一共记了多少条（一个食物算一条） */
  itemCount: number
  totals: Nutrients
}

/**
 * 历史页要的那条查询：餐次 + 它下面的条目 + 每个条目的食物营养。
 *
 * 写成一层嵌套查询而不是「先查餐次、再查条目、再查食物」三次往返，
 * 是因为这里要跨很多天，三次查询拿回来的数据还得在 TS 里手动对齐。
 *
 * **`meal_items!inner` 的 `!inner` 是关键，不能省。** 它的意思是「只返回有记录的餐次」，
 * 把空餐次在数据库层就滤掉。没有它的话，配合下面的 LIMIT 会出一个很坏的故障：
 * ensure_day_meals 会给**任何被打开过的日期**建一份空餐次（见 getOrCreateDayPlan），
 * 于是用户拿日期切换器往后翻几十天之后，这些空餐次会挤满 360 行的配额，
 * 历史页会突然变成一片空白 —— 而且数据明明都在。
 */
const HISTORY_SELECT =
  'date,meal_items!inner(amount_g,foods(calories_kj_per_100g,protein_g_per_100g,carbs_g_per_100g,fat_g_per_100g))'

/** 嵌套查询回来的行。刻意只声明用得到的字段，不做完整行类型。 */
type HistoryMealRow = {
  date: string
  meal_items: { amount_g: number | string; foods: FoodNutrientColumns | null }[] | null
}

/**
 * 有记录的日期倒序，每个日期带上当天的热量与三大营养素合计。
 *
 * 三个取舍，都是为了「手机上一秒内打开」：
 *
 * 1. **只回看 HISTORY_DAYS 天**。要不加限制就得把整个账号的条目都读回来算一遍，
 *    用了几年之后这一页会拖回几万行。
 * 2. **只扫 HISTORY_MEAL_SCAN_LIMIT 个餐次行**，用 LIMIT 交给数据库做。
 *    一天四餐的话 360 行能覆盖 90 天，够用。
 * 3. **空日期不进列表**（SQL 的 `!inner` 已经滤掉了，下面还留一道保险）。
 *    因为 ensure_day_meals 会给任何被打开过的日期建一份空餐次
 *    （见 getOrCreateDayPlan 的注释），不加这一条的话，
 *    随手翻过的每一天都会在历史里留下一行「0 kJ」。
 */
export async function listDaySummaries(): Promise<DaySummary[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('meals')
    .select(HISTORY_SELECT)
    .order('date', { ascending: false })
    .order('sort_order', { ascending: true })
    .limit(HISTORY_MEAL_SCAN_LIMIT)
  if (error) throw new Error(`读取历史失败：${error.message}`)

  const byDate = new Map<string, { itemCount: number; nutrients: Nutrients[] }>()

  for (const meal of (data ?? []) as unknown as HistoryMealRow[]) {
    const bucket = byDate.get(meal.date) ?? { itemCount: 0, nutrients: [] }
    for (const item of meal.meal_items ?? []) {
      // 理论上不会缺（外键保证食物存在），保险起见跳过而不是崩掉整页
      if (!item.foods) continue
      bucket.nutrients.push(per100gToAmount(foodPer100g(item.foods), asNumber(item.amount_g)))
      bucket.itemCount += 1
    }
    byDate.set(meal.date, bucket)
  }

  return [...byDate.entries()]
    .filter(([, bucket]) => bucket.itemCount > 0)
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .slice(0, HISTORY_DAYS)
    .map(([date, bucket]) => ({
      date,
      itemCount: bucket.itemCount,
      totals: sumNutrients(bucket.nutrients),
    }))
}

/**
 * 导出备份用：把当前用户四张表的所有行读出来。
 *
 * **必须分页。** PostgREST 单次查询返回的行数有上限（Supabase 默认 1000），
 * 超出的部分会被悄悄截断 —— 一个「少了后面一半」的备份比没有备份更危险，
 * 因为用户以为自己安全了。所以按 1000 行一页翻到底。
 *
 * 翻页必须配 `order('id')`：主键唯一，顺序稳定，否则 Postgres 每次返回的
 * 行序可以不同，翻页时会漏行或重复。
 */
export async function getBackupRows(): Promise<{
  profile: ProfileRow | null
  foods: FoodRow[]
  meals: MealRow[]
  mealItems: MealItemRow[]
}> {
  const supabase = await createClient()

  const [profile, foods, meals, mealItems] = await Promise.all([
    getProfile(),
    fetchAllPages<FoodRow>('食物', (from, to) =>
      supabase.from('foods').select('*').order('id').range(from, to),
    ),
    fetchAllPages<MealRow>('餐次', (from, to) =>
      supabase.from('meals').select('*').order('id').range(from, to),
    ),
    fetchAllPages<MealItemRow>('饮食记录', (from, to) =>
      supabase.from('meal_items').select('*').order('id').range(from, to),
    ),
  ])

  return { profile, foods, meals, mealItems }
}

/** PostgREST 一页的行数，和 Supabase 的默认上限一致 */
const REST_PAGE_SIZE = 1000

type Page<T> = { data: T[] | null; error: { message: string } | null }

/** 一页一页地翻，直到某一页不满为止 */
async function fetchAllPages<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<Page<T>>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += REST_PAGE_SIZE) {
    const { data, error } = await page(from, from + REST_PAGE_SIZE - 1)
    if (error) throw new Error(`读取${label}失败：${error.message}`)
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < REST_PAGE_SIZE) return rows
  }
}
