/**
 * 热量与营养素的纯计算。**全站所有汇总数字的唯一来源**，不要在组件里另写算式。
 *
 * 单位约定（重要，改动前先读这段）：
 * - 数据库和内存中的能量一律以 **kJ** 为唯一真相，因为用户输入的就是 kJ（粒度更细、无损）
 * - kcal 只在显示层由 kJ 派生（见 lib/format.ts），这样两个数字永远自洽，
 *   不会出现「卡片写 1195 kcal，条目加起来 1194」这种对不上的情况
 * - 营养素的累加用整数缩放（×1000）做，避免 0.1 + 0.2 = 0.30000000000000004 的漂移
 */

/** 1 kcal = 4.184 kJ（热化学卡路里） */
export const KJ_PER_KCAL = 4.184

/** 内部整数缩放因子，代表保留 3 位小数精度 */
const SCALE = 1000

/** 一份食物的热量与三大营养素（能量单位恒为 kJ） */
export type Nutrients = {
  energyKj: number
  proteinG: number
  carbsG: number
  fatG: number
}

export const ZERO_NUTRIENTS: Nutrients = {
  energyKj: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
}

export function kjToKcal(kj: number): number {
  return kj / KJ_PER_KCAL
}

export function kcalToKj(kcal: number): number {
  return kcal * KJ_PER_KCAL
}

/**
 * 四舍五入到指定小数位。非有限数（NaN / Infinity）统一当 0 处理。
 *
 * **负数按绝对值四舍五入**（-0.5 → -1，而不是 Math.round 默认的 -0）。
 * 理由：汇总卡上「已超出 X kJ」和「目标摄入 -X kJ」是挨着显示的两个数，
 * 用内建的 Math.round 时 -9307.5 会变成 -9307、+9307.5 会变成 9308，
 * 同一个量级在屏幕上差 1，看着像算错了。这样写能保证 |round(x)| === round(|x|)。
 */
export function round(value: number, digits = 1): number {
  if (!Number.isFinite(value)) return 0
  const shift = 10 ** digits
  return (Math.sign(value) * Math.round(Math.abs(value) * shift)) / shift
}

const toInt = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * SCALE)
const fromInt = (n: number): number => n / SCALE

/**
 * 把「每 100g」的营养值折算到实际吃下的克数。
 * 100g 时原样返回；250g 时是 2.5 倍。
 */
export function per100gToAmount(per100g: Nutrients, amountG: number): Nutrients {
  const grams = Number.isFinite(amountG) && amountG > 0 ? amountG : 0
  return {
    energyKj: fromInt(Math.round((toInt(per100g.energyKj) * grams) / 100)),
    proteinG: fromInt(Math.round((toInt(per100g.proteinG) * grams) / 100)),
    carbsG: fromInt(Math.round((toInt(per100g.carbsG) * grams) / 100)),
    fatG: fromInt(Math.round((toInt(per100g.fatG) * grams) / 100)),
  }
}

/** 在整数域累加，最后一次除回来 —— 消除浮点累加漂移 */
export function sumNutrients(list: readonly Nutrients[]): Nutrients {
  let kj = 0
  let protein = 0
  let carbs = 0
  let fat = 0
  for (const n of list) {
    kj += toInt(n.energyKj)
    protein += toInt(n.proteinG)
    carbs += toInt(n.carbsG)
    fat += toInt(n.fatG)
  }
  return {
    energyKj: fromInt(kj),
    proteinG: fromInt(protein),
    carbsG: fromInt(carbs),
    fatG: fromInt(fat),
  }
}

/** 展示前统一取整（组件渲染时用，不要在中间计算里调用） */
export function roundNutrients(n: Nutrients, digits = 1): Nutrients {
  return {
    energyKj: round(n.energyKj, digits),
    proteinG: round(n.proteinG, digits),
    carbsG: round(n.carbsG, digits),
    fatG: round(n.fatG, digits),
  }
}

/**
 * 三大营养素各自贡献了多少热量（蛋白质 4、碳水 4、脂肪 9 kcal/g）。
 * 给 MacroBar 画占比条用。返回 kcal。
 */
export function macroEnergyKcal(n: Nutrients): { protein: number; carbs: number; fat: number } {
  return {
    protein: n.proteinG * 4,
    carbs: n.carbsG * 4,
    fat: n.fatG * 9,
  }
}

/**
 * 首页顶部那张卡片的数据：TDEE / 缺口 / 目标摄入 / 已摄入 / 剩余。
 * 全部以 kJ 进、以 kJ 出，UI 层再决定显示 kJ 还是 kcal。
 */
export type EnergyBudget = {
  /** 每日总消耗 */
  tdeeKj: number
  /** 设定的热量缺口 */
  deficitKj: number
  /** 目标摄入 = TDEE − 缺口 */
  targetIntakeKj: number
  /** 今天已经吃进去的 */
  consumedKj: number
  /** 还能吃多少 = 目标摄入 − 已摄入（超标时为负） */
  remainingKj: number
  /** 是否已超标 */
  isOver: boolean
}

export function computeEnergyBudget(
  tdeeKj: number,
  deficitKj: number,
  consumedKj: number,
): EnergyBudget {
  const tdee = toInt(tdeeKj)
  const deficit = toInt(deficitKj)
  const consumed = toInt(consumedKj)
  const target = tdee - deficit
  const remaining = target - consumed
  return {
    tdeeKj: fromInt(tdee),
    deficitKj: fromInt(deficit),
    targetIntakeKj: fromInt(target),
    consumedKj: fromInt(consumed),
    remainingKj: fromInt(remaining),
    isOver: remaining < 0,
  }
}
