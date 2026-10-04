import { dietIcon } from '@/lib/icon'

/**
 * 180×180 —— iOS「添加到主屏幕」用的是这个尺寸（见 app/layout.tsx 的 apple 图标声明）。
 *
 * 为什么是这样一个一个文件夹、而不是 app/icon.tsx 那套文件约定：
 * manifest.webmanifest 里的 src 必须是写死的字符串，而 app/icon.tsx 生成的 URL
 * 带构建哈希（/icon?<hash>），每次构建都不一样，没法从 manifest 里引用。
 * 固定路径 /icons/180 就没这个问题，顺便几个尺寸还能共用 lib/icon.tsx 里同一份图案。
 */
/** 图片只跟尺寸有关，不依赖任何请求数据 —— 构建时画一次就够，不必每次请求都重画 */
export const dynamic = 'force-static'

export function GET() {
  return dietIcon(180)
}
