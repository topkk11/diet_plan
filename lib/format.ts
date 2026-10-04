/**
 * 显示格式化。所有涉及取整的地方都收在这里，中间计算一律不取整
 * （见 lib/nutrition.ts 的注释）。
 */

import { kjToKcal, round } from '@/lib/nutrition'

/** 数字加千分位，固定小数位 */
function fixed(value: number, digits = 0): string {
  return round(value, digits).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** "1250 kJ" */
export function formatKj(kj: number): string {
  return `${fixed(kj)} kJ`
}

/** 输入是 kJ，输出是等价的 "299 kcal" */
export function formatKcal(kj: number): string {
  return `${fixed(kjToKcal(kj))} kcal`
}

/**
 * "1250 kJ (299 kcal)" —— 首页和食物库统一用这个，
 * 满足「输入是千焦、展示时同时给出 kcal」的需求
 */
export function formatEnergyBoth(kj: number): string {
  return `${formatKj(kj)} (${formatKcal(kj)})`
}

/**
 * "1649 kcal" —— 输入**本来就是 kcal** 时用它（BMR、按公式算出的 TDEE 中间值）。
 * 不要拿它去格式化存在库里的能量：库里的能量一律是 kJ，用 formatKj / formatEnergyBoth。
 */
export function formatKcalValue(kcal: number): string {
  return `${fixed(kcal)} kcal`
}

/** "12.5 g" */
export function formatMacro(grams: number): string {
  return `${fixed(grams, 1)} g`
}

/** "250 g"，整数克不显示小数点 */
export function formatAmount(grams: number): string {
  return Number.isInteger(grams) ? `${fixed(grams)} g` : `${fixed(grams, 1)} g`
}

/** 带正负号，用于「剩余可摄入」这类需要突出方向的数字 */
export function formatSigned(value: number, digits = 0): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${fixed(value, digits)}`
}
