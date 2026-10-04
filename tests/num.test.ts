import { describe, expect, it } from 'vitest'

import {
  normalizeNumericInput,
  parseInteger,
  parseNonNegativeNumber,
  parseNumberInput,
  parsePositiveNumber,
} from '@/lib/num'

describe('normalizeNumericInput 全角归一化', () => {
  it('全角数字转半角', () => {
    expect(normalizeNumericInput('１２３')).toBe('123')
  })

  it('全角句点和表意句号都当小数点', () => {
    expect(normalizeNumericInput('１２．５')).toBe('12.5')
    expect(normalizeNumericInput('12。5')).toBe('12.5')
  })

  it('去掉空白', () => {
    expect(normalizeNumericInput(' 1 2 ')).toBe('12')
  })
})

describe('parseNumberInput 逗号的两种含义', () => {
  it('逗号后 1 位 → 当小数点（0,5 = 0.5）', () => {
    expect(parseNumberInput('0,5')).toBe(0.5)
  })

  it('逗号后 2 位 → 当小数点（12,50 = 12.5）', () => {
    expect(parseNumberInput('12,50')).toBe(12.5)
  })

  it('逗号后 3 位 → 当千分位（1,234 = 1234，不是 1.234）', () => {
    expect(parseNumberInput('1,234')).toBe(1234)
  })

  it('已经有点了，逗号一律当千分位', () => {
    expect(parseNumberInput('1,234.5')).toBe(1234.5)
  })

  it('多个逗号 → 全是千分位', () => {
    expect(parseNumberInput('1,234,567')).toBe(1234567)
  })

  it('全角输入也能解析', () => {
    expect(parseNumberInput('１２．５')).toBe(12.5)
  })
})

describe('parseNumberInput 拒绝无效输入', () => {
  it.each(['', '   ', 'abc', '12abc', '.', '-', '-.', '1.2.3'])('%s → null', (input) => {
    expect(parseNumberInput(input)).toBeNull()
  })

  it('负数本身是合法数字（由 parsePositiveNumber 去挡）', () => {
    expect(parseNumberInput('-5')).toBe(-5)
  })
})

describe('parsePositiveNumber 表单校验', () => {
  it('正常值通过', () => {
    expect(parsePositiveNumber('150', 20000)).toBe(150)
    expect(parsePositiveNumber('0.1', 100)).toBe(0.1)
  })

  it('0 和负数不通过', () => {
    expect(parsePositiveNumber('0')).toBeNull()
    expect(parsePositiveNumber('-3')).toBeNull()
  })

  it('超过上限不通过（防手滑多打一个 0）', () => {
    expect(parsePositiveNumber('250000', 20000)).toBeNull()
  })
})

describe('parseNonNegativeNumber 允许 0 的字段（如热量缺口）', () => {
  it('0 通过', () => {
    expect(parseNonNegativeNumber('0', 12000)).toBe(0)
  })

  it('负数不通过', () => {
    expect(parseNonNegativeNumber('-1')).toBeNull()
  })
})

describe('parseInteger 取整字段', () => {
  it('小数四舍五入', () => {
    expect(parseInteger('3.5')).toBe(4)
    expect(parseInteger('3.4')).toBe(3)
  })

  it('负数不通过', () => {
    expect(parseInteger('-1')).toBeNull()
  })

  it('超上限不通过', () => {
    expect(parseInteger('200', 120)).toBeNull()
  })
})
