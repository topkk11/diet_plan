/**
 * 表单数字解析。
 *
 * 为什么需要这个文件：手机上用数字键盘输入时，中文输入法可能给出**全角**字符
 * （１２．５ 而不是 12.5），不处理的话 parseFloat 会直接返回 NaN，用户看到的是
 * 「输入了却没反应」。这里统一归一化后再解析。
 */

const FULLWIDTH_DIGITS = /[０-９]/g
/** 全角句点、表意句号 —— 中文输入法里打小数点很容易出这些 */
const FULLWIDTH_DOTS = /[．。]/g

/** 把全角数字和全角小数点转成半角，并去掉所有空白 */
export function normalizeNumericInput(raw: string): string {
  return raw
    .replace(FULLWIDTH_DIGITS, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(FULLWIDTH_DOTS, '.')
    .replace(/\s+/g, '')
}

/**
 * 解析成数字，失败返回 null。
 *
 * 逗号有两种互相冲突的含义，靠「逗号后面有几位数字」来区分：
 * - "0,5"     —— 后面 1 位 → 当**小数点** → 0.5
 * - "12,50"   —— 后面 2 位 → 当小数点 → 12.5（欧洲写法）
 * - "1,234"   —— 后面 3 位 → 当**千分位** → 1234
 * - "1,234.5" —— 已经有点了 → 逗号一律当千分位 → 1234.5
 *
 * 这个启发式的意义在于：如果把 "1,234" 当成小数点会得到 1.234（差 1000 倍），
 * 把 "0,5" 当成千分位会得到 5（差 10 倍）。两种都是静默的错误数据，必须区分。
 */
export function parseNumberInput(raw: string): number | null {
  let s = normalizeNumericInput(raw)
  if (s === '') return null

  const hasDot = s.includes('.')
  const commaCount = (s.match(/,/g) ?? []).length

  if (!hasDot && commaCount === 1) {
    const [intPart, fracPart = ''] = s.split(',')
    s = fracPart.length <= 2 ? `${intPart}.${fracPart}` : intPart + fracPart
  } else {
    s = s.replace(/,/g, '') // 当千分位
  }

  // 只接受纯数字（可带一个前导负号和一个点），避免 parseFloat 宽松解析 "12abc" → 12
  if (!/^-?\d*\.?\d*$/.test(s) || s === '.' || s === '-' || s === '-.') return null

  const value = Number(s)
  return Number.isFinite(value) ? value : null
}

/**
 * 解析成正数，失败或非正返回 null。表单上的克数、热量、营养素都用它。
 * @param max 上限，超出视为无效（防止手滑多打一个 0）
 */
export function parsePositiveNumber(raw: string, max = Number.MAX_SAFE_INTEGER): number | null {
  const value = parseNumberInput(raw)
  if (value === null || value <= 0) return null
  if (value > max) return null
  return value
}

/** 解析成非负数（允许 0，用于「缺口」这类可以为 0 的字段） */
export function parseNonNegativeNumber(raw: string, max = Number.MAX_SAFE_INTEGER): number | null {
  const value = parseNumberInput(raw)
  if (value === null || value < 0) return null
  if (value > max) return null
  return value
}

/**
 * 把从数据库读出来的值统一成 number。
 *
 * 为什么需要它：PostgREST 返回 numeric 列时可能是 number，也可能因为精度处理
 * 返回 string。如果不转，后面 `"150" * 2` 之类的地方会出诡异结果。
 * 非法值统一归 0，避免 NaN 传染整个汇总。
 */
export function asNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/**
 * 解析成整数（年龄、每周运动小时数这类）。
 * 非整数输入会四舍五入，因为用户可能顺手打了 "3.5 小时"。
 */
export function parseInteger(raw: string, max = Number.MAX_SAFE_INTEGER): number | null {
  const value = parseNumberInput(raw)
  if (value === null) return null
  const rounded = Math.round(value)
  if (rounded < 0 || rounded > max) return null
  return rounded
}
