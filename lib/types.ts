import type { Gender } from '@/lib/tdee'

/**
 * 数据库行类型，与 supabase/migrations/0001_init.sql 一一对应。
 * **改了表结构记得回来同步这里**（这是手写类型唯一的代价）。
 *
 * 为什么手写而不自动生成：自动生成要装 supabase CLI 并登录一次。为了让你少装一个
 * 工具就手写了。将来想换成 `supabase gen types typescript` 自动生成也可以，
 * 查询和组件的写法都不用改。
 *
 * 关于数字类型：PostgREST 返回 numeric 列时可能是 number 也可能是 string，
 * 所以读出来之后一律用 asNumber()（lib/num.ts）转一遍再用。
 */

export type FoodRow = {
  id: string
  user_id: string
  name: string
  calories_kj_per_100g: number
  protein_g_per_100g: number
  carbs_g_per_100g: number
  fat_g_per_100g: number
  /** 非空表示已归档：从食物库列表和选择器里隐藏，但历史记录照常显示 */
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type MealRow = {
  id: string
  user_id: string
  /** YYYY-MM-DD */
  date: string
  name: string
  sort_order: number
  created_at: string
}

export type MealItemRow = {
  id: string
  user_id: string
  meal_id: string
  food_id: string
  amount_g: number
  created_at: string
}

export type ProfileRow = {
  id: string
  user_id: string
  height_cm: number | null
  weight_kg: number | null
  age: number | null
  gender: Gender | null
  weekly_exercise_hours: number
  /** 手动覆盖的 TDEE（kJ）。为空或 0 时用公式估算 */
  manual_tdee_kj: number | null
  /** 每日热量缺口（kJ） */
  calorie_deficit_kj: number
  timezone: string
  created_at: string
  updated_at: string
}
