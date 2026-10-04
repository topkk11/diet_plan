import Link from 'next/link'

/** 找不到页面，或者 /foods/[id]/edit 里的 id 不存在 / 不属于当前用户 */
export default function NotFound() {
  return (
    <main className="py-10 text-center">
      <h1 className="text-lg font-semibold">没找到这个页面</h1>
      <p className="mt-1 text-sm text-ink-soft">
        可能是链接过期了，或者这条数据已经被删掉。
      </p>
      <Link
        href="/foods"
        className="mt-5 inline-flex min-h-11 items-center rounded-card bg-brand px-5 text-sm font-medium text-white"
      >
        回食物库
      </Link>
    </main>
  )
}
