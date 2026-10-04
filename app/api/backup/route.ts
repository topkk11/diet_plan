/**
 * 备份导出：GET /api/backup 直接下载一个 JSON 文件。
 *
 * 为什么是 Route Handler 而不是 Server Action：
 * 导出的结果要作为**文件下载**，靠的是响应头 `Content-Disposition: attachment`。
 * Server Action 返回的是给 React 渲染的数据，没法设置下载头。
 * 又因为是个纯 GET，界面上用一个普通 `<a href="/api/backup" download>` 就能触发 ——
 * 手机上点一下直接进「下载/分享」菜单，**没有 JavaScript 也能用**。
 *
 * 会话由 proxy.ts 保证：任何请求进来都会先刷新 token，没有会话就建一个匿名身份。
 * 也就是说这里拿到的永远是自己那份数据（RLS 兜底），陌生人来下载只会得到空文件。
 */

import { NextResponse } from 'next/server'

import { backupFileName, toBackupFile } from '@/lib/backup'
import { getBackupRows } from '@/lib/queries'

// 每次请求都要现读一遍数据，不能缓存
export const dynamic = 'force-dynamic'

export async function GET() {
  const rows = await getBackupRows()
  const file = toBackupFile(rows.profile, rows.foods, rows.meals, rows.mealItems)

  const today = new Date().toISOString().slice(0, 10)

  return new NextResponse(JSON.stringify(file, null, 2), {
    headers: {
      // charset 不能省：文件名和食物名都是中文，少了它某些浏览器会按 latin1 解出乱码
      'content-type': 'application/json; charset=utf-8',
      // 同时给两个 filename：老浏览器只认 ASCII 那个，新的用 RFC 5987 的 filename* 拿中文名。
      // 手机上的「下载」列表里显示的是中文名，不加 filename* 会变成一长串 %E9%A5%AE...
      'content-disposition':
        `attachment; filename="diet-plan-backup-${today}.json"; ` +
        `filename*=UTF-8''${encodeURIComponent(backupFileName())}`,
      // 备份里是私人数据，别让中间层留着
      'cache-control': 'no-store',
    },
  })
}
