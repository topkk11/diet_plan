import { ImageResponse } from 'next/og'

/**
 * PWA 图标：用代码画出来，仓库里不需要任何 .png 素材。
 *
 * **只用图形，不用文字。** ImageResponse 底下是 satori，它默认只带拉丁字形 ——
 * 写中文会缺字（渲染成空白或者方块）。而按 Next 文档自己加载 ttf 字体，又会在
 * Vercel 上因为 process.cwd() 定位不到字体文件而 500。纯几何图形把两个坑一起绕开了。
 *
 * 图案：一个白圈 + 圆心一个实心点，像一只盘子。放到 48px 也还认得出。
 */

/** 和 app/globals.css 里的 --color-brand / --color-surface-2 保持一致 */
const BRAND = '#0f766e'
const MARK = '#ffffff'

export function dietIcon(size: number, { maskable = false }: { maskable?: boolean } = {}) {
  // maskable 图标会被 Android 裁成圆形或水滴形，安全区只有中间 80% 的圆，
  // 所以内容要缩得更小。普通图标（浏览器标签、iOS）没有被裁的风险，可以画大一点。
  const ratio = maskable ? 0.6 : 0.76
  const ring = Math.round(size * ratio)

  // 笔画粗细和圆心大小都按圈的大小成比例算 ——
  // 这样 180 和 512 两个尺寸看起来是同一张图，而不是一个粗一个细。
  const stroke = Math.max(1, Math.round(ring * 0.14))
  const dot = Math.round(ring * 0.28)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: BRAND,
        }}
      >
        <div
          style={{
            width: ring,
            height: ring,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            border: `${stroke}px solid ${MARK}`,
          }}
        >
          <div
            style={{
              width: dot,
              height: dot,
              display: 'flex',
              borderRadius: '50%',
              backgroundColor: MARK,
            }}
          />
        </div>
      </div>
    ),
    { width: size, height: size },
  )
}
