import { describe, expect, it } from 'vitest'

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  parseBackup,
  toBackupFile,
} from '@/lib/backup'
import type { FoodRow, MealItemRow, MealRow, ProfileRow } from '@/lib/types'

const FOOD_ID = '11111111-1111-4111-8111-111111111111'
const FOOD_ID_2 = '11111111-1111-4111-8111-222222222222'
const MEAL_ID = '22222222-2222-4222-8222-222222222222'
const ITEM_ID = '33333333-3333-4333-8333-333333333333'
const CREATED = '2026-10-04T08:00:00.123456+00:00'

function profile(overrides: Record<string, unknown> = {}) {
  return {
    heightCm: 175,
    weightKg: 70,
    age: 30,
    gender: 'male',
    weeklyExerciseHours: 3,
    manualTdeeKj: null,
    deficitKj: 2000,
    timezone: 'Asia/Shanghai',
    ...overrides,
  }
}

function food(overrides: Record<string, unknown> = {}) {
  return {
    id: FOOD_ID,
    name: '牛奶',
    energyKjPer100g: 272,
    proteinGPer100g: 3.3,
    carbsGPer100g: 4.9,
    fatGPer100g: 3.6,
    archivedAt: null,
    createdAt: CREATED,
    ...overrides,
  }
}

function meal(overrides: Record<string, unknown> = {}) {
  return {
    id: MEAL_ID,
    date: '2026-10-04',
    name: '早餐',
    sortOrder: 0,
    createdAt: CREATED,
    ...overrides,
  }
}

function mealItem(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    mealId: MEAL_ID,
    foodId: FOOD_ID,
    amountG: 250,
    createdAt: CREATED,
    ...overrides,
  }
}

/** 一份完全合法的备份文件（unknown，方便逐个字段改坏） */
function file(overrides: Record<string, unknown> = {}): unknown {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: '2026-10-05T00:00:00.000Z',
    profile: profile(),
    foods: [food()],
    meals: [meal()],
    mealItems: [mealItem()],
    ...overrides,
  }
}

/** 断言校验失败，并返回错误信息（用来检查它有没有指出是哪个字段） */
function errorOf(raw: unknown): string {
  const result = parseBackup(raw)
  if (result.ok) throw new Error('本该校验失败，却通过了')
  return result.message
}

