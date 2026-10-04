/*
 * 手写的最小 service worker。不引 @serwist/next 这类框架 ——
 * 构建配置零风险，而且这一百来行你自己看得懂也改得动。
 *
 * ## 它只做一件事：让「打开」这件事在断网时不成问题
 *
 *   预缓存          离线兜底页 + 四个图标
 *   /_next/static/  cache-first（文件名带内容哈希，内容永不变，缓存了就不用再问网络）
 *   页面导航        network-first，断网时回落到离线兜底页
 *   其余            不碰，直接走网络（包括 Supabase 的请求）
 *
 * ## 故意不做的事（这些「不做」都是决定，不是没来得及）
 *
 * · **不做离线写入和后台同步。** 饮食记录是要落库的数据，断网时排队重发很容易写出
 *   「本地改了一条、服务端也改了一条」这种对不上的状态。宁可断网时什么都改不了。
 * · **不缓存页面内容、断网时不拿旧页面顶替。** 隔了三天打开看到的是三天前的热量数字，
 *   但页面上没有任何地方提示这是旧的 —— 比看到一句「现在没网」糟糕得多。
 *   所以导航请求断网就落到离线页，不拿 stale 内容冒充当前状态。
 * · 不碰 /api/*。备份导出这类请求返回的是瞬间的数据，缓存下来只会骗人。
 */

// 改动这个文件后要把版本号 +1，否则老缓存会一直留着（下面 activate 里按名字清理）
const CACHE = 'diet-plan-v1'

const OFFLINE_URL = '/offline'

/** 预缓存清单：都是不需要登录态就能拿到的静态东西 */
const PRECACHE = ['/offline', '/icons/180', '/icons/192', '/icons/512', '/icons/maskable-512']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // 一个一个加，而不是 cache.addAll —— 后者只要有一条失败就整批失败，
      // 于是某个图标 404 会导致预缓存整个为空、离线页也没了。
      // 现在单条失败只丢那一条，剩下的照常可用。
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // 只处理 GET。POST 是写操作，写操作一律走网络（上面说了不做离线写入）
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // 只处理自己这个源：Supabase 的请求放行，缓存别人的 API 响应没有任何意义
  if (url.origin !== self.location.origin) return

  // 用 request.mode 判断「这是不是一次页面导航」，而不是去匹配路径 ——
  // 这样以后加了新页面不用回来改这个文件
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request))
    return
  }
})

async function networkFirst(request) {
  try {
    return await fetch(request)
  } catch {
    const cached = await caches.match(OFFLINE_URL)
    if (cached) return cached
    // 连离线页都没缓存上（比如安装时就不在线）—— 给一句能看懂的话，
    // 而不是让浏览器弹「无法访问此网站」
    return new Response('现在没网，等信号回来再刷新。', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  // 只存成功的基本响应：206（分段）、opaque（跨域）存了也用不上
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE)
    cache.put(request, response.clone())
  }
  return response
}
