import { dietIcon } from '@/lib/icon'

/** 192×192 —— Android 主屏图标的最小尺寸，也是清单里的第一个 */
export const dynamic = 'force-static'

export function GET() {
  return dietIcon(192)
}
