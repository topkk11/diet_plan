/**
 * JSON 备份文件的**格式定义与校验**（纯函数，可单测）。
 *
 * 为什么必须有备份：本应用用 Supabase **匿名身份** —— 清一次浏览器数据、换一台手机，
 * 服务端就再也认不出你了，那些数据会变成没人能访问的孤儿。
 * 导出/恢复是唯一的自救通道，所以这里的原则是**宁可挑剔也不能放宽**：
 * 与其放进一半才在数据库里报错，不如在文件层面就把话说清楚，并且指出是第几行错了。
 *
 * 文件长这样（字段名用 camelCase，和数据库的 snake_case 有意区分开，
 * 这样一眼就能认出「这是备份文件」而不是随手导出的数据库行）：
 *
 * ```json
 * {
 *   "format": "diet-plan-backup",
 *   "version": 1,
 *   "exportedAt": "2026-10-05T12:34:56.789Z",
 *   "profile": { "heightCm": 175, ..., "timezone": "Asia/Shanghai" },
 *   "foods": [ ... ],
 *   "meals": [ ... ],
 *   "mealItems": [ ... ]
 * }
 * ```
 *
 * 两个刻意的取舍：
 *
 * 1. **带上 id，但恢复时会换掉**。文件里存 id 是为了在文件内部表达
 *    「这条记录属于哪个餐次、用的哪个食物」；真写进数据库时会重新生成 UUID。
 *    必须换 —— 旧 id 在原账户里仍然存在，直接插入会撞主键（见 actions/backup.ts）。
 *
 * 2. **`created_at` 原样保留，但 `updated_at` 不备份**。前者决定条目在同一餐里的
 *    先后顺序，丢了就还原不出原来的样子；后者纯粹是「最后一次改动时间」的记账，
 *    恢复时会由数据库触发器重新写上，没有保留价值。
 *
 * 校验用的是「抛异常 + 统一兜底」（BackupError），不是二十几个字段逐个
 * `if (!ok) return {...}` —— 那样真正的逻辑会被淹掉，而且很容易漏掉某个分支。
 */

import { LIMITS } from '@/lib/constants'
import { isValidIsoDate } from '@/lib/date'
import { asNumber } from '@/lib/num'
import { PROFILE_RANGES } from '@/lib/profile-input'
import type { Gender } from '@/lib/tdee'
import type { FoodRow, MealItemRow, MealRow, ProfileRow } from '@/lib/types'

export const BACKUP_FORMAT = 'diet-plan-backup'
export const BACKUP_VERSION = 1

/**
 * 允许导入的最大文件。和 next.config.ts 里 serverActions.bodySizeLimit 的 4mb 对齐 ——
 * 客户端先拦一道，用户拿到的是「文件太大了」而不是一个 413。
 */
export const MAX_BACKUP_BYTES = 4 * 1024 * 1024

/** 备份出来的文件在界面上叫什么名字 */
export function backupFileName(date: Date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10)
  return `饮食计划备份-${stamp}.json`
}

export type BackupProfile = {
  heightCm: number | null
  weightKg: number | null
  age: number | null
  gender: Gender | null
  weeklyExerciseHours: number
  manualTdeeKj: number | null
  deficitKj: number
  timezone: string
}

export type BackupFood = {
  id: string
  name: string
  energyKjPer100g: number
  proteinGPer100g: number
  carbsGPer100g: number
  fatGPer100g: number
  archivedAt: string | null
  createdAt: string
}

export type BackupMeal = {
  id: string
  date: string
  name: string
  sortOrder: number
  createdAt: string
}

export type BackupMealItem = {
  id: string
  mealId: string
  foodId: string
  amountG: number
  createdAt: string
}

export type BackupFile = {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  profile: BackupProfile | null
  foods: BackupFood[]
  meals: BackupMeal[]
  mealItems: BackupMealItem[]
}

// ---------------------------------------------------------------------------
// 导出：数据库行 → 备份文件
// ---------------------------------------------------------------------------

/**
 * 把四张表的行拼成备份文件。
 *
 * `exportedAt` 可以传进来是为了单测能拿到确定的输出 —— 其余部分全是纯映射。
 *
 * 输出**按内容排序**，所以同一份数据导出两次除了时间戳之外完全一样，
 * 可以直接用文本比对来确认「导入前和导入后是同一份数据」。
 */
