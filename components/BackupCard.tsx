'use client'

/**
 * 备份与恢复卡片（放在资料页底部）。
 *
 * 这块界面存在的唯一理由：本应用用的是 Supabase **匿名身份** ——
 * 清一次浏览器数据、或者换一台手机，服务端就再也认不出你了，
 * 那些数据会变成没人能访问的孤儿。导出/恢复是唯一的自救通道。
 *
 * 两条针对手机的设计：
 *
 * 1. **导出是一个普通链接**（`<a href="/api/backup" download>`），不是按钮。
 *    点一下就走浏览器自己的下载流程，进「下载 / 分享到微信 / 存到文件」，
 *    而且**没有 JavaScript 也能用**。
 *
 * 2. **恢复要过一道确认框**。这是全站唯一会删数据的地方，加一点摩擦是故意的 ——
 *    手滑点中一个按钮就清空几个月记录，没有比这更糟的体验。
 */

import { useActionState } from 'react'

import { restoreBackup, type RestoreState } from '@/actions/backup'
import { MAX_BACKUP_BYTES } from '@/lib/backup'

export function BackupCard() {
  const [state, formAction, pending] = useActionState<RestoreState, FormData>(restoreBackup, null)

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <h2 className="text-sm font-medium">备份与恢复</h2>
      <p className="mt-1 text-xs text-ink-faint">
        这个网站靠浏览器的身份登录，没有账号密码。清掉浏览器数据或换手机后旧身份就找不回来了，
        所以建议每周导出一份，存在手机或网盘里。
      </p>

      {/* ------------------------------------------------------------ 导出 */}
      <a
        href="/api/backup"
        download
        className="mt-3 flex min-h-12 items-center justify-center rounded-card border border-brand bg-brand/10 px-4 text-base font-medium text-brand"
      >
        导出备份（下载 JSON）
      </a>
      <p className="mt-1 text-xs text-ink-faint">
        文件里是全部食物、餐次记录和个人资料，可以直接用记事本打开看。
      </p>

      {/* ------------------------------------------------------------ 恢复 */}
      <hr className="my-4 border-line" />

      <h3 className="text-sm font-medium">从备份恢复</h3>
      <p className="mt-1 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
        恢复会<span className="font-medium">先清空当前身份下的全部数据</span>，再写入文件里的内容。
        如果这台设备上有还没导出的新记录，它们会消失。
      </p>

      <form action={formAction} className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">备份文件</span>
          <input
            type="file"
            name="file"
            accept="application/json,.json"
            className="block w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand/10 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand"
          />
          <span className="mt-1 block text-xs text-ink-faint">
            最多 {MAX_BACKUP_BYTES / 1024 / 1024} MB，选错了会原样退回、不动你的数据
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="confirm"
            className="mt-0.5 size-5 shrink-0 rounded border-line accent-over"
          />
          <span>我确认要覆盖当前的全部数据</span>
        </label>

        {state ? (
          <p
            aria-live="polite"
            className={`rounded-card border px-3 py-2 text-sm ${
              state.ok
                ? 'border-good/30 bg-good/10 text-good'
                : 'border-over/30 bg-over/10 text-over'
            }`}
          >
            {state.message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="min-h-12 w-full rounded-card border border-over px-4 text-base font-medium text-over disabled:opacity-60"
        >
          {pending ? '正在恢复…' : '恢复数据'}
        </button>
      </form>

      <p className="mt-3 text-xs text-ink-faint">
        换新手机时：先把导出的 JSON 发到新手机，在新手机上打开本站（会生成一个全新的空身份），
        再回到这里导入，数据就原样回来了。
      </p>
    </section>
  )
}
