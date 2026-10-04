/**
 * 餐次与饮食条目的校验逻辑。
 *
 * 和 lib/food-input.ts 一样放在没有 'use server' 的普通文件里 ——
 * 带 'use server' 的文件只能导出异步函数，那样就没法写单元测试了。
 */

import { LIMITS } from '@/lib/constants'
import { parsePositiveNumber } from '@/lib/num'

/**
 * 界面上允许的最小克数。
 *
 * 数据库那边 check 的是 amount_g > 0（允许到 0.01 g），但界面上小于 1 克的量没有实际
 * 意义，而且几乎都是手滑（想打 100 打成 1 之类的反向手滑倒是更常见）。
 * 所以界面比数据库更严一点，这是有意的。
 */
export const MIN_AMOUNT_G = 1

/** 把克数夹进合法区间。步进按钮走到头时用它兜住，而不是报错 */
export function clampAmountG(grams: number): number {
  if (!Number.isFinite(grams)) return MIN_AMOUNT_G
  return Math.min(LIMITS.amountG, Math.max(MIN_AMOUNT_G, grams))
}

export type AmountResult = { ok: true; grams: number } | { ok: false; message: string }

/**
 * 解析输入框里的克数。
 * 超出上限时**不**静默夹紧 —— 那会让「打错了」变成一个看起来正常的数字，用户不会发现。
 */
export function parseAmountG(raw: string): AmountResult {
  const text = raw.trim()
  if (text === '') return { ok: false, message: '请填克数' }

  const value = parsePositiveNumber(text, LIMITS.amountG)
  if (value === null || value < MIN_AMOUNT_G) {
    return { ok: false, message: `克数要在 ${MIN_AMOUNT_G} 到 ${LIMITS.amountG} 之间` }
  }

  return { ok: true, grams: clampAmountG(value) }
}

/** 步进：在当前值上加减，结果夹回合法区间（走到 20000 再加就停在 20000） */
export function stepAmountG(currentG: number, delta: number): number {
  return clampAmountG((Number.isFinite(currentG) ? currentG : MIN_AMOUNT_G) + delta)
}

export type MealNameResult = { ok: true; name: string } | { ok: false; message: string }

/** 餐次名不能为空；连续空白折叠成一个空格；长度对齐数据库的 check 约束 */
export function validateMealName(raw: string): MealNameResult {
  const name = raw.trim().replace(/\s+/g, ' ')

  if (name === '') return { ok: false, message: '给这一餐起个名字' }
  if (name.length > LIMITS.mealNameLength) {
    return { ok: false, message: `餐次名最多 ${LIMITS.mealNameLength} 个字` }
  }

  return { ok: true, name }
}