export function toBackupFile(
  profile: ProfileRow | null,
  foods: readonly FoodRow[],
  meals: readonly MealRow[],
  mealItems: readonly MealItemRow[],
  exportedAt: string = new Date().toISOString(),
): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    profile:
      profile === null
        ? null
        : {
            heightCm: nullableColumn(profile.height_cm),
            weightKg: nullableColumn(profile.weight_kg),
            age: nullableColumn(profile.age),
            gender: profile.gender,
            weeklyExerciseHours: asNumber(profile.weekly_exercise_hours),
            manualTdeeKj: nullableColumn(profile.manual_tdee_kj),
            deficitKj: asNumber(profile.calorie_deficit_kj),
            timezone: profile.timezone,
          },
    foods: [...foods]
      .sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id))
      .map((food) => ({
        id: food.id,
        name: food.name,
        energyKjPer100g: asNumber(food.calories_kj_per_100g),
        proteinGPer100g: asNumber(food.protein_g_per_100g),
        carbsGPer100g: asNumber(food.carbs_g_per_100g),
        fatGPer100g: asNumber(food.fat_g_per_100g),
        archivedAt: food.archived_at,
        createdAt: food.created_at,
      })),
    meals: [...meals]
      .sort(
        (a, b) =>
          compareText(a.date, b.date) ||
          a.sort_order - b.sort_order ||
          compareText(a.id, b.id),
      )
      .map((meal) => ({
        id: meal.id,
        date: meal.date,
        name: meal.name,
        sortOrder: asNumber(meal.sort_order),
        createdAt: meal.created_at,
      })),
    mealItems: [...mealItems]
      .sort((a, b) => compareText(a.created_at, b.created_at) || compareText(a.id, b.id))
      .map((item) => ({
        id: item.id,
        mealId: item.meal_id,
        foodId: item.food_id,
        amountG: asNumber(item.amount_g),
        createdAt: item.created_at,
      })),
  }
}

/**
 * 按 Unicode 码点比大小。**故意不用 `localeCompare`**：
 * 它依赖运行时的默认 locale（本机是中文，会给拼音序；Vercel 上可能是别的），
 * 于是同一份数据在本地和线上导出的顺序不一样。备份文件要的是「每次都一样」，
 * 不是「读起来符合某种语言的习惯」—— 码点序在所有环境里都相同。
 */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** numeric 列读出来可能是 number、字符串或 null（见 lib/num.ts），统一成 number | null */
function nullableColumn(value: unknown): number | null {
  if (value === null || value === undefined) return null
  return asNumber(value)
}

// ---------------------------------------------------------------------------
// 导入：备份文件 → 校验过的数据
// ---------------------------------------------------------------------------

export type ParseBackupResult =
  | { ok: true; file: BackupFile }
  | { ok: false; message: string }

/**
 * 校验一份（已经 JSON.parse 过的）备份文件。
 *
 * 校验的每一条都对应数据库里的 check 约束或外键 —— 见 supabase/migrations/0001_init.sql。
 * 这里不放宽，是为了「文件不行就在文件这一层说清楚」：真写到一半被数据库拒绝，
 * 用户看到的是 `new row for relation "foods" violates check constraint` 这种东西。
 */
export function parseBackup(raw: unknown): ParseBackupResult {
  try {
    return { ok: true, file: readBackup(raw) }
  } catch (error) {
    if (error instanceof BackupError) return { ok: false, message: error.message }
    throw error
  }
}

/** 校验失败。用异常串起整条校验链，parseBackup 统一接住。 */
class BackupError extends Error {}

function fail(message: string): never {
  throw new BackupError(message)
}

