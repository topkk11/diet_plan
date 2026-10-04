'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * 底部 tab 导航。手机上固定在底部，用 safe-area 内边距避开 iPhone 的小白条。
 * 图标用内联 SVG（不引图标库）—— 想换图标直接改下面的 path 就行。
 */

type Tab = {
  href: string
  label: string
  icon: ReactNode
}

const iconProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

const TABS: Tab[] = [
  {
    href: '/',
    label: '计划',
    icon: (
      <svg {...iconProps}>
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
  {
    href: '/foods',
    label: '食物库',
    icon: (
      <svg {...iconProps}>
        <path d="M4 11h16v1a8 8 0 0 1-16 0v-1Z" />
        <path d="M2.5 11h19" />
      </svg>
    ),
  },
  {
    href: '/history',
    label: '历史',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: '我的',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="8" r="3.75" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
    ),
  },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur">
      <div
        className="mx-auto flex w-full max-w-md items-stretch"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {TABS.map((tab) => {
          // 首页必须精确匹配，否则 startsWith('/') 会让所有页面都高亮成「计划」
          const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors ${
                active ? 'font-medium text-brand' : 'text-ink-faint'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
