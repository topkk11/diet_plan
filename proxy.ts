import type { NextRequest } from 'next/server'

import { updateSession } from '@/lib/supabase/proxy'

/**
 * Next.js 16 把 middleware.ts 改名成了 proxy.ts（导出函数也从 middleware 改成 proxy）。
 * 旧名字目前仍能用但已废弃，这里用新约定。
 *
 * 本文件刻意保持"薄"：只做 session 刷新和匿名身份引导，重逻辑都在
 * Server Component / Server Action 里。官方也是这么建议的。
 */
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * 排除不需要 session 的请求，避免无意义地跑一遍 Supabase 逻辑：
     *   _next/static  构建产物（文件名带哈希，内容不可变）
     *   _next/image   图片优化
     *   icons/        PWA 图标（由 route handler 生成）
     *   manifest.webmanifest / sw.js / favicon.ico / offline  纯静态资源
     * 其余全部走 proxy，包括 /api（备份导出这类接口也需要刷新后的会话）。
     */
    '/((?!_next/static|_next/image|icons/|manifest.webmanifest|sw.js|favicon.ico|offline).*)',
  ],
}
