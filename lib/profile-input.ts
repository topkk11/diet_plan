/**
 * 资料表单的解析与校验（纯函数，可被 vitest 直接测）。
 *
 * 为什么单独一个文件：Server Action 文件带 'use server'，里面只能导出 async 函数，
 * 纯逻辑放进去就测不了。所以校验放这里，actions/profile.ts 只管读写数据库。
 *
 * ⚠️ 单位：`ProfileFormValues` 里所有的能量数字**都是 kJ**，和数据库的列名一致
 * （`calorie_deficit_kj`、`manual_tdee_kj`）。唯一的例外是 `ProfileFormRaw` ——
 * 那是用户在输入框里看到的字符串，**热量缺口那一格是 kcal**。
 *
 * 为什么只有缺口用 kcal：食物热量是照抄食品标签的，标签上印的就是 kJ，那边原样输
 * kJ 最省事。但缺口是**我们自己定的目标**，没有标签可抄；而 BMR/TDEE 是
 * Mifflin-St Jeor 算出来的、本来就是 kcal 口径，「每天少吃 500 大卡」也是通行说法。
 * 让人在这里心算 ÷4.184 是白添的负担。
 *
 * 换算只发生在 `parseAll` 和 `profileToRaw` 两个地方，进出都是 kJ。
 */

import { parseInteger, parseNumberInput } from '@/lib/num'
import { kcalToKj, kjToKcal, round } from '@/lib/nutrition'
import type { Gender, TdeeInput } from '@/lib/tdee'

/**
 * 各字段的合法区间，一一抄自数据库的 check 约束
 * （见 supabase/migrations/0001_init.sql 的 user_profile 表）。
 * 客户端先挡一道，为的是把「多打一个 0」变成一句人话，而不是等数据库报错。
 */
export const PROFILE_RANGES = {
  heightCm: { min: 50, max: 260 },
  weightKg: { min: 20, max: 400 },
  age: { min: 10, max: 120 },
  weeklyExerciseHours: { min: 0, max: 80 },
  /** 手动覆盖的 TDEE。正常人 2000–3000 kcal（≈8400–12600 kJ），上限给得很宽松 */
  manualTdeeKj: { min: 0, max: 50000 },
  /** 每日热量缺口。50000 kJ ≈ 12000 kcal，与数据库那列的上限一致 */
  deficitKj: { min: 0, max: 50000 },
  /**
   * 缺口在界面上按 kcal 输入，所以还得有一个 kcal 区间（见文件头）。
   *
   * 上限**从 kJ 上限推出来**，不是手写一个 12000：11950 kcal × 4.184 = 49998.8 kJ，
   * 刚好不越界。手写 12000 会算出 50208 kJ，被数据库的 check 拦下来 ——
   * 那时用户看到的是数据库报错，而不是「填小一点」。派生一次，两边就永远对得上。
   *
   * （下面这个 deficitKj 不能删：lib/backup.ts 校验备份文件时用的就是它，
   *   备份里存的是 kJ，和数据库一致。）
   */
  deficitKcal: { min: 0, max: Math.floor(kjToKcal(50000)) },
} as const

/** 表单里七个控件各自**原始的字符串**。受控组件用它，出错重渲染时用户输入不会丢。 */
export type ProfileFormRaw = {
  heightCm: string
  weightKg: string
  age: string
  /** '' | 'male' | 'female' */
  gender: string
  weeklyExerciseHours: string
  manualTdeeKj: string
  /** ⚠️ 这一格是 **kcal**，其余的能量格是 kJ —— 见文件头 */
  deficitKcal: string
}

export const EMPTY_PROFILE_FORM: ProfileFormRaw = {
  heightCm: '',
  weightKg: '',
  age: '',
  gender: '',
  weeklyExerciseHours: '0',
  manualTdeeKj: '',
  deficitKcal: '0',
}

/** 哪个字段错了、提示是什么 */
export type ProfileFormErrors = Partial<Record<keyof ProfileFormRaw, string>>

/** 解析后的数值。（注意：`calorie_deficit_kj` 是 kJ，见文件头） */
export type ProfileFormValues = {
  heightCm: number | null
  weightKg: number | null
  age: number | null
  gender: Gender | null
  weeklyExerciseHours: number
  /** null = 没设，回落到公式估算 */
  manualTdeeKj: number | null
  deficitKj: number
}

export type ProfileFormResult =
  | { ok: true; values: ProfileFormValues }
  | { ok: false; errors: ProfileFormErrors }