function readBackup(raw: unknown): BackupFile {
  const root = obj(raw, '备份文件')

  if (root.format !== BACKUP_FORMAT) {
    fail(`这不像是本站导出的备份文件：format 应该是 "${BACKUP_FORMAT}"，实际是 ${show(root.format)}`)
  }
  if (root.version !== BACKUP_VERSION) {
    fail(`备份文件的版本是 ${show(root.version)}，当前网站只认版本 ${BACKUP_VERSION}`)
  }

  const exportedAt = timestamp(root.exportedAt, 'exportedAt')
  const profile = root.profile === null || root.profile === undefined ? null : readProfile(root.profile)

  const foods = arr(root.foods, 'foods').map((value, i) => readFood(value, `foods[${i}]`))
  const meals = arr(root.meals, 'meals').map((value, i) => readMeal(value, `meals[${i}]`))
  const mealItems = arr(root.mealItems, 'mealItems').map((value, i) =>
    readMealItem(value, `mealItems[${i}]`),
  )

  checkUniqueIds(foods, 'foods')
  checkUniqueIds(meals, 'meals')
  checkUniqueIds(mealItems, 'mealItems')

  // 引用完整性：文件是自包含的，任何指向文件之外的行都说明文件被改坏了。
  // 数据库里的外键也会拦（meal_items → meals / foods），但那时报错的是第几条都看不出来。
  const mealIds = new Set(meals.map((m) => m.id))
  const foodIds = new Set(foods.map((f) => f.id))
  mealItems.forEach((item, index) => {
    if (!mealIds.has(item.mealId)) {
      fail(`mealItems[${index}] 指向的餐次不在这个备份里（mealId ${item.mealId}）`)
    }
    if (!foodIds.has(item.foodId)) {
      fail(`mealItems[${index}] 指向的食物不在这个备份里（foodId ${item.foodId}）`)
    }
  })

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    profile,
    foods,
    meals,
    mealItems,
  }
}

function readProfile(raw: unknown): BackupProfile {
  const value = obj(raw, 'profile')

  const gender = value.gender === null || value.gender === undefined ? null : value.gender
  if (gender !== null && gender !== 'male' && gender !== 'female') {
    fail(`profile.gender 只能是 "male" 或 "female"，实际是 ${show(gender)}`)
  }

  return {
    heightCm: nullableNumber(value.heightCm, 'profile.heightCm', PROFILE_RANGES.heightCm),
    weightKg: nullableNumber(value.weightKg, 'profile.weightKg', PROFILE_RANGES.weightKg),
    age: nullableInteger(value.age, 'profile.age', PROFILE_RANGES.age),
    gender,
    weeklyExerciseHours: number(
      value.weeklyExerciseHours,
      'profile.weeklyExerciseHours',
      PROFILE_RANGES.weeklyExerciseHours,
    ),
    manualTdeeKj: nullableNumber(
      value.manualTdeeKj,
      'profile.manualTdeeKj',
      PROFILE_RANGES.manualTdeeKj,
    ),
    deficitKj: number(value.deficitKj, 'profile.deficitKj', PROFILE_RANGES.deficitKj),
    timezone: text(value.timezone, 'profile.timezone', 1, 64),
  }
}

function readFood(raw: unknown, where: string): BackupFood {
  const row = obj(raw, where)
  const macro = { min: 0, max: LIMITS.macroGPer100g }
  return {
    id: uuid(row.id, `${where}.id`),
    name: text(row.name, `${where}.name`, 1, LIMITS.foodNameLength),
    energyKjPer100g: number(row.energyKjPer100g, `${where}.energyKjPer100g`, {
      min: 0,
      max: LIMITS.energyKjPer100g,
    }),
    proteinGPer100g: number(row.proteinGPer100g, `${where}.proteinGPer100g`, macro),
    carbsGPer100g: number(row.carbsGPer100g, `${where}.carbsGPer100g`, macro),
    fatGPer100g: number(row.fatGPer100g, `${where}.fatGPer100g`, macro),
    archivedAt: nullableTimestamp(row.archivedAt, `${where}.archivedAt`),
    createdAt: timestamp(row.createdAt, `${where}.createdAt`),
  }
}

function readMeal(raw: unknown, where: string): BackupMeal {
  const row = obj(raw, where)
  const date = text(row.date, `${where}.date`, 10, 10)
  if (!isValidIsoDate(date)) {
    fail(`${where}.date 应该是 YYYY-MM-DD 格式的日期，实际是 ${show(date)}`)
  }
  return {
    id: uuid(row.id, `${where}.id`),
    date,
    name: text(row.name, `${where}.name`, 1, LIMITS.mealNameLength),
    // 数据库没给 sort_order 加约束（同一天允许两个同序号的餐次），这里给个宽松上限防手滑
    sortOrder: integer(row.sortOrder, `${where}.sortOrder`, { min: 0, max: 10_000 }),
    createdAt: timestamp(row.createdAt, `${where}.createdAt`),
  }
}

