/**
 * BMR / TDEE 计算。
 *
 * 设计原则：**公式算出来的 TDEE 只是初始值**。用户随时可以在资料页手动覆盖，
 * 覆盖后以手动值为准（见 calcTdee 的 manualTdeeKj 参数）。所以这里不追求
 * 「绝对准确」，只追求「透明可解释 + 可被推翻」。
 */

import { KJ_PER_KCAL, round } from '@/lib/nutrition'

export type Gender = 'male' | 'female'

export type TdeeInput = {
  heightCm: number
  weightKg: number
  age: number
  gender: Gender
  weeklyExerciseHours: number
}

/**
 * Mifflin-St Jeor 公式（kcal/天）。
 * 男：10×体重 + 6.25×身高 − 5×年龄 + 5
 * 女：10×体重 + 6.25×身高 − 5×年龄 − 161
 */
export function calcBmrKcal(input: Pick<TdeeInput, 'heightCm' | 'weightKg' | 'age' | 'gender'>): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age
  return input.gender === 'male' ? base + 5 : base - 161
}

/**
 * 每周运动小时数 → 活动系数。
 *
 * ⚠️ 这是**估算**，不是精确科学。区间取「下界含、上界含」（≤1 落在第一档，
 * 1.1 落到第二档），所以 1 / 3 / 5 / 8 小时正好在档位边界上。
 * 界面上会把这张表显式展示给用户看，而且 TDEE 永远可以手动覆盖。
 */
export const ACTIVITY_BANDS = [
  { maxHours: 1, factor: 1.2, label: '久坐', hint: '每周运动 ≤ 1 小时' },
  { maxHours: 3, factor: 1.375, label: '轻度活动', hint: '每周运动 1–3 小时' },
  { maxHours: 5, factor: 1.55, label: '中度活动', hint: '每周运动 3–5 小时' },
  { maxHours: 8, factor: 1.725, label: '高度活动', hint: '每周运动 5–8 小时' },
  { maxHours: Number.POSITIVE_INFINITY, factor: 1.9, label: '极高强度', hint: '每周运动 8 小时以上' },
] as const

export type ActivityBand = (typeof ACTIVITY_BANDS)[number]

/** 查出落在哪一档 */
export function activityBand(weeklyExerciseHours: number): ActivityBand {
  const hours = Number.isFinite(weeklyExerciseHours) ? Math.max(0, weeklyExerciseHours) : 0
  for (const band of ACTIVITY_BANDS) {
    if (hours <= band.maxHours) return band
  }
  return ACTIVITY_BANDS[ACTIVITY_BANDS.length - 1]
}

export function activityFactor(weeklyExerciseHours: number): number {
  return activityBand(weeklyExerciseHours).factor
}

export type TdeeResult = {
  /** 基础代谢率，kcal/天 */
  bmrKcal: number
  /** 实际采用的活动系数 */
  activityFactor: number
  activityLabel: string
  /** 最终 TDEE，kJ（全库统一用 kJ 记能量） */
  tdeeKj: number
  tdeeKcal: number
  /** true = 公式估算出来的；false = 用户手动覆盖的 */
  isEstimated: boolean
}

/**
 * 算出最终 TDEE。
 *
 * @param input        身体数据。没填齐（null）时无法用公式估算
 * @param manualTdeeKj 手动覆盖值（用户输入的是 kcal 还是 kJ 由调用方换算好）
 * @returns 两者都没有时返回 null，UI 应提示用户去填资料
 */
export function calcTdee(input: TdeeInput | null, manualTdeeKj: number | null): TdeeResult | null {
  // 手动覆盖优先 —— 这是「TDEE 只作初始值」的实现点
  if (manualTdeeKj !== null && manualTdeeKj > 0) {
    return {
      bmrKcal: input ? round(calcBmrKcal(input), 0) : 0,
      activityFactor: input ? round(activityFactor(input.weeklyExerciseHours), 3) : 0,
      activityLabel: input ? activityBand(input.weeklyExerciseHours).label : '',
      tdeeKj: manualTdeeKj,
      tdeeKcal: round(manualTdeeKj / KJ_PER_KCAL, 0),
      isEstimated: false,
    }
  }

  if (!input) return null

  const bmrKcal = calcBmrKcal(input)
  const band = activityBand(input.weeklyExerciseHours)
  const tdeeKcal = bmrKcal * band.factor

  return {
    bmrKcal: round(bmrKcal, 0),
    activityFactor: band.factor,
    activityLabel: band.label,
    tdeeKj: round(tdeeKcal * KJ_PER_KCAL, 1),
    tdeeKcal: round(tdeeKcal, 0),
    isEstimated: true,
  }
}
