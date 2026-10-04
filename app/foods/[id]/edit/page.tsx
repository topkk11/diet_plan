import Link from 'next/link'
import { notFound } from 'next/navigation'

import { FoodForm } from '@/components/FoodForm'
import type { FoodFormRaw } from '@/lib/food-input'
import { asNumber } from '@/lib/num'
import { getFood } from '@/lib/queries'
import type { FoodRow } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * 数据库里读出来的数字 → 输入框里的字符串。
 * numeric 列可能返回 "3.30" 这种带尾零的字符串，直接塞进输入框不好看，
 * 转成 Number 再转字符串就干净了。
 */
function inputValue(value: number): string {
  return String(asNumber(value))
}

function toFormRaw(food: FoodRow): FoodFormRaw {
  return {
    name: food.name,
    energyKj: inputValue(food.calories_kj_per_100g),
    proteinG: inputValue(food.protein_g_per_100g),
    carbsG: inputValue(food.carbs_g_per_100g),
    fatG: inputValue(food.fat_g_per_100g),
  }
}

export default async function EditFoodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const food = await getFood(id)

  // id 不合法、食物不存在、或者不属于当前用户（RLS 让它查不到）都走这里
  if (!food) notFound()

  return (
    <main>
      <header className="mb-4">
        <Link href="/foods" className="text-sm text-ink-soft">
          ‹ 食物库
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{food.name}</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          改完保存后，所有用到它的历史记录会一起按新数值重算。
        </p>
      </header>

      <FoodForm mode="edit" foodId={food.id} initial={toFormRaw(food)} />
    </main>
  )
}
