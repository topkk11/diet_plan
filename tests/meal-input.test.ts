import { describe, expect, it } from 'vitest'

import { LIMITS } from '@/lib/constants'
import { clampAmountG, MIN_AMOUNT_G, parseAmountG, stepAmountG, validateMealName } from '@/lib/meal-input'

describe('parseAmountG 克数解析', () => {
  it('正常数字', () => {
    expect(parseAmountG('250')).toEqual({ ok: true, grams: 250 })
  })

  it('小数', () => {
    expect(parseAmountG('12.5')).toEqual({ ok: true, grams: 12.5 })
  })

  it('空字符串报错而不是静默当 0', () => {
    expect(parseAmountG('').ok).toBe(false)
    expect(parseAmountG('   ').ok).toBe(false)
  })

  it('0 和负数都拒绝', () => {
    expect(parseAmountG('0').ok).toBe(false)
    expect(parseAmountG('-5').ok).toBe(false)
  })

  it('小于 1 克拒绝（界面上没有实际意义，多半是手滑）', () => {
    expect(parseAmountG('0.5').ok).toBe(false)
    expect(parseAmountG(String(MIN_AMOUNT_G))).toEqual({ ok: true, grams: MIN_AMOUNT_G })
  })

  it('乱码拒绝，不会被 parseFloat 宽松解析成 12', () => {
    expect(parseAmountG('12abc').ok).toBe(false)
    expect(parseAmountG('abc').ok).toBe(false)
  })

  it('全角数字（中文输入法常见）能正确解析', () => {
    expect(parseAmountG('２５０')).toEqual({ ok: true, grams: 250 })
  })

  it('逗号当千分位：1,234 → 1234', () => {
    expect(parseAmountG('1,234')).toEqual({ ok: true, grams: 1234 })
  })

  it('超过上限时**不**静默夹紧，而是报错', () => {
    expect(parseAmountG(String(LIMITS.amountG + 1)).ok).toBe(false)
    expect(parseAmountG(String(LIMITS.amountG))).toEqual({ ok: true, grams: LIMITS.amountG })
  })
})

describe('stepAmountG 步进', () => {
  it('正常加减', () => {
    expect(stepAmountG(100, 10)).toBe(110)
    expect(stepAmountG(100, -50)).toBe(50)
  })

  it('减到底停在最小值，不会变成 0 或负数', () => {
    expect(stepAmountG(5, -50)).toBe(MIN_AMOUNT_G)
    expect(stepAmountG(MIN_AMOUNT_G, -10)).toBe(MIN_AMOUNT_G)
  })

  it('加到顶停在上限', () => {
    expect(stepAmountG(LIMITS.amountG, 50)).toBe(LIMITS.amountG)
    expect(stepAmountG(LIMITS.amountG - 5, 10)).toBe(LIMITS.amountG)
  })
})

describe('clampAmountG 夹紧', () => {
  it('非法数字（NaN / Infinity）回落到最小值，而不是把 NaN 传下去', () => {
    expect(clampAmountG(Number.NaN)).toBe(MIN_AMOUNT_G)
    expect(clampAmountG(Number.POSITIVE_INFINITY)).toBe(MIN_AMOUNT_G)
  })

  it('正常范围原样返回，越界才夹', () => {
    expect(clampAmountG(250)).toBe(250)
    expect(clampAmountG(0)).toBe(MIN_AMOUNT_G)
    expect(clampAmountG(LIMITS.amountG + 1)).toBe(LIMITS.amountG)
  })
})

describe('validateMealName 餐次名', () => {
  it('正常名字', () => {
    expect(validateMealName('早餐')).toEqual({ ok: true, name: '早餐' })
  })

  it('两端空格去掉', () => {
    expect(validateMealName('  加餐  ')).toEqual({ ok: true, name: '加餐' })
  })

  it('中间连续空白折叠成一个空格', () => {
    expect(validateMealName('下午   加餐')).toEqual({ ok: true, name: '下午 加餐' })
  })

  it('空名和纯空白都报错', () => {
    expect(validateMealName('').ok).toBe(false)
    expect(validateMealName('   ').ok).toBe(false)
  })

  it('长度按数据库的 50 字上限卡（去掉首尾空格后再算）', () => {
    expect(validateMealName('x'.repeat(LIMITS.mealNameLength))).toEqual({
      ok: true,
      name: 'x'.repeat(LIMITS.mealNameLength),
    })
    expect(validateMealName('x'.repeat(LIMITS.mealNameLength + 1)).ok).toBe(false)
    // 首尾空格不该把人挤出上限
    expect(validateMealName(`  ${'x'.repeat(LIMITS.mealNameLength)}  `).ok).toBe(true)
  })
})
