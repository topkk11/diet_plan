import { describe, expect, it } from 'vitest'

import {
  computeEnergyBudget,
  kcalToKj,
  kjToKcal,
  macroEnergyKcal,
  per100gToAmount,
  round,
  sumNutrients,
  type Nutrients,
} from '@/lib/nutrition'
import { formatEnergyBoth } from '@/lib/format'

const RICE: Nutrients = { energyKj: 485, proteinG: 2.6, carbsG: 25.9, fatG: 0.3 }

describe('kJ ↔ kcal 换算', () => {
  it('1000 kJ ≈ 239 kcal', () => {
    expect(round(kjToKcal(1000), 0)).toBe(239)
    expect(round(kjToKcal(1000), 1)).toBe(239)
  })

  it('4.184 kJ 正好是 1 kcal', () => {
    expect(round(kjToKcal(4.184), 6)).toBe(1)
    expect(round(kcalToKj(1), 3)).toBe(4.184)
  })

  it('往返换算不丢精度', () => {
    expect(round(kjToKcal(kcalToKj(500)), 6)).toBe(500)
  })

  it('食品标签上的真实数字：1234 kJ/100g → 295 kcal', () => {
    expect(round(kjToKcal(1234), 0)).toBe(295)
  })
})

describe('per100gToAmount 按克数折算', () => {
  it('100g 原样返回', () => {
    expect(per100gToAmount(RICE, 100)).toEqual(RICE)
  })

  it('250g 是 2.5 倍', () => {
    expect(per100gToAmount(RICE, 250)).toEqual({
      energyKj: 1212.5,
      proteinG: 6.5,
      carbsG: 64.75,
      fatG: 0.75,
    })
  })

  it('150g 米饭：485 × 1.5 = 727.5 kJ', () => {
    const result = per100gToAmount(RICE, 150)
    expect(result.energyKj).toBe(727.5)
    expect(result.proteinG).toBe(3.9)
    expect(result.carbsG).toBe(38.85)
    expect(result.fatG).toBe(0.45)
  })

  it('克数为 0 或非法时归零，不返回 NaN', () => {
    expect(per100gToAmount(RICE, 0).energyKj).toBe(0)
    expect(per100gToAmount(RICE, Number.NaN).energyKj).toBe(0)
    expect(per100gToAmount(RICE, -50).energyKj).toBe(0)
  })
})

describe('sumNutrients 整数域累加（消除浮点漂移）', () => {
  it('0.1 + 0.1 + 0.1 精确等于 0.3', () => {
    const one: Nutrients = { energyKj: 0.1, proteinG: 0.1, carbsG: 0.1, fatG: 0.1 }
    const sum = sumNutrients([one, one, one])
    // 直接相加会得到 0.30000000000000004
    expect(sum.energyKj).toBe(0.3)
    expect(sum.proteinG).toBe(0.3)
  })

  it('大量条目累加不产生可见漂移', () => {
    const item: Nutrients = { energyKj: 485.5, proteinG: 2.63, carbsG: 25.91, fatG: 0.34 }
    const sum = sumNutrients(Array.from({ length: 100 }, () => item))
    expect(sum.energyKj).toBe(48550)
    expect(sum.proteinG).toBe(263)
    expect(sum.carbsG).toBe(2591)
    expect(sum.fatG).toBe(34)
  })

  it('空数组归零', () => {
    expect(sumNutrients([])).toEqual({ energyKj: 0, proteinG: 0, carbsG: 0, fatG: 0 })
  })
})

describe('macroEnergyKcal 三大营养素的热量贡献', () => {
  it('蛋白质 4、碳水 4、脂肪 9 kcal/g', () => {
    const n: Nutrients = { energyKj: 0, proteinG: 10, carbsG: 20, fatG: 5 }
    expect(macroEnergyKcal(n)).toEqual({ protein: 40, carbs: 80, fat: 45 })
  })
})

describe('computeEnergyBudget 热量预算', () => {
  it('还有余量时为正值，isOver 为 false', () => {
    const budget = computeEnergyBudget(10000, 2000, 5000)
    expect(budget.targetIntakeKj).toBe(8000)
    expect(budget.remainingKj).toBe(3000)
    expect(budget.isOver).toBe(false)
  })

  it('刚好等于目标时剩余为 0，不算超标', () => {
    const budget = computeEnergyBudget(10000, 2000, 8000)
    expect(budget.remainingKj).toBe(0)
    expect(budget.isOver).toBe(false)
  })

  it('超标时剩余为负、isOver 为 true（UI 要转红）', () => {
    const budget = computeEnergyBudget(10000, 2000, 9000)
    expect(budget.remainingKj).toBe(-1000)
    expect(budget.isOver).toBe(true)
  })

  it('没设缺口时目标摄入等于 TDEE', () => {
    const budget = computeEnergyBudget(9000, 0, 3000)
    expect(budget.targetIntakeKj).toBe(9000)
    expect(budget.remainingKj).toBe(6000)
  })
})

describe('round 边界处理', () => {
  it('0.1 + 0.2 取整后是 0.3', () => {
    expect(round(0.1 + 0.2, 1)).toBe(0.3)
  })

  it('NaN / Infinity 一律归零，避免 NaN 传染整个汇总', () => {
    expect(round(Number.NaN)).toBe(0)
    expect(round(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('负数按绝对值四舍五入：|round(x)| === round(|x|)', () => {
    // 内建 Math.round 对 .5 一律往 +∞ 靠，会把 -9307.5 变成 -9307、+9307.5 变成 9308，
    // 汇总卡上「已超出 9,308」和「目标摄入 -9,307」挨着显示时看着像算错了
    expect(round(-9307.5, 0)).toBe(-9308)
    expect(Math.abs(round(-9307.5, 0))).toBe(round(9307.5, 0))
    expect(round(-0.25, 1)).toBe(-0.3)
    expect(round(0, 2)).toBe(0)
  })
})

describe('formatEnergyBoth 同时给出两个单位', () => {
  it('485 kJ → "485 kJ (116 kcal)"', () => {
    expect(formatEnergyBoth(485)).toBe('485 kJ (116 kcal)')
  })

  it('大数字带千分位', () => {
    expect(formatEnergyBoth(10692.5)).toBe('10,693 kJ (2,556 kcal)')
  })
})
