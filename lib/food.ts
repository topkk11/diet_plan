/**
 * 把数据库的「行」转换成界面好用的「视图对象」。
 *
 * 这一层的意义在于：视图里同时带上**每 100g 的营养值**和**按克数折算后的营养值**。
 * 于是手机端改克数时，前端可以直接用 per100g × 新克数本地重算，
 * 不用等服务端返回 —— 这是「改克数要即时反馈」能成立的前提。
 */

import { asNumber } from '@/lib/num'
import { per100gToAmount, sumNutrients, ZERO_NUTRIENTS, type Nutrients } from '@/lib/nutrition'
import type { FoodRow, MealItemRow, MealRow } from '@/lib/types'

/**
 * 用得到的四个营养列。值可能是 number 也可能是字符串 ——
 * PostgREST 返回 numeric 列的类型不固定（见 lib/types.ts 的说明）。
 */
export type FoodNutrientColumns = {
  calories_kj_per_100g: number | string
  protein_g_per_100g: number | string
  carbs_g_per_100g: number | string
  fat_g_per_100g: number | string
}

/**
 * foods 表一行 → 每 100g 的营养值。
 *
 * 参数只要那四个营养列，不要整行 —— 历史页是用嵌套查询取回来的，
 * 拿到的是「被 PostgREST 挑出来的那几列」，凑不出一个完整的 FoodRow。
 * 写成这样让两边都能直接传进来，不用为此编一个假对象。
 */
export function foodPer100g(food: FoodNutrientColumns): Nutrients {
  return {
    energyKj: asNumber(food.calories_kj_per_100g),
    proteinG: asNumber(food.protein_g_per_100g),
    carbsG: asNumber(food.carbs_g_per_100g),
    fatG: asNumber(food.fat_g_per_100g),
  }
}

export type MealItemView = {
  id: string
  foodId: string
  foodName: string
  amountG: number
  /** 实际吃下多少（已按克数折算） */
  nutrients: Nutrients
  /** 该食物每 100g 的值，前端改克数时用它本地重算 */
  per100g: Nutrients
  /** 该食物的营养数据是否已被归档（归档后仍显示在历史里，只是不能再新增） */
  foodArchived: boolean
}

export type MealView = {
  id: string
  name: string
  sortOrder: number
  items: MealItemView[]
  /** 该餐小计 */
  totals: Nutrients
}

export type DayPlan = {
  /** YYYY-MM-DD */
  date: string
  meals: MealView[]
  /** 全天汇总 */
  totals: Nutrients
}

function toItemView(item: MealItemRow, food: FoodRow): MealItemView {
  const per100g = foodPer100g(food)
  const amountG = asNumber(item.amount_g)
  return {
    id: item.id,
    foodId: item.food_id,
    foodName: food.name,
    amountG,
    nutrients: per100gToAmount(per100g, amountG),
    per100g,
    foodArchived: food.archived_at !== null,
  }
}

/**
 * 组装某一天的完整计划。meals 与 items 已按用户过滤（由 RLS 保证），
 * 这里只做排序和汇总。
 */
export function buildDayPlan(
  date: string,
  meals: readonly MealRow[],
  items: readonly MealItemRow[],
  foods: readonly FoodRow[],
): DayPlan {
  const foodById = new Map(foods.map((f) => [f.id, f]))
  const itemsByMeal = new Map<string, MealItemRow[]>()

  for (const item of items) {
    const list = itemsByMeal.get(item.meal_id)
    if (list) list.push(item)
    else itemsByMeal.set(item.meal_id, [item])
  }

  const sortedMeals = [...meals].sort(
    (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
  )

  const mealViews: MealView[] = sortedMeals.map((meal) => {
    const mealItems = itemsByMeal.get(meal.id) ?? []
    const itemViews = mealItems
      .map((item) => {
        const food = foodById.get(item.food_id)
        // 理论上不会缺（数据库有外键约束），保险起见跳过而不是崩掉整个页面
        return food ? toItemView(item, food) : null
      })
      .filter((v): v is MealItemView => v !== null)
      .sort((a, b) => a.id.localeCompare(b.id))

    return {
      id: meal.id,
      name: meal.name,
      sortOrder: meal.sort_order,
      items: itemViews,
      totals: sumNutrients(itemViews.map((v) => v.nutrients)),
    }
  })

  return {
    date,
    meals: mealViews,
    totals: sumNutrients(mealViews.flatMap((m) => m.items.map((i) => i.nutrients))),
  }
}

export const EMPTY_DAY_PLAN = (date: string): DayPlan => ({
  date,
  meals: [],
  totals: ZERO_NUTRIENTS,
})
