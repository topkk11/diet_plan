import { BackupCard } from '@/components/BackupCard'
import { ProfileForm } from '@/components/ProfileForm'
import { profileToRaw } from '@/lib/profile-input'
import { countActiveFoods, getProfile, getSessionUser, profileNumbers } from '@/lib/queries'

/**
 * 个人资料、TDEE 与备份。
 *
 * ⚠️ 和其他页面一样必须动态渲染：资料是从当前会话的用户行里读出来的。
 */
export const dynamic = 'force-dynamic'

/** 连接自检的一行 */
function CheckRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-sm text-ink-soft">{label}</span>
      <span className={`text-sm font-medium ${ok ? 'text-good' : 'text-over'}`}>{value}</span>
    </div>
  )
}

export default async function ProfilePage() {
  const [user, profile, foodCount] = await Promise.all([
    getSessionUser(),
    getProfile(),
    countActiveFoods(),
  ])

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">我的</h1>
        <p className="mt-0.5 text-sm text-ink-soft">身体数据、TDEE 与热量缺口</p>
      </header>

      {/* 初始值从服务端带下来，之后表单自己受控 —— 边打边算 TDEE 都在浏览器里完成 */}
      <ProfileForm initial={profileToRaw(profileNumbers(profile))} />

      <div className="mt-4">
        <BackupCard />
      </div>

      <section className="mt-4 rounded-card border border-line bg-surface p-4">
        <h2 className="text-sm font-medium">连接自检</h2>
        <p className="mt-0.5 text-xs text-ink-faint">
          用来确认数据库连接和身份隔离是否正常。平时不用管它。
        </p>
        <div className="mt-2 divide-y divide-line">
          <CheckRow
            label="匿名身份"
            value={user ? (user.isAnonymous ? '已建立（匿名）' : '已建立') : '未建立'}
            ok={Boolean(user)}
          />
          <CheckRow
            label="用户 ID"
            value={user ? `${user.id.slice(0, 8)}…` : '—'}
            ok={Boolean(user)}
          />
          <CheckRow
            label="个人资料行"
            value={profile ? '已存在' : '缺失'}
            ok={Boolean(profile)}
          />
          <CheckRow label="食物库条目" value={`${foodCount} 个`} ok />
        </div>
      </section>
    </main>
  )
}
