/**
 * 食物列表里每一行右侧的「删除 / 归档 / 恢复」操作。
 *
 * 这里是**服务端组件**（没有 'use client'），做法值得说明一下，因为它不是最直觉的写法：
 *
 * 1. 表单的 action 用 `removeFood.bind(null, foodId)` 直接绑定服务端函数。
 *    这样 React 会在服务端渲染时把 action 引用写进 HTML 的隐藏字段里，
 *    **没有 JavaScript 也能提交**。
 *    （反例：如果用 useActionState + 客户端闭包，React 渲不出这个引用，
 *      表单就只能在浏览器里跑 —— 我第一版就是这么写的，后来改掉了。）
 *
 * 2. 二次确认用原生 `<details>`/`<summary>`，不弹 window.confirm。
 *    · confirm 只能给一行纯文本，说不清「为什么这个食物不能真删」
 *    · 部分浏览器会拦截 confirm
 *    · 更重要的是 details 不需要 JS，上面的渐进增强才成立
 *
 * 3. 按钮文案由「被引用次数」决定，而不是点完才告诉你不行。
 *    refCount > 0 说明历史记录已经在用它，按「历史跟着食物变」的规则就只能归档。
 *    那就一开始写着「归档」，并注明有几条记录在用它 —— 点之前就知道会发生什么。
 */

import { removeFood, restoreFood } from '@/actions/foods'

type Props = {
  foodId: string
  /** 被多少条饮食记录引用。0 才能真删除 */
  refCount: number
  /** 当前是否已归档（已归档的行显示「恢复」） */
  archived: boolean
}

export function FoodRowActions({ foodId, refCount, archived }: Props) {
  const willArchive = !archived && refCount > 0

  const label = archived ? '恢复' : willArchive ? '归档' : '删除'
  const confirmLabel = archived ? '确认恢复' : willArchive ? '确认归档' : '确认删除'
  const confirmClass =
    willArchive || archived
      ? 'bg-warn' // 归档是可逆的，用橙色
      : 'bg-over' // 真删除不可逆，用红色

  const action = archived ? restoreFood.bind(null, foodId) : removeFood.bind(null, foodId)

  return (
    <details className="shrink-0">
      <summary className="flex min-h-9 cursor-pointer list-none items-center rounded-lg border border-line px-3 text-sm text-ink-soft [&::-webkit-details-marker]:hidden">
        {label}
      </summary>

      <div className="mt-1.5 flex flex-col items-end gap-1">
        {willArchive ? (
          <span className="text-[11px] text-ink-faint">历史用了 {refCount} 次</span>
        ) : null}
        {/* 想反悔就再点一下上面的 summary —— 原生 details 自带收起，不需要额外的取消按钮 */}
        <form action={action}>
          <button
            type="submit"
            className={`min-h-9 rounded-lg px-3 text-sm font-medium text-white ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </form>
      </div>
    </details>
  )
}
