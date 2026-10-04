import { describe, expect, it } from 'vitest'

import { safeInternalPath } from '@/lib/url'

describe('safeInternalPath 只放行站内路径', () => {
  it('正常站内路径放行', () => {
    expect(safeInternalPath('/foods')).toBe('/foods')
    expect(safeInternalPath('/?date=2026-10-05&pick=abc')).toBe('/?date=2026-10-05&pick=abc')
  })

  it('空值返回 null', () => {
    expect(safeInternalPath('')).toBeNull()
    expect(safeInternalPath(null)).toBeNull()
  })

  it('协议相对 URL 被拒（//evil.com 会被浏览器当成外部域名）', () => {
    expect(safeInternalPath('//evil.com')).toBeNull()
    expect(safeInternalPath('//evil.com/x')).toBeNull()
  })

  it('绝对 URL 被拒', () => {
    expect(safeInternalPath('https://evil.com')).toBeNull()
    expect(safeInternalPath('javascript:alert(1)')).toBeNull()
  })

  it('反斜杠被拒（有些浏览器把 \\ 当 /）', () => {
    expect(safeInternalPath('/\\evil.com')).toBeNull()
  })

  it('换行被拒（防响应头注入）', () => {
    expect(safeInternalPath('/foods\r\nSet-Cookie: x=1')).toBeNull()
  })
})