/** 从 FormData 里取出那七个字段的原始字符串 */
export function readProfileForm(formData: FormData): ProfileFormRaw {
  const text = (key: keyof ProfileFormRaw): string => {
    const value = formData.get(key)
    return typeof value === 'string' ? value : ''
  }
  return {
    heightCm: text('heightCm'),
    weightKg: text('weightKg'),
    age: text('age'),
    gender: text('gender'),
    weeklyExerciseHours: text('weeklyExerciseHours'),
    manualTdeeKj: text('manualTdeeKj'),
    deficitKcal: text('deficitKcal'),
  }
}

/** 数据库里的值 → 表单原始字符串（打开资料页时预填用） */
export function profileToRaw(values: ProfileFormValues | null): ProfileFormRaw {
  if (values === null) return EMPTY_PROFILE_FORM
  const num = (value: number | null): string => (value === null ? '' : String(value))
  return {
    heightCm: num(values.heightCm),
    weightKg: num(values.weightKg),
    age: num(values.age),
    gender: values.gender ?? '',
    weeklyExerciseHours: String(values.weeklyExerciseHours),
    manualTdeeKj: num(values.manualTdeeKj),
    // kJ → kcal，取整（见 parseAll 里的说明：这一格是整数 kcal）
    deficitKcal: String(Math.round(kjToKcal(values.deficitKj))),
  }
}

/** 一个字段的解析结果：空的 / 合法的 / 非法的，三种情况要分开 */
type Parsed = { kind: 'empty' } | { kind: 'ok'; value: number } | { kind: 'bad' }

/**
 * 解析一个可选数字字段。
 *
 * @param integer 年龄这类必须整数的字段传 true（顺手把 3.5 这种输入四舍五入）
 * @param digits  入库精度，与列的 numeric(_,n) 对齐，免得库里带上长尾小数
 */
function parseOptional(
  raw: string,
  range: { min: number; max: number },
  options: { integer?: boolean; digits?: number } = {},
): Parsed {
  if (raw.trim() === '') return { kind: 'empty' }

  const parsed = options.integer ? parseInteger(raw) : parseNumberInput(raw)
  if (parsed === null) return { kind: 'bad' }

  const value = options.integer ? parsed : round(parsed, options.digits ?? 1)
  if (value < range.min || value > range.max) return { kind: 'bad' }
  return { kind: 'ok', value }
}

/** `10 到 120 之间` 这种提示语的统一措辞 */
function rangeMessage(label: string, range: { min: number; max: number }, unit: string): string {
  return `${label}请填 ${range.min} 到 ${range.max} 之间的数字（${unit}）`
}

/**
 * 把七个字段一次解析完，同时给出数值和错误。
 *
 * 拆成两个入口是为了照顾**边打边算**：用户刚把身高打到「17」时区间校验必然不过，
 * 这时候不该弹错（那是在骂正在打字的人），但也算不出 TDEE，预览自然消失即可。
 * 所以组件只取 values，错误留给真正提交后由服务端返回。
 */
