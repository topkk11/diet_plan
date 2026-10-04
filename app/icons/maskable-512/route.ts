import { dietIcon } from '@/lib/icon'

/**
 * 512×512 的 maskable 版本。
 *
 * 和 /icons/512 的区别只有一处：图案缩到 60%（见 lib/icon.tsx）。
 * Android 会把 maskable 图标裁成圆形、方形或者水滴形，只保证中间 80% 的圆可见 ——
 * 直接把普通图标交给它，白色圆圈的四边会被削掉。
 */
export const dynamic = 'force-static'

export function GET() {
  return dietIcon(512, { maskable: true })
}
