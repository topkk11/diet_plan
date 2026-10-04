'use client'

import { useEffect } from 'react'

/**
 * 注册 service worker（public/sw.js）。
 *
 * 两个决定：
 *
 * 1. **只在生产构建里注册。** 开发时 sw.js 会把页面缓存住，改了代码刷新却看不到变化 ——
 *    这是最容易白白浪费半小时的一类 bug，所以 `next dev` 下干脆不注册。
 * 2. **失败不提示、不重试。** service worker 只负责「断网时也能打开」，
 *    注册不上应用照样能用，没必要为它弹任何东西打扰人。
 *
 * 注册本身不读任何数据、不碰登录态，所以放在根布局里对所有人都安全。
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // 忽略：注册失败不影响任何功能
    })
  }, [])

  return null
}
