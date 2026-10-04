import Link from 'next/link'

import { FoodForm } from '@/components/FoodForm'
import { safeInternalPath } from '@/lib/url'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{ next?: string | string[] }>

/**
 * 新增食物。
 *
 * `?next=` 是给「在选食物时现场新建一个」用的（见 components/FoodPicker.tsx）：
 * 存完跳回原来的选择器，用户不用自己找回来。这里先过一遍 safeInternalPath，
 * 非法值直接丢掉 —— 隐藏字段属于用户可控输入，不能原样交给 redirect。
 */
export default async function NewFoodPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const raw = params.next
  const next = safeInternalPath((Array.isArray(raw) ? raw[0] : raw) ?? '') ?? undefined

  return (
    <main>
      <header className="mb-4">
        <Link href={next ?? '/foods'} className="text-sm text-ink-soft">
          ‹ 返回
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">添加食物</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          数值照包装上的「每 100g」那一栏抄。热量填 kJ，右边会实时显示 kcal。
        </p>
      </header>

      <FoodForm mode="create" next={next} />
    </main>
  )
}
