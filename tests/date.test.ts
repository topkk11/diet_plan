import { describe, expect, it } from 'vitest'

import {
  addDays,
  formatDateLabel,
  isValidIsoDate,
  relativeDayLabel,
  todayIso,
  weekdayLabel,
} from '@/lib/date'

describe('todayIso 用固定时区取「今天」', () => {
  it('北京时间凌晨 0:30 属于新的一天，而不是 UTC 的前一天', () => {
    // UTC 时间 2026-10-04 16:30 = 北京时间 2026-10-05 00:30
    expect(todayIso(new Date('2026-10-04T16:30:00Z'))).toBe('2026-10-05')
  })

  it('北京时间晚上 23:30 仍属于当天', () => {
    expect(todayIso(new Date('2026-10-04T15:30:00Z'))).toBe('2026-10-04')
  })

  it('跨年的 UTC 零点也正确', () => {
    // UTC 2025-12-31 16:00 = 北京时间 2026-01-01 00:00
    expect(todayIso(new Date('2025-12-31T16:00:00Z'))).toBe('2026-01-01')
  })
})

describe('isValidIsoDate', () => {
  it('接受合法日期', () => {
    expect(isValidIsoDate('2026-10-05')).toBe(true)
    expect(isValidIsoDate('2024-02-29')).toBe(true) // 闰年
  })

  it('拒绝不存在的日期', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false)
    expect(isValidIsoDate('2025-02-29')).toBe(false) // 平年
  })

  it('拒绝格式不对的', () => {
    expect(isValidIsoDate('2026-1-5')).toBe(false)
    expect(isValidIsoDate('2026/10/05')).toBe(false)
    expect(isValidIsoDate('abc')).toBe(false)
  })
})

describe('addDays', () => {
  it('普通加减', () => {
    expect(addDays('2026-10-05', 1)).toBe('2026-10-06')
    expect(addDays('2026-10-05', -1)).toBe('2026-10-04')
  })

  it('跨月、跨年', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29') // 闰年
  })
})

describe('weekdayLabel', () => {
  it('2026-10-05 是周一', () => {
    expect(weekdayLabel('2026-10-05')).toBe('周一')
  })

  it('2026-10-04 是周日', () => {
    expect(weekdayLabel('2026-10-04')).toBe('周日')
  })
})

describe('formatDateLabel', () => {
  it('同年不带年份', () => {
    expect(formatDateLabel('2026-10-05', '2026-10-05')).toBe('10月5日 周一')
  })

  it('跨年带年份', () => {
    expect(formatDateLabel('2025-12-31', '2026-10-05')).toBe('2025年12月31日')
  })
})

describe('relativeDayLabel', () => {
  const TODAY = '2026-10-05'

  it('今天 / 昨天 / 明天', () => {
    expect(relativeDayLabel('2026-10-05', TODAY)).toBe('今天')
    expect(relativeDayLabel('2026-10-04', TODAY)).toBe('昨天')
    expect(relativeDayLabel('2026-10-06', TODAY)).toBe('明天')
  })

  it('更远的日期给出具体日期', () => {
    expect(relativeDayLabel('2026-09-01', TODAY)).toBe('9月1日 周二')
  })
})
