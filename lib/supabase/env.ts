/**
 * Supabase 环境变量。
 *
 * 注意：这两个值都会被内联进浏览器端代码，这是**设计如此**——它们是公开密钥，
 * 数据安全靠数据库的 RLS 策略，不靠隐藏这个 key。
 * 反过来说：service_role / secret key 绝对不能出现在这里（本项目根本不需要它）。
 *
 * ⚠️ 必须写成 process.env.NEXT_PUBLIC_XXX 这种字面形式，
 *    改成 process.env[name] 这种动态取值后，Next.js 的编译期替换就不会生效，
 *    浏览器端会拿到 undefined。
 */
export function supabaseEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!url || !key) {
    throw new Error(
      '缺少环境变量 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY。' +
        '请把 .env.local.example 复制成 .env.local 并填入你 Supabase 项目的值。',
    )
  }

  return { url, key }
}
