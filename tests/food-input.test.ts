import { describe, expect, it } from 'vitest'

import {
  isUuid,
  sanitizeSearchTerm,
  validateFoodForm,
  type FoodFormRaw,
} from '@/lib/food-input'

const VALID: FoodFormRaw = {
  name: '伊利纯牛奶',
  energyKj: '272',
  proteinG: '3.2',
  carbsG: '4.8',
  fatG: '3.6',
}

function withField(patch: Partial<FoodFormRaw>): FoodFormRaw {
  return { ...VALID, ...patch }
}

describe('validateFoodForm 校验', () => {
  it('正常输入通过，数值解析正确', () => {
    const result = validateFoodForm(VALID)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.values).toEqual({
      name: '伊利纯牛奶',
      energyKjPer100g: 272,
      proteinGPer100g: 3.2,
      carbsGPer100g: 4.8,
      fatGPer100g: 3.6,
    })
  })

  it('名称两端空格会被去掉', () => {
    const result = validateFoodForm(withField({ name: '  牛奶  ' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.values.name).toBe('牛奶')
  })

  it('名称只有空格视为没填', () => {
    const result = validateFoodForm(withField({ name: '   ' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.name).toBeTruthy()
  })

  it('热量必填 —— 留空要报错，不能静默当成 0', () => {
    const result = validateFoodForm(withField({ energyKj: '' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.energyKj).toBeTruthy()
  })

  it('热量填 0 是合法的（白开水就是 0）', () => {
    const result = validateFoodForm(withField({ energyKj: '0' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.values.energyKjPer100g).toBe(0)
  })

  it('热量为负数或超过上限要报错', () => {
    expect(validateFoodForm(withField({ energyKj: '-5' })).ok).toBe(false)
    expect(validateFoodForm(withField({ energyKj: '999999' })).ok).toBe(false)
  })

  it('三大营养素留空按 0 处理', () => {
    const result = validateFoodForm(withField({ proteinG: '', carbsG: '', fatG: '' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.values.proteinGPer100g).toBe(0)
    expect(result.values.carbsGPer100g).toBe(0)
    expect(result.values.fatGPer100g).toBe(0)
  })

  it('营养素填了但解析不出来要报错，不能当成 0', () => {
    const result = validateFoodForm(withField({ proteinG: 'abc' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.proteinG).toBeTruthy()
  })

  it('中文输入法的全角数字也能识别', () => {
    const result = validateFoodForm(withField({ energyKj: '１２３４' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.values.energyKjPer100g).toBe(1234)
  })

  it('多个字段同时错时，每个都报错（用户一次改完）', () => {
    const result = validateFoodForm({ name: '', energyKj: '', proteinG: 'x', carbsG: '', fatG: '' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.errors).sort()).toEqual(['energyKj', 'name', 'proteinG'])
  })
})

describe('sanitizeSearchTerm 搜索词清洗', () => {
  it('普通中文原样保留', () => {
    expect(sanitizeSearchTerm('牛奶')).toBe('牛奶')
  })

  // 下面这几条是这个函数存在的全部理由：ilike 不做转义，
  // % 和 _ 会被 SQL 当成通配符，搜出来的结果会「看着对、其实不对」
  it('LIKE 通配符 % 和 _ 被去掉，不能透传到 SQL', () => {
    expect(sanitizeSearchTerm('100%')).toBe('100')
    expect(sanitizeSearchTerm('a_b')).toBe('a b')
  })

  it('反斜杠（LIKE 转义符）被去掉', () => {
    expect(sanitizeSearchTerm('a\\b')).toBe('a b')
  })

  it('PostgREST 过滤语法的保留字符被去掉', () => {
    expect(sanitizeSearchTerm('牛奶,鸡蛋(大)')).toBe('牛奶 鸡蛋 大')
    expect(sanitizeSearchTerm('他说"好"')).toBe('他说 好')
  })

  it('连续空白塌缩成一个空格', () => {
    expect(sanitizeSearchTerm('  伊利   牛奶  ')).toBe('伊利 牛奶')
  })

  it('长度截断，防止超长搜索词拖慢查询', () => {
    expect(sanitizeSearchTerm('牛'.repeat(80), 50)).toHaveLength(50)
  })

  it('中间的点保留 —— 食物名里「3.2g 蛋白」这种很常见', () => {
    expect(sanitizeSearchTerm('3.2g')).toBe('3.2g')
  })

  it('只剩危险字符时返回空串，调用方据此当作「没搜索」', () => {
    expect(sanitizeSearchTerm('%%%')).toBe('')
    expect(sanitizeSearchTerm('   ')).toBe('')
  })
})

describe('isUuid', () => {
  it('接受标准 uuid（大小写都行）', () => {
    expect(isUuid('096b7d62-1a2b-4c3d-8e4f-5a6b7c8d9e0f')).toBe(true)
    expect(isUuid('096B7D62-1A2B-4C3D-8E4F-5A6B7C8D9E0F')).toBe(true)
  })

  it('拒绝手打的不合法 id —— 不校验会让 PostgREST 返回 400 导致页面 500', () => {
    expect(isUuid('abc')).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid('123')).toBe(false)
    expect(isUuid('096b7d62-1a2b-4c3d-8e4f-5a6b7c8d9e0g')).toBe(false)
    expect(isUuid("1' or '1'='1")).toBe(false)
  })
})
