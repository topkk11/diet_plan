/**
 * URL 相关的校验。
 *
 * 独立成文件是为了能被单元测试直接 import —— 带 'use server' 的 action 文件
 * 在测试环境里跑不起来（见 lib/food-input.ts 开头的说明）。
 */

/**
 * 只放行站内相对路径，用来做「保存后跳回哪一页」。
 *
 * 为什么要挡：next 是表单里的隐藏字段，也就是用户可控的输入。如果直接
 * `redirect(next)`，一个 `//evil.com` 就能把用户从自己的应用跳到钓鱼站
 * （协议相对 URL 会被浏览器当成外部域名）。
 */
export function safeInternalPath(raw: string | null): string | null {
  if (!raw) return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//')) return null
  if (raw.includes('\\')) return null // 有些浏览器把 \ 当成 /
  if (raw.includes('\n') || raw.includes('\r')) return null // 防响应头注入
  return raw
}