function readMealItem(raw: unknown, where: string): BackupMealItem {
  const row = obj(raw, where)
  return {
    id: uuid(row.id, `${where}.id`),
    mealId: uuid(row.mealId, `${where}.mealId`),
    foodId: uuid(row.foodId, `${where}.foodId`),
    // 数据库：check (amount_g > 0 and amount_g <= 20000)
    amountG: positiveNumber(row.amountG, `${where}.amountG`, LIMITS.amountG),
    createdAt: timestamp(row.createdAt, `${where}.createdAt`),
  }
}

function checkUniqueIds(rows: readonly { id: string }[], where: string): void {
  const seen = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.id)) fail(`${where} 里有两个相同的 id（${row.id}），文件已经损坏`)
    seen.add(row.id)
  }
}

// ---------------------------------------------------------------------------
// 底层取值与类型校验
// ---------------------------------------------------------------------------

type Range = { readonly min: number; readonly max: number }

function obj(raw: unknown, where: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(`${where} 应该是一个对象，实际是 ${show(raw)}`)
  }
  return raw as Record<string, unknown>
}

function arr(raw: unknown, where: string): unknown[] {
  if (!Array.isArray(raw)) fail(`${where} 应该是一个数组，实际是 ${show(raw)}`)
  return raw
}

/** 非空文本。首尾空白会被去掉 —— 数据库的 check 也是按 btrim() 算长度的。 */
function text(raw: unknown, where: string, min: number, max: number): string {
  if (typeof raw !== 'string') fail(`${where} 应该是文字，实际是 ${show(raw)}`)
  const trimmed = raw.trim()
  if (trimmed.length < min || trimmed.length > max) {
    fail(`${where} 的长度应该在 ${min} 到 ${max} 之间，实际是 ${trimmed.length} 个字`)
  }
  return trimmed
}

function number(raw: unknown, where: string, range: Range): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    fail(`${where} 应该是数字，实际是 ${show(raw)}`)
  }
  if (raw < range.min || raw > range.max) {
    fail(`${where} 应该在 ${range.min} 到 ${range.max} 之间，实际是 ${raw}`)
  }
  return raw
}

/** 严格大于 0 的数字（克数用；0 克的记录没有意义，数据库也不收） */
function positiveNumber(raw: unknown, where: string, max: number): number {
  const parsed = number(raw, where, { min: 0, max })
  if (parsed <= 0) fail(`${where} 必须大于 0，实际是 ${parsed}`)
  return parsed
}

function nullableNumber(raw: unknown, where: string, range: Range): number | null {
  if (raw === null || raw === undefined) return null
  return number(raw, where, range)
}

function integer(raw: unknown, where: string, range: Range): number {
  const parsed = number(raw, where, range)
  if (!Number.isInteger(parsed)) fail(`${where} 应该是整数，实际是 ${parsed}`)
  return parsed
}

function nullableInteger(raw: unknown, where: string, range: Range): number | null {
  if (raw === null || raw === undefined) return null
  return integer(raw, where, range)
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuid(raw: unknown, where: string): string {
  if (typeof raw !== 'string' || !UUID_PATTERN.test(raw)) {
    fail(`${where} 不是合法的 id，实际是 ${show(raw)}`)
  }
  return raw
}

/**
 * 时间戳。**原样返回，不做 Date 往返** —— Postgres 的 timestamptz 精确到微秒，
 * 而 JS 的 toISOString() 只到毫秒，往返一次会把同一条记录的时间改掉，
 * 恢复后同一餐里条目的先后顺序就可能变。
 */
function timestamp(raw: unknown, where: string): string {
  if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) {
    fail(`${where} 不是合法的时间，实际是 ${show(raw)}`)
  }
  return raw
}

function nullableTimestamp(raw: unknown, where: string): string | null {
  if (raw === null || raw === undefined) return null
  return timestamp(raw, where)
}

/** 拼错误信息用：把任意值变成一段短到能塞进一句话的说明 */
function show(raw: unknown): string {
  if (raw === undefined) return '（这个字段不存在）'
  if (typeof raw === 'string') {
    return `"${raw.length > 40 ? `${raw.slice(0, 40)}…` : raw}"`
  }
  const rendered = JSON.stringify(raw)
  if (rendered === undefined) return String(raw)
  return rendered.length > 60 ? `${rendered.slice(0, 60)}…` : rendered
}
