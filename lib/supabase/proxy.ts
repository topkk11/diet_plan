import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { supabaseEnv } from './env'

/**
 * 在 proxy 里做两件事：刷新 token + 引导匿名身份。
 *
 * 为什么必须放在这里：Server Component 不能写 cookie，而 access token 过期后需要
 * 把新 token 写回去，proxy 是整个应用里唯一能做到这一点的位置。
 *
 * 匿名身份的引导流程：
 *   没有会话 → signInAnonymously() → setAll 把 token 写进 cookie
 *   有会话   → getClaims() 顺手刷新（必要时回写新 token）
 *
 * 关于「在 proxy 里创建用户」这个用法：Supabase 官方示例的 proxy 只做 session 刷新，
 * 没有创建用户的先例。它在机制上是成立的（下面的 setAll 会同时写回 request，
 * 因此本次请求的服务端组件立刻就能看到这个身份），但属于少见用法。
 * 如果实测出现「每次访问都新建用户」或「服务端读不到身份」，回退方案是改成
 * 重定向到一个 Route Handler 去做创建（多一次跳转，但完全是官方姿势）。
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  const { url, key } = supabaseEnv()

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        // 先写回 request：让本次请求的服务端组件立刻看到新 token
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        // 重建 response 才能让 request 的改动生效
        response = NextResponse.next({ request })
        // 再写回 response：让浏览器保存下来
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // ⚠️ 从这里到 getClaims() 之间不要插入任何代码。
  //    官方明确警告：中间插入逻辑会导致极难排查的随机登出。
  let hasSession = false
  try {
    // getClaims 对项目公开密钥**本地验签**，不来回打 Auth 服务，比 getUser 快得多
    const { data } = await supabase.auth.getClaims()
    hasSession = Boolean(data?.claims)
  } catch {
    hasSession = false
  }

  if (!hasSession) {
    try {
      // 只在完全没有会话时才会走到这里，所以同一台设备会一直复用同一个匿名身份
      await supabase.auth.signInAnonymously()
    } catch {
      // 例如命中匿名登录限流（默认 30 次/小时/IP）。
      // 静默失败：页面显示空态，用户下次操作会重试。不要在 proxy 里抛错，
      // 那会让整个站点变成 500。
    }
  }

  // 必须原样返回，不能另建一个 response —— 否则浏览器和服务端的 cookie 会不同步，
  // 表现为「用着用着突然掉登录」
  return response
}
