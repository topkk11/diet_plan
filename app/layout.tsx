import type { Metadata, Viewport } from 'next'

import BottomNav from '@/components/BottomNav'
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar'
import './globals.css'

export const metadata: Metadata = {
  title: '饮食计划监测工作台',
  description: '记录每日餐次与热量摄入，追踪热量缺口',
  // iOS 添加到主屏后以 App 形式打开（不显示 Safari 地址栏）
  appleWebApp: { capable: true, statusBarStyle: 'default', title: '饮食计划' },
  // 避免 iOS 把数字自动识别成电话号码并加上蓝色链接
  formatDetection: { telephone: false, date: false, address: false, email: false },
  /*
   * 图标手写 URL 而不是用 app/icon.tsx 那套文件约定：
   * manifest.webmanifest 里的 src 必须是写死的字符串，而文件约定生成的 URL 带构建哈希。
   * 手写一份，桌面标签页、iOS 主屏、Android 主屏三处用的是同一份图案（lib/icon.tsx）。
   * manifest.ts 里还要再列一遍 —— 那是给安装用的，这一份是给浏览器标签页用的，两回事。
   */
  icons: {
    icon: [{ url: '/icons/192', type: 'image/png', sizes: '192x192' }],
    apple: [{ url: '/icons/180', type: 'image/png', sizes: '180x180' }],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 让页面铺到刘海屏/小白条区域，配合 env(safe-area-inset-*) 使用
  viewportFit: 'cover',
  themeColor: '#0f766e',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {/*
          max-w-md + mx-auto：手机上满宽，电脑上收窄居中，避免拉成一条不好读的长行。
          pb-24 给底部固定的 tab 导航让出位置。
        */}
        <div className="mx-auto w-full max-w-md px-4 pt-5 pb-24">{children}</div>
        <BottomNav />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  )
}
