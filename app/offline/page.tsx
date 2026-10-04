import type { Metadata } from 'next'

/**
 * 离线兜底页。断网时 public/sw.js 会把所有页面导航导到这里。
 *
 * 两个刻意的设计：
 *
 * 1. **不显示任何缓存下来的饮食数据。** 隔三天打开看到的是三天前的热量，
 *    而页面上没有任何提示——那比一句「现在没网」危险得多。所以离线就是离线，
 *    不拿旧内容冒充当前状态。
 * 2. **不用 next/link、不用按钮。** 这条路径要能在最恶劣的条件下工作，
 *    所以只有一个普通 `<a>`：整页导航，不依赖客户端路由。断了网再点它
 *    会重新试一次网络，还是不通就回到这一页。
 *
 * 这一页在 proxy.ts 的 matcher 里被排除了，所以不需要登录态就能取到，
 * service worker 才好在安装时把它缓存下来。
 */

export const metadata: Metadata = {
  title: '没网 · 饮食计划',
}

export default function OfflinePage() {
  return (
    <main>
      <h1 className="text-xl font-semibold tracking-tight">现在没网</h1>

      <section className="mt-3 rounded-card border border-line bg-surface p-4">
        <p className="text-sm text-ink-soft">
          这一页是断网时的兜底页。等信号回来，点下面的按钮接着用就行。
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          已经记下的东西都在服务器上，断网不会让它们丢掉。
        </p>
      </section>

      {/*
        这里**故意**用普通 <a>，不用 next/link —— 所以下面那行要关掉 lint 规则。
        原因：离线时 <Link> 会走客户端路由去取 RSC 数据，取不到就落到 Next 的错误边界上；
        而整页导航会走 service worker 的 network-first，取不到时正好回落到这一页 ——
        也就是「点了还回这里，但会重新试一次网络」，这才是想给用户的行为。
      */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="mt-4 flex min-h-12 w-full items-center justify-center rounded-card bg-brand px-4 text-base font-medium text-white"
      >
        重新加载
      </a>

      <p className="mt-3 text-xs text-ink-faint">
        断网时只能看，不能记 —— 记录要写到服务器上，所以得先有网。
      </p>
    </main>
  )
}
