import { describe, expect, it } from 'vitest'

import {
  budgetWarning,
  EMPTY_PROFILE_FORM,
  parseProfileValues,
  profileToRaw,
  PROFILE_RANGES,
  readProfileForm,
  toTdeeInput,
  validateProfileForm,
  type ProfileFormRaw,
} from '@/lib/profile-input'

/** 一份填好的表，只改需要动的那一格 */
function form(overrides: Partial<ProfileFormRaw> = {}): ProfileFormRaw {
  return { ...EMPTY_PROFILE_FORM, heightCm: '175', weightKg: '70', age: '30', gender: 'male', ...overrides }
}

function valuesOf(overrides: Partial<ProfileFormRaw> = {}) {
  const result = validateProfileForm(form(overrides))
  if (!result.ok) throw new Error(`预期通过，实际报错：${JSON.stringify(result.errors)}`)
  return result.values
}

describe('validateProfileForm 资料表单', () => {
  it('一张空表是合法的：身体数据允许先不填', () => {
    const result = validateProfileForm(EMPTY_PROFILE_FORM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.values).toEqual({
      heightCm: null,
      weightKg: null,
      age: null,
      gender: null,
      weeklyExerciseHours: 0,
      manualTdeeKj: null,
      deficitKj: 0,
    })
  })

  it('正常一组数据原样通过', () => {
    expect(valuesOf()).toMatchObject({
      heightCm: 175,
      weightKg: 70,
      age: 30,
      gender: 'male',
      weeklyExerciseHours: 0,
      manualTdeeKj: null,
      deficitKj: 0,
    })
  })

  it('边界值取两端（与数据库 check 约束一致）', () => {
    const { heightCm, weightKg, age, weeklyExerciseHours, deficitKj, deficitKcal } = PROFILE_RANGES
    expect(
      valuesOf({
        heightCm: String(heightCm.min),
        weightKg: String(weightKg.min),
        age: String(age.min),
        weeklyExerciseHours: String(weeklyExerciseHours.min),
        deficitKcal: String(deficitKcal.min),
      }),
    ).toMatchObject({
      heightCm: heightCm.min,
      weightKg: weightKg.min,
      age: age.min,
      weeklyExerciseHours: weeklyExerciseHours.min,
      deficitKj: deficitKj.min,
    })

    const maxed = valuesOf({
      heightCm: String(heightCm.max),
      weightKg: String(weightKg.max),
      age: String(age.max),
      weeklyExerciseHours: String(weeklyExerciseHours.max),
      deficitKcal: String(deficitKcal.max),
    })
    expect(maxed).toMatchObject({
      heightCm: heightCm.max,
      weeklyExerciseHours: weeklyExerciseHours.max,
    })
    // kcal 的上界换算回 kJ 之后必须仍然落在数据库的 check 之内 ——
    // 这正是 deficitKcal 的上限由 kJ 推出来、而不是手写一个 12000 的原因
    expect(maxed.deficitKj).toBeLessThanOrEqual(deficitKj.max)
  })

  it('越过边界的数字报错，而且不会把越界值当成"没填"偷偷存下去', () => {
    const tooShort = validateProfileForm(form({ heightCm: '49' }))
    expect(tooShort.ok).toBe(false)
    if (tooShort.ok) return
    expect(tooShort.errors.heightCm).toContain('50')

    expect(validateProfileForm(form({ age: '9' })).ok).toBe(false)
    expect(validateProfileForm(form({ weightKg: '401' })).ok).toBe(false)
    expect(validateProfileForm(form({ weeklyExerciseHours: '81' })).ok).toBe(false)
    expect(validateProfileForm(form({ deficitKcal: '11951' })).ok).toBe(false)
  })

  it('乱码和负数都报错（负数不会被当成"小于下限所以留空"）', () => {
    expect(validateProfileForm(form({ heightCm: 'abc' })).ok).toBe(false)
    expect(validateProfileForm(form({ heightCm: '-175' })).ok).toBe(false)
    expect(validateProfileForm(form({ weightKg: '70kg' })).ok).toBe(false)
  })

  it('多个字段同时错的时候，错误是逐格给的', () => {
    const result = validateProfileForm(form({ heightCm: 'x', age: '5', gender: 'other' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.errors).sort()).toEqual(['age', 'gender', 'heightCm'])
  })

  it('年龄是整数：顺手打了 30.6 会四舍五入成 31', () => {
    expect(valuesOf({ age: '30.6' }).age).toBe(31)
  })

  it('身高体重按数据库的 numeric(_,1) 取整，不把长尾小数带进库', () => {
    expect(valuesOf({ heightCm: '175.44', weightKg: '70.46' }).heightCm).toBe(175.4)
    expect(valuesOf({ heightCm: '175.44', weightKg: '70.46' }).weightKg).toBe(70.5)
  })

  it('全角数字（中文输入法常见）能正确解析', () => {
    expect(valuesOf({ heightCm: '１７５', age: '３０' })).toMatchObject({
      heightCm: 175,
      age: 30,
    })
  })

  it('逗号当千分位：1,234 kcal 的缺口 → 1234 kcal，存库 5163.06 kJ', () => {
    expect(valuesOf({ deficitKcal: '1,234' }).deficitKj).toBe(5163.06)
  })

  it('性别只能是 male / female / 留空', () => {
    expect(valuesOf({ gender: '' }).gender).toBeNull()
    expect(valuesOf({ gender: 'female' }).gender).toBe('female')
    expect(validateProfileForm(form({ gender: 'MALE' })).ok).toBe(false)
  })

  it('每周运动时长留空按 0 算，不报错（"不运动"和"没填"在这里是同一件事）', () => {
    expect(valuesOf({ weeklyExerciseHours: '' }).weeklyExerciseHours).toBe(0)
  })

  it('手动 TDEE：留空是 null，填 0 也归一成 null（0 kJ 的 TDEE 没有意义）', () => {
    expect(valuesOf({ manualTdeeKj: '' }).manualTdeeKj).toBeNull()
    expect(valuesOf({ manualTdeeKj: '0' }).manualTdeeKj).toBeNull()
    expect(valuesOf({ manualTdeeKj: '10693' }).manualTdeeKj).toBe(10693)
  })

  it('热量缺口留空是 0 而不是 null —— 数据库那列 not null', () => {
    expect(valuesOf({ deficitKcal: '' }).deficitKj).toBe(0)
  })

  it('缺口在输入框里填的是 kcal，存进库里的仍然是 kJ', () => {
    expect(PROFILE_RANGES.deficitKcal.max).toBe(11950)
    expect(valuesOf({ deficitKcal: '500' }).deficitKj).toBe(2092)
    expect(valuesOf({ deficitKcal: '0' }).deficitKj).toBe(0)
  })

  it('整数 kcal 是换算的不动点：反复打开再保存，数字不会一点点漂走', () => {
    for (const kcal of [0, 1, 300, 500, 999, 11950]) {
      const kj = valuesOf({ deficitKcal: String(kcal) }).deficitKj
      expect(profileToRaw({ ...valuesOf(), deficitKj: kj }).deficitKcal).toBe(String(kcal))
    }
  })
})

describe('parseProfileValues 宽松解析（给边打边算用）', () => {
  it('越界的输入不会抛错，只是当成没填', () => {
    const values = parseProfileValues(form({ heightCm: '17' }))
    expect(values.heightCm).toBeNull()
    expect(values.weightKg).toBe(70) // 其他格不受影响
  })

  it('打了一半的字符串不影响别的字段', () => {
    const values = parseProfileValues({ ...EMPTY_PROFILE_FORM, age: '', deficitKcal: '50' })
    expect(values.age).toBeNull()
    expect(values.deficitKj).toBe(209.2)
  })
})

describe('readProfileForm 从 FormData 取值', () => {
  it('缺失的字段当空字符串，不会拿到 null', () => {
    const fd = new FormData()
    fd.set('heightCm', '175')
    fd.set('gender', 'male')
    expect(readProfileForm(fd)).toEqual({
      heightCm: '175',
      weightKg: '',
      age: '',
      gender: 'male',
      weeklyExerciseHours: '',
      manualTdeeKj: '',
      deficitKcal: '',
    })
  })
})

describe('profileToRaw 与 validateProfileForm 往返', () => {
  it('存下去再读回来，表单内容一致', () => {
    const original = form({
      heightCm: '175.4',
      weightKg: '70.5',
      gender: 'female',
      weeklyExerciseHours: '4',
      manualTdeeKj: '10000',
      deficitKcal: '500',
    })
    const roundTripped = profileToRaw(valuesOf(original))
    expect(roundTripped).toEqual(original)
  })

  it('没有资料行时给一张空表', () => {
    expect(profileToRaw(null)).toEqual(EMPTY_PROFILE_FORM)
  })
})

describe('toTdeeInput 身体数据齐全才够得着公式', () => {
  it('填齐了返回输入对象', () => {
    expect(toTdeeInput(valuesOf({ weeklyExerciseHours: '4' }))).toEqual({
      heightCm: 175,
      weightKg: 70,
      age: 30,
      gender: 'male',
      weeklyExerciseHours: 4,
    })
  })

  it('缺任何一项都返回 null，而不是拿一个残缺的输入去算', () => {
    expect(toTdeeInput(valuesOf({ heightCm: '' }))).toBeNull()
    expect(toTdeeInput(valuesOf({ weightKg: '' }))).toBeNull()
    expect(toTdeeInput(valuesOf({ age: '' }))).toBeNull()
    expect(toTdeeInput(valuesOf({ gender: '' }))).toBeNull()
  })

  it('只有运动时长为 0 不算缺项（0 小时是合法的"久坐"）', () => {
    const input = toTdeeInput(valuesOf({ weeklyExerciseHours: '' }))
    expect(input?.weeklyExerciseHours).toBe(0)
  })
})

describe('budgetWarning 缺口比 TDEE 还大', () => {
  it('缺口小于 TDEE 时没有警告', () => {
    expect(budgetWarning(2000, 10000)).toBeNull()
    expect(budgetWarning(0, 10000)).toBeNull()
  })

  it('缺口大于 TDEE 时出警告（目标摄入会变成负数）', () => {
    const warning = budgetWarning(12000, 10000)
    expect(warning).toContain('负数')
    // 提示里把缺口换算成 kcal 说出来 —— 多打一位的错误光看 kJ 不觉得荒谬
    expect(warning).toContain('2868 kcal')
  })

  it('不知道 TDEE 时不给警告 —— 那不是用户的错，是资料还没填', () => {
    expect(budgetWarning(12000, null)).toBeNull()
    expect(budgetWarning(12000, 0)).toBeNull()
  })
})