function parseAll(raw: ProfileFormRaw): { values: ProfileFormValues; errors: ProfileFormErrors } {
  const errors: ProfileFormErrors = {}

  // 身体数据允许留空 —— 可以先把 TDEE 手动设上，之后再慢慢补。
  // 但一旦填了，就必须落在合理区间里。
  const heightCm = parseOptional(raw.heightCm, PROFILE_RANGES.heightCm)
  if (heightCm.kind === 'bad') {
    errors.heightCm = rangeMessage('身高', PROFILE_RANGES.heightCm, 'cm')
  }

  const weightKg = parseOptional(raw.weightKg, PROFILE_RANGES.weightKg)
  if (weightKg.kind === 'bad') {
    errors.weightKg = rangeMessage('体重', PROFILE_RANGES.weightKg, 'kg')
  }

  const age = parseOptional(raw.age, PROFILE_RANGES.age, { integer: true })
  if (age.kind === 'bad') {
    errors.age = rangeMessage('年龄', PROFILE_RANGES.age, '岁')
  }

  const gender = raw.gender.trim()
  if (gender !== '' && gender !== 'male' && gender !== 'female') {
    errors.gender = '请选择性别'
  }

  // 运动时长留空按 0 小时算（"我不运动" 和 "我没填" 在这里是同一件事，
  // 数据库那列的默认值也是 0），所以不报错。
  const weeklyExerciseHours = parseOptional(
    raw.weeklyExerciseHours,
    PROFILE_RANGES.weeklyExerciseHours,
  )
  if (weeklyExerciseHours.kind === 'bad') {
    errors.weeklyExerciseHours = rangeMessage(
      '每周运动时长',
      PROFILE_RANGES.weeklyExerciseHours,
      '小时',
    )
  }

  // 手动 TDEE：留空 = 用公式。填 0 也当成"没设"（0 kJ 的 TDEE 没有意义，
  // 多半是想清空又懒得删干净），这样和 calcTdee "manualTdeeKj > 0 才生效" 的规则一致。
  const manual = parseOptional(raw.manualTdeeKj, PROFILE_RANGES.manualTdeeKj, { digits: 2 })
  if (manual.kind === 'bad') {
    errors.manualTdeeKj = rangeMessage('TDEE', PROFILE_RANGES.manualTdeeKj, 'kJ')
  }

  // 缺口这一格用户在输入框里填的是 kcal（见文件头），入库前换成 kJ。
  // 取整而不是保留小数：没人会设「477.5 大卡」的缺口，而整数 kcal 换算回去也更稳 ——
  // 整数 kcal → kJ → 整数 kcal 是个不动点，反复打开保存不会一点点漂走。
  const deficit = parseOptional(raw.deficitKcal, PROFILE_RANGES.deficitKcal, { integer: true })
  if (deficit.kind === 'bad') {
    errors.deficitKcal = rangeMessage('热量缺口', PROFILE_RANGES.deficitKcal, 'kcal')
  }

  return {
    values: {
      heightCm: heightCm.kind === 'ok' ? heightCm.value : null,
      weightKg: weightKg.kind === 'ok' ? weightKg.value : null,
      age: age.kind === 'ok' ? age.value : null,
      gender: gender === '' ? null : (gender as Gender),
      weeklyExerciseHours: weeklyExerciseHours.kind === 'ok' ? weeklyExerciseHours.value : 0,
      manualTdeeKj: manual.kind === 'ok' && manual.value > 0 ? manual.value : null,
      // kcal → kJ。保留 2 位小数，与 `calorie_deficit_kj` 那列的 numeric(_,2) 对齐
      deficitKj: deficit.kind === 'ok' ? round(kcalToKj(deficit.value), 2) : 0,
    },
    errors,
  }
}

/** 严格版：任何一格不合法就整体不通过，调用方（Server Action）不许写库 */
export function validateProfileForm(raw: ProfileFormRaw): ProfileFormResult {
  const { values, errors } = parseAll(raw)
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, values }
}

/**
 * 宽松版：只要能解析出数字就用，越界的字段当成"没填"（null / 0）。
 * 只给界面**边打边算**用，绝不能拿它的结果去写库 —— 写库一律走 validateProfileForm。
 */
export function parseProfileValues(raw: ProfileFormRaw): ProfileFormValues {
  return parseAll(raw).values
}

/**
 * 身体数据填齐了才够得着公式 —— 缺任何一项都返回 null，
 * 这时候 UI 应该提示「去把资料填完整」，而不是算一个残缺的 TDEE。
 */
export function toTdeeInput(values: ProfileFormValues): TdeeInput | null {
  if (
    values.heightCm === null ||
    values.weightKg === null ||
    values.age === null ||
    values.gender === null
  ) {
    return null
  }
  return {
    heightCm: values.heightCm,
    weightKg: values.weightKg,
    age: values.age,
    gender: values.gender,
    weeklyExerciseHours: values.weeklyExerciseHours,
  }
}

/**
 * 缺口比 TDEE 还大 → 目标摄入是负数，也就是「一天什么都不能吃还要倒欠」。
 * 这显然是填错了，但**不拦着保存**（也许你就是想设个极端值看看），只提醒一句。
 *
 * 提示里带上换算后的 kcal：这是这一格最容易犯的错 —— 多打一位（500 打成 5000），
 * 光看「5000」不觉得荒谬，换算成 kcal 才看得出来。
 *
 * @returns 警告文案；没问题时返回 null
 */
export function budgetWarning(deficitKj: number, tdeeKj: number | null): string | null {
  if (tdeeKj === null || tdeeKj <= 0) return null
  if (deficitKj > tdeeKj) {
    return `缺口 ${Math.round(kjToKcal(deficitKj))} kcal 比总消耗还大，目标摄入会变成负数。一般减脂的缺口在 300–500 kcal 之间，看看是不是多打了一位。`
  }
  return null
}
