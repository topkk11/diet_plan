/**
 * 食物表单的解析、校验与搜索词清洗。
 *
 * 为什么单独一个文件：Server Action 文件带 'use server'，里面**只能导出 async 函数**，
 * 纯逻辑放进去就没法被 vitest 直接测。所以校验放这里，actions/foods.ts 只管读写数据库。
 */

import { LIMITS } from '@/lib/constants'
import { parseNonNegativeNumber } from '@/lib/num'

/** 表单里五个输入框的**原始字符串**。受控组件用它，好处是出错重渲染时用户输入不会丢。 */
export type FoodFormRaw = {
  name: string
  energyKj: string
  proteinG: string
  carbsG: string
  fatG: string
}

export const EMPTY_FOOD_FORM: FoodFormRaw = {
  name: '',
  energyKj: '',
  proteinG: '',
  carbsG: '',
  fatG: '',
}

/** 哪个字段错了、错误提示是什么 */
export type FoodFormErrors = Partial<Record<keyof FoodFormRaw, string>>

/** 校验通过后的数值 */
export type FoodFormValues = {
  name: string
  energyKjPer100g: number
  proteinGPer100g: number
  carbsGPer100g: number
  fatGPer100g: number
}

export type FoodFormResult =
  | { ok: true; values: FoodFormValues }
  | { ok: false; errors: FoodFormErrors }

/** 从 FormData 里取出那五个字段的原始字符串 */
export function readFoodForm(formData: FormData): FoodFormRaw {
  const text = (key: keyof FoodFormRaw): string => {
    const value = formData.get(key)
    return typeof value === 'string' ? value : ''
  }
  return {
    name: text('name'),
    energyKj: text('energyKj'),
    proteinG: text('proteinG'),
    carbsG: text('carbsG'),
    fatG: text('fatG'),
  }
}

/**
 * 校验。规则与数据库里的 check 约束一一对应（见 supabase/migrations/0001_init.sql）。
 *
 * 一个有意的取舍：**热量必填，三大营养素可以留空**。
 * 理由是热量是这个应用的核心数据，留空多半是忘了填，静默当成 0 会得到「零热量的牛奶」
 * 这种看着正常实则错误的数据；而营养素确实有食物查不到，留空按 0 处理是合理的。
 */
export function validateFoodForm(raw: FoodFormRaw): FoodFormResult {
  const errors: FoodFormErrors = {}

  const name = raw.name.trim()
  if (name === '') errors.name = '请填食物名称'
  else if (name.length > LIMITS.foodNameLength) {
    errors.name = `名称最多 ${LIMITS.foodNameLength} 个字`
  }

  if (raw.energyKj.trim() === '') {
    errors.energyKj = '请填热量（包装上一般是「能量 xxx kJ/100g」）'
  }
  const energyKj = parseNonNegativeNumber(raw.energyKj, LIMITS.energyKjPer100g)
  if (energyKj === null && !errors.energyKj) {
    errors.energyKj = `请填 0 到 ${LIMITS.energyKjPer100g} 之间的数字`
  }

  // 留空 → 0；填了但解析不出来 → 该字段报错
  const macro = (value: string): number | null => {
    if (value.trim() === '') return 0
    return parseNonNegativeNumber(value, LIMITS.macroGPer100g)
  }
  const proteinG = macro(raw.proteinG)
  const carbsG = macro(raw.carbsG)
  const fatG = macro(raw.fatG)
  const macroMessage = `请填 0 到 ${LIMITS.macroGPer100g} 之间的数字，或留空`
  if (proteinG === null) errors.proteinG = macroMessage
  if (carbsG === null) errors.carbsG = macroMessage
  if (fatG === null) errors.fatG = macroMessage

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  // 这个判断只是为了通过类型检查：上面只要有 null 就已经 return 了，实际到不了这里
  if (energyKj === null || proteinG === null || carbsG === null || fatG === null) {
    return { ok: false, errors: { energyKj: '数值无效，请重新输入' } }
  }

  return {
    ok: true,
    values: {
      name,
      energyKjPer100g: energyKj,
      proteinGPer100g: proteinG,
      carbsGPer100g: carbsG,
      fatGPer100g: fatG,
    },
  }
}

/**
 * 把搜索词变成可以安全塞进 PostgREST `ilike` 的字符串。
 *
 * 为什么需要它（读过 supabase-js 源码确认，不是猜的）：
 *   PostgrestFilterBuilder.ilike() 的实现只有一行 ——
 *     this.url.searchParams.append(column, `ilike.${pattern}`)
 *   **它不做任何转义**。于是搜索词里：
 *     · `%` 和 `_` 会被 SQL 当成通配符 —— 搜「100%」实际退化成搜「100」，结果看着对、其实不对
 *     · `,` `(` `)` `"` 是 PostgREST 过滤语法的保留字符，可能让整个请求报错
 *   与其在「JS → URL → PostgREST → SQL LIKE」四层之间来回转义（每层规则不同，
 *   很容易写出看着严密其实漏一层的代码），不如把这些字符直接换成空格：
 *   搜食物名根本用不到它们，代价几乎为零。
 *
 * 注意 `%` 是我们自己加在首尾的（`%${q}%`），那是**故意**要的通配符，不受这里影响。
 */
export function sanitizeSearchTerm(raw: string, maxLength = 50): string {
  return raw
    .replace(/[%_\\]/g, ' ') // LIKE 的通配符与转义符
    .replace(/[,()"]/g, ' ') // PostgREST 过滤语法的保留字符
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/**
 * 判断字符串是不是一个合法的 UUID。
 *
 * 为什么需要：`/foods/[id]/edit` 的 id 直接来自 URL，用户可以手打任意字符串。
 * 不校验就发给 PostgREST，Postgres 解析 uuid 失败会返回 400，页面直接 500 白屏。
 * 当成「找不到这个食物」返回 404 更合理。
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}