describe('parseBackup 接受合法的备份文件', () => {
  it('一份完整文件能通过，并且字段原样保留', () => {
    const result = parseBackup(file())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.foods[0].name).toBe('牛奶')
    expect(result.file.foods[0].energyKjPer100g).toBe(272)
    expect(result.file.mealItems[0].amountG).toBe(250)
    expect(result.file.profile?.gender).toBe('male')
  })

  it('空数据也是合法的（等于「恢复成一张白纸」）', () => {
    const result = parseBackup(
      file({ profile: null, foods: [], meals: [], mealItems: [] }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.profile).toBeNull()
    expect(result.file.meals).toEqual([])
  })

  it('身体数据留空（null）合法', () => {
    const result = parseBackup(
      file({ profile: profile({ heightCm: null, weightKg: null, age: null, gender: null, manualTdeeKj: null }) }),
    )
    expect(result.ok).toBe(true)
  })

  it('边界值取两端都收：身高 50/260、年龄 10/120、缺口 50000、克数 20000', () => {
    const low = parseBackup(
      file({
        profile: profile({ heightCm: 50, weightKg: 20, age: 10, weeklyExerciseHours: 0, deficitKj: 0 }),
        mealItems: [mealItem({ amountG: 0.01 })],
      }),
    )
    const high = parseBackup(
      file({
        profile: profile({ heightCm: 260, weightKg: 400, age: 120, weeklyExerciseHours: 80, deficitKj: 50000 }),
        foods: [food({ energyKjPer100g: 200000, proteinGPer100g: 1000 })],
        mealItems: [mealItem({ amountG: 20000 })],
      }),
    )
    expect(low.ok).toBe(true)
    expect(high.ok).toBe(true)
  })

  it('名称首尾的空格会被去掉（数据库的 check 也是按 btrim 算的）', () => {
    const result = parseBackup(file({ foods: [food({ name: '  牛奶  ' })] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.foods[0].name).toBe('牛奶')
  })
})

describe('parseBackup 拒绝被改坏的文件', () => {
  it('format 不对时给出可读的提示', () => {
    expect(errorOf(file({ format: 'something-else' }))).toContain('不像是本站导出的备份文件')
  })

  it('版本号不对时提示版本', () => {
    expect(errorOf(file({ version: 2 }))).toContain('版本')
  })

  it('顶层不是对象 / 数组字段不是数组', () => {
    expect(errorOf('这不是 JSON')).toContain('应该是一个对象')
    expect(errorOf(file({ foods: '牛奶' }))).toContain('foods 应该是一个数组')
  })

  it('错误信息里带着出错的位置，方便手工修文件', () => {
    const message = errorOf(file({ foods: [food(), food({ name: '' })] }))
    expect(message).toContain('foods[1].name')
  })

  it('身高越界 / 体重越界 / 年龄不是整数', () => {
    expect(errorOf(file({ profile: profile({ heightCm: 300 }) }))).toContain('profile.heightCm')
    expect(errorOf(file({ profile: profile({ weightKg: 10 }) }))).toContain('profile.weightKg')
    expect(errorOf(file({ profile: profile({ age: 30.5 }) }))).toContain('应该是整数')
  })

  it('性别只认 male / female', () => {
    expect(errorOf(file({ profile: profile({ gender: '男' }) }))).toContain('profile.gender')
  })

  it('负数热量、超上限的营养素都拒绝', () => {
    expect(errorOf(file({ foods: [food({ energyKjPer100g: -1 })] }))).toContain('energyKjPer100g')
    expect(errorOf(file({ foods: [food({ proteinGPer100g: 1001 })] }))).toContain('proteinGPer100g')
  })

  it('克数为 0、负数或超上限都拒绝', () => {
    expect(errorOf(file({ mealItems: [mealItem({ amountG: 0 })] }))).toContain('必须大于 0')
    expect(errorOf(file({ mealItems: [mealItem({ amountG: -5 })] }))).toContain('amountG')
    expect(errorOf(file({ mealItems: [mealItem({ amountG: 20001 })] }))).toContain('amountG')
  })

  it('数字写成字符串也拒绝 —— 这个文件是我们自己导出的，类型必须严格', () => {
    expect(errorOf(file({ mealItems: [mealItem({ amountG: '250' })] }))).toContain('应该是数字')
  })

  it('日期必须是真实存在的 YYYY-MM-DD', () => {
    expect(errorOf(file({ meals: [meal({ date: '2026/10/04' })] }))).toContain('YYYY-MM-DD')
    expect(errorOf(file({ meals: [meal({ date: '2026-02-30' })] }))).toContain('YYYY-MM-DD')
  })

  it('时间戳解析不出来时拒绝', () => {
    expect(errorOf(file({ foods: [food({ createdAt: '昨天' })] }))).toContain('createdAt')
    expect(errorOf(file({ exportedAt: '' }))).toContain('exportedAt')
  })

  it('id 不是 UUID 时拒绝', () => {
    expect(errorOf(file({ foods: [food({ id: 'not-a-uuid' })] }))).toContain('不是合法的 id')
  })
})

describe('parseBackup 检查文件内部的自洽性', () => {
  it('条目指向文件里不存在的餐次时拒绝，并指出是第几条', () => {
    const message = errorOf(file({ mealItems: [mealItem({ mealId: FOOD_ID_2 })] }))
    expect(message).toContain('mealItems[0]')
    expect(message).toContain('餐次')
  })

  it('条目指向文件里不存在的食物时拒绝', () => {
    const message = errorOf(file({ mealItems: [mealItem({ foodId: FOOD_ID_2 })] }))
    expect(message).toContain('mealItems[0]')
    expect(message).toContain('食物')
  })

  it('同一个数组里出现重复 id 时拒绝（会撞主键）', () => {
    expect(errorOf(file({ foods: [food(), food()] }))).toContain('两个相同的 id')
    expect(errorOf(file({ mealItems: [mealItem(), mealItem()] }))).toContain('两个相同的 id')
  })
})

/**
 * 把字符串当成 number 用。
 *
 * PostgREST 返回 numeric 列时可能是字符串，而 lib/types.ts 把它们简化成了 number。
 * 这里**故意**按字符串造数据 —— 那是更难处理的一种，正好验证 toBackupFile 里的
 * asNumber 真的兜住了。cast 只出现在这几个字段上，是为了不把整个测试对象放宽成 any。
 */
const wireNumeric = (value: string): number => value as unknown as number

describe('toBackupFile → parseBackup 往返', () => {
  const profileRow: ProfileRow = {
    id: '44444444-4444-4444-8444-444444444444',
    user_id: '55555555-5555-4555-8555-555555555555',
    height_cm: 175,
    weight_kg: 70.5,
    age: 30,
    gender: 'male',
    weekly_exercise_hours: 3.5,
    manual_tdee_kj: wireNumeric('10460.00'),
    calorie_deficit_kj: 2000,
    timezone: 'Asia/Shanghai',
    created_at: CREATED,
    updated_at: CREATED,
  }

  const foodRow: FoodRow = {
    id: FOOD_ID,
    user_id: '55555555-5555-4555-8555-555555555555',
    name: '牛奶',
    calories_kj_per_100g: wireNumeric('272.00'),
    protein_g_per_100g: 3.3,
    carbs_g_per_100g: 4.9,
    fat_g_per_100g: 3.6,
    archived_at: null,
    created_at: CREATED,
    updated_at: CREATED,
  }

  const mealRow: MealRow = {
    id: MEAL_ID,
    user_id: '55555555-5555-4555-8555-555555555555',
    date: '2026-10-04',
    name: '早餐',
    sort_order: 0,
    created_at: CREATED,
  }

  const itemRow: MealItemRow = {
    id: ITEM_ID,
    user_id: '55555555-5555-4555-8555-555555555555',
    meal_id: MEAL_ID,
    food_id: FOOD_ID,
    amount_g: wireNumeric('250.00'),
    created_at: CREATED,
  }

  it('自己导出的文件一定能被自己读回来（这是最基本的一条）', () => {
    const exported = toBackupFile(profileRow, [foodRow], [mealRow], [itemRow])
    const result = parseBackup(JSON.parse(JSON.stringify(exported)))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file).toEqual(exported)
  })

  it('numeric 列是字符串时也能正确转成数字', () => {
    const exported = toBackupFile(profileRow, [foodRow], [mealRow], [itemRow])
    expect(exported.foods[0].energyKjPer100g).toBe(272)
    expect(exported.mealItems[0].amountG).toBe(250)
    expect(exported.profile?.manualTdeeKj).toBe(10460)
    expect(exported.profile?.weeklyExerciseHours).toBe(3.5)
  })

  it('没设过资料时 profile 是 null，不是空对象', () => {
    expect(toBackupFile(null, [], [], []).profile).toBeNull()
  })

  it('时间戳带微秒也不丢精度 —— 丢了会改变同一餐里条目的先后顺序', () => {
    const exported = toBackupFile(profileRow, [foodRow], [mealRow], [itemRow])
    expect(exported.foods[0].createdAt).toBe(CREATED)
    const result = parseBackup(exported)
    expect(result.ok && result.file.foods[0].createdAt).toBe(CREATED)
  })

  it('输入顺序不影响输出 —— 同一份数据导出两次完全一样', () => {
    const foodB = { ...foodRow, id: FOOD_ID_2, name: '苹果' }
    const order1 = toBackupFile(profileRow, [foodRow, foodB], [mealRow], [], 'X')
    const order2 = toBackupFile(profileRow, [foodB, foodRow], [mealRow], [], 'X')
    expect(order1).toEqual(order2)
    // 码点序（牛 U+725B < 苹 U+82F9），不是拼音序 —— 见 lib/backup.ts 里 compareText 的注释
    expect(order1.foods.map((f) => f.name)).toEqual(['牛奶', '苹果'])
  })

  it('导出的 JSON 能被 JSON.stringify 正常序列化（能存成文件）', () => {
    const exported = toBackupFile(profileRow, [foodRow], [mealRow], [itemRow])
    expect(() => JSON.stringify(exported, null, 2)).not.toThrow()
  })
})

describe('backupFileName', () => {
  it('文件名带日期，方便在手机里分辨是哪一天的备份', () => {
    expect(backupFileName(new Date('2026-10-05T12:00:00Z'))).toBe('饮食计划备份-2026-10-05.json')
  })
})
