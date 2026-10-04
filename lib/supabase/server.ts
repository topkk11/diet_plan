import 'server-only'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { supabaseEnv } from './env'

/**
 * 服务端 Supabase 客户端。所有 Server Component 读数据、所有 Server Action 写数据
 * 都用它。
 *
 * 千万别把它提升成模块级变量缓存起来 —— 那样在并发请求之间会串用户，
 * 后面一个人可能读到前一个人的数据。每次调用创建一个新实例是正确的做法。
 */
export async function createClient() {
  // Next 16 里 cookies() 是异步的，必须 await（同步版本已被移除）
  const cookieStore = await cookies()
  const { url, key } = supabaseEnv()

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Component 渲染期间不允许写 cookie。
          // 真正负责刷新 token 的是 proxy.ts，这里忽略异常是官方推荐的写法。
        }
      },
    },
  })
}

/**
 * 取当前用户 id。拿不到就抛错 —— 正常流程下不应该发生，因为 proxy.ts 保证
 * 每个请求进来时都已经有匿名身份了。抛错而不是返回 null，是为了让「忘记登录处理」
 * 这种 bug 尽早暴露，而不是静默地查到空数据。
 */
export async function requireUserId(): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) {
    throw new Error('当前请求没有 Supabase 会话，无法读写数据。请刷新页面重试。')
  }

  return data.user.id
}
