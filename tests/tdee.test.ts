import { describe, expect, it } from 'vitest'

import { activityBand, activityFactor, calcBmrKcal, calcTdee, type TdeeInput } from '@/lib/tdee'

const BASE: TdeeInput = {
  heightCm: 175,
  weightKg: 70,
  age: 30,
  gender: 'male',
  weeklyExerciseHours: 4,
}

describe('calcBmrKcal（Mifflin-St Jeor）', () => {
  it('男 70kg / 175cm / 30 岁 → 1648.75 kcal', () => {
    // 10×70 + 6.25×175 − 5×30 + 5 = 700 + 1093.75 − 150 + 5
    expect(calcBmrKcal({ heightCm: 175, weightKg: 70, age: 30, gender: 'male' })).toBe(1648.75)
  })

  it('同条件下女性比男性低 166 kcal（+5 与 −161 之差）', () => {
    const male = calcBmrKcal({ heightCm: 175, weightKg: 70, age: 30, gender: 'male' })
    const female = calcBmrKcal({ heightCm: 175, weightKg: 70, age: 30, gender: 'female' })
    expect(female).toBe(1482.75)
    expect(male - female).toBe(166)
  })

  it('体重每增加 1kg，BMR 增加 10 kcal', () => {
    const a = calcBmrKcal({ heightCm: 175, weightKg: 70, age: 30, gender: 'male' })
    const b = calcBmrKcal({ heightCm: 175, weightKg: 71, age: 30, gender: 'male' })
    expect(b - a).toBe(10)
  })
})

describe('activityBand 档位边界（区间取「下界含、上界含」）', () => {
  it.each([
    [0, 1.2, '久坐'],
    [1, 1.2, '久坐'],
    [1.1, 1.375, '轻度活动'],
    [3, 1.375, '轻度活动'],
    [3.1, 1.55, '中度活动'],
    [5, 1.55, '中度活动'],
    [5.1, 1.725, '高度活动'],
    [8, 1.725, '高度活动'],
    [8.1, 1.9, '极高强度'],
    [40, 1.9, '极高强度'],
  ])('每周运动 %s 小时 → 系数 %s（%s）', (hours, factor, label) => {
    const band = activityBand(hours as number)
    expect(band.factor).toBe(factor)
    expect(band.label).toBe(label)
  })

  it('负数或 NaN 按 0 处理，不抛异常', () => {
    expect(activityFactor(-5)).toBe(1.2)
    expect(activityFactor(Number.NaN)).toBe(1.2)
  })
})

describe('calcTdee 公式估算', () => {
  it('70kg / 175cm / 30 岁 / 男 / 每周 4 小时 → 系数 1.55，TDEE ≈ 10692.5 kJ', () => {
    const result = calcTdee(BASE, null)
    expect(result).not.toBeNull()
    expect(result!.bmrKcal).toBe(1649) // 1648.75 取整
    expect(result!.activityFactor).toBe(1.55)
    expect(result!.tdeeKcal).toBe(2556) // 1648.75 × 1.55 = 2555.5625
    expect(result!.tdeeKj).toBe(10692.5)
    expect(result!.isEstimated).toBe(true)
  })
})

describe('calcTdee 手动覆盖（TDEE 只作初始值）', () => {
  it('填了手动值就以手动值为准，并标记 isEstimated = false', () => {
    const result = calcTdee(BASE, 8000)
    expect(result!.tdeeKj).toBe(8000)
    expect(result!.isEstimated).toBe(false)
    // BMR 仍然算出来，方便界面上对照
    expect(result!.bmrKcal).toBe(1649)
  })

  it('连身体数据都没有、但有手动值时也能用', () => {
    const result = calcTdee(null, 8000)
    expect(result!.tdeeKj).toBe(8000)
    expect(result!.bmrKcal).toBe(0)
    expect(result!.isEstimated).toBe(false)
  })

  it('手动值清空（null）后回落到公式值', () => {
    expect(calcTdee(BASE, null)!.tdeeKj).toBe(10692.5)
  })

  it('手动值为 0 视为「没设」，不当作真正的 0 摄入', () => {
    const result = calcTdee(BASE, 0)
    expect(result!.isEstimated).toBe(true)
    expect(result!.tdeeKj).toBe(10692.5)
  })
})

describe('calcTdee 缺数据', () => {
  it('身体数据和手动值都没有 → null（UI 提示去填资料）', () => {
    expect(calcTdee(null, null)).toBeNull()
  })
})
