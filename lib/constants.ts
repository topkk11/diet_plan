/** 全局常量。集中放在这里，方便后续自己调整。 */

/**
 * 没有任何历史记录时，新的一天用什么餐次结构。
 * 一旦你在某天改了餐次（改名 / 增删 / 排序），之后的新日期会复制最近那一天的结构，
 * 不再用这个默认值。
 */
export const DEFAULT_MEAL_TEMPLATE = ['早餐', '午餐', '晚餐', '加餐'] as const

/** 添加食物时，克数输入框的默认值 */
export const DEFAULT_AMOUNT_G = 100

/** 克数快捷增减按钮的步长 */
export const AMOUNT_STEPS = [10, 50] as const

/**
 * 改完克数后等多久自动保存（毫秒）。
 *
 * 太短：打「250」会发出 3 次请求，手机上白耗流量也白耗电。
 * 太长：放下手机前可能还没存上。
 * 600ms 大概是「手指离开键盘、眼睛还在看数字」的时间。
 */
export const AMOUNT_SAVE_DEBOUNCE_MS = 600

/**
 * 历史页最多回看多少天。
 *
 * 为什么要有上限：历史页要按天汇总热量，就得把窗口内每一条记录都读出来算一遍。
 * 不加限制的话，用了三年之后这一页会拖回几万行，手机上要等好几秒。
 * 45 天够看「这个月怎么样」；真要翻更早的日期，用首页的日期切换器。
 */
export const HISTORY_DAYS = 45

/**
 * 读历史时最多扫多少个**餐次行**（不是天数）。
 *
 * 一天按 8 餐算是个宽松的余量 —— 默认四餐，实际只会用到 180 行左右；
 * 360 是给「一天加了很多餐」留的。查不出这么多也不会更慢。
 */
export const HISTORY_MEAL_SCAN_LIMIT = HISTORY_DAYS * 8

/**
 * 食物与餐次表单允许的上限，防止手滑多打一个 0 导致荒唐数据进库
 * （与 SQL 里的 check 约束保持一致）。
 *
 * 资料页那几个字段的范围（身高/体重/年龄/运动时长/缺口）不在这里，
 * 而在 lib/profile-input.ts 的 PROFILE_RANGES —— 那里是**两端**都有约束的区间，
 * 塞进这个只有上限的表里会变成 `heightCm: 260, heightCmMin: 50` 这种读不懂的写法。
 */
export const LIMITS = {
  foodNameLength: 100,
  mealNameLength: 50,
  /** kJ / 100g 上限（≈48000 kcal/100g，纯油脂约 3700 kJ，留了充足余量） */
  energyKjPer100g: 200000,
  macroGPer100g: 1000,
  amountG: 20000,
} as const
