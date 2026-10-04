import type { MetadataRoute } from 'next'

/**
 * PWA 清单。Next 会自动把它伺服在 /manifest.webmanifest，并在每个页面的 <head> 里挂上 link。
 *
 * 图标全部指向 app/icons/<尺寸>/route.ts 现画的 PNG，用固定 URL（原因见那几个文件里的注释）。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '饮食计划监测工作台',
    short_name: '饮食计划',
    description: '记录每日餐次与热量摄入，追踪热量缺口',
    lang: 'zh-CN',
    start_url: '/',
    scope: '/',
    // standalone：从主屏图标打开时没有浏览器地址栏，跟原生 App 一样
    display: 'standalone',
    orientation: 'portrait',
    // 启动画面用浅灰底（和 --color-surface-2 一致），状态栏用品牌绿（和 viewport 的 themeColor 一致）
    background_color: '#f4f5f7',
    theme_color: '#0f766e',
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png' },
      // purpose: 'maskable' 单独列一条 —— 这一条会被系统裁形状，图案已经预留了安全区
      { src: '/icons/maskable-512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
