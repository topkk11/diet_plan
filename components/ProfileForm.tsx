'use client'

/**
 * 资料表单：身体数据 → BMR/TDEE → 手动覆盖 → 热量缺口。
 *
 * 三个针对手机/自用的决定：
 *
 * 1. **所有输入框受控**（useState 存原始字符串）。React 19 在 form action 跑完后会重置
 *    非受控表单，用户在「年龄」上打错一个字就丢掉一整屏，那是很气人的。
 *
 * 2. **TDEE 是边打边算的**。身高体重改一个数字，下面的 BMR/系数/TDEE 立刻跟着动 ——
 *    因为这套公式本来就是估算，能当场看到「改了体重 TDEE 差多少」比看结论更有用。
 *    算用的是 lib/tdee.ts 里和服务端**同一个**纯函数，不会出现前后不一致。
 *
 * 3. **活动系数那张表一直摊开着**，当前档位高亮。它是估算里最不靠谱的一环，
 *    与其藏起来假装精确，不如让用户看见自己落在哪一档、以及下一档要多少小时。
 *
 * 校验只显示**服务端返回的**错误：边打字边报「身高要填 50 到 260」是在骂正在输入的人。
 */

import { useActionState, useState } from 'react'

import { saveProfile, type ProfileFormState } from '@/actions/profile'
import { formatEnergyBoth, formatKcalValue, formatKj } from '@/lib/format'
import { kcalToKj, kjToKcal } from '@/lib/nutrition'
import { parseNumberInput } from '@/lib/num'
import {
  budgetWarning,
  parseProfileValues,
  toTdeeInput,
  type ProfileFormRaw,
} from '@/lib/profile-input'
import { ACTIVITY_BANDS, activityBand, calcTdee } from '@/lib/tdee'

const GENDERS = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
] as const

export function ProfileForm({ initial }: { initial: ProfileFormRaw }) {
  const [form, setForm] = useState(initial)
  const [state, formAction, pending] = useActionState<ProfileFormState, FormData>(saveProfile, null)

  const set = (key: keyof ProfileFormRaw) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const errors = state?.errors ?? {}

  // 边打边算这条路是**宽松**的：越界的字段当成没填，只是算不出 TDEE，不弹错
  const values = parseProfileValues(form)
  const tdeeInput = toTdeeInput(values)
  const tdee = calcTdee(tdeeInput, values.manualTdeeKj)
  // 手动值存在时，顺便算出「不覆盖会是多少」，让用户知道自己在偏离公式多远
  const formulaTdee = tdeeInput ? calcTdee(tdeeInput, null) : null
  const currentBand = activityBand(values.weeklyExerciseHours)

  const warning = budgetWarning(values.deficitKj, tdee?.tdeeKj ?? null)

  return (
    <form action={formAction} className="space-y-4">
      {state?.message ? (
        <p
          aria-live="polite"
          className={`rounded-card border px-3 py-2 text-sm ${
            state.saved
              ? 'border-good/30 bg-good/10 text-good'
              : 'border-over/30 bg-over/10 text-over'
          }`}
        >
          {state.message}
        </p>
      ) : null}

      {/* ---------------------------------------------------------------- 身体数据 */}
      <fieldset className="rounded-card border border-line bg-surface p-4">
        <legend className="px-1 text-sm font-medium">身体数据</legend>
        <p className="mb-3 text-xs text-ink-faint">
          只用来估算消耗，随便填多少都不影响已经记录的数据。留着不填也行，那就直接手填 TDEE。
        </p>

        <div className="mb-3">
          <span className="mb-1 block text-sm font-medium">性别</span>
          <div className="flex gap-2">
            {GENDERS.map((option) => {
              const active = form.gender === option.value
              return (
                <label
                  key={option.value}
                  className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-lg border text-sm focus-within:ring-2 focus-within:ring-brand/40 ${
                    active
                      ? 'border-brand bg-brand/10 font-medium text-brand'
                      : 'border-line bg-surface-2 text-ink-soft'
                  }`}
                >
                  <input
                    type="radio"
                    name="gender"
                    value={option.value}
                    checked={active}
                    onChange={() => set('gender')(option.value)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              )
            })}
          </div>
          {errors.gender ? <ErrorText>{errors.gender}</ErrorText> : null}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <TextField
            name="heightCm"
            label="身高"
            unit="cm"
            value={form.heightCm}
            onChange={set('heightCm')}
            error={errors.heightCm}
            placeholder="175"
          />
          <TextField
            name="weightKg"
            label="体重"
            unit="kg"
            value={form.weightKg}
            onChange={set('weightKg')}
            error={errors.weightKg}
            placeholder="70"
          />
          <TextField
            name="age"
            label="年龄"
            unit="岁"
            value={form.age}
            onChange={set('age')}
            error={errors.age}
            placeholder="30"
          />
        </div>

        <div className="mt-3">
          <TextField
            name="weeklyExerciseHours"
            label="每周运动时长"
            unit="小时"
            value={form.weeklyExerciseHours}
            onChange={set('weeklyExerciseHours')}
            error={errors.weeklyExerciseHours}
            placeholder="0"
            hint="快走、跑步、力量训练都算进去，估个大概就行"
            enterKeyHint="done"
          />
        </div>
      </fieldset>

      {/* ---------------------------------------------------------- 自动算出的 TDEE */}
      <section className="rounded-card border border-line bg-surface p-4">
        <h2 className="text-sm font-medium">自动估算</h2>

        {tdee === null ? (
          <p className="mt-2 text-sm text-ink-soft">
            把上面四项填齐（或者直接手填下面的 TDEE），这里就会显示估算值。
          </p>
        ) : (
          <>
            <dl className="mt-2 divide-y divide-line text-sm">
              {tdeeInput ? (
                <>
                  <Row label="基础代谢 BMR" value={formatKcalValue(tdee.bmrKcal)} />
                  <Row
                    label={`活动系数（${tdee.activityLabel}）`}
                    value={String(tdee.activityFactor)}
                  />
                </>
              ) : null}
              <Row
                label="每日总消耗 TDEE"
                value={formatEnergyBoth(tdee.tdeeKj)}
                strong
                badge={tdee.isEstimated ? null : '手动覆盖'}
              />
            </dl>

            {!tdee.isEstimated && formulaTdee ? (
              <p className="mt-2 text-xs text-ink-faint">
                按公式算是 {formatEnergyBoth(formulaTdee.tdeeKj)}。清空下面的 TDEE 就回到它。
              </p>
            ) : null}
            {!tdee.isEstimated && !formulaTdee ? (
              <p className="mt-2 text-xs text-ink-faint">
                身体数据没填齐，所以只有手填的这一个值。填齐后这里会显示公式估算是多少。
              </p>
            ) : null}
          </>
        )}

        <table className="mt-3 w-full text-xs">
          <caption className="sr-only">每周运动时长与活动系数对照表</caption>
          <thead>
            <tr className="text-left text-ink-faint">
              <th scope="col" className="pb-1 font-normal">
                每周运动
              </th>
              <th scope="col" className="pb-1 font-normal">
                档位
              </th>
              <th scope="col" className="pb-1 text-right font-normal">
                系数
              </th>
            </tr>
          </thead>
          <tbody>
            {ACTIVITY_BANDS.map((band) => {
              const active = band.factor === currentBand.factor
              return (
                <tr key={band.factor} className={active ? 'text-brand' : 'text-ink-soft'}>
                  <td className="py-0.5 tabular-nums">{band.hint.replace('每周运动 ', '')}</td>
                  <td className="py-0.5">
                    {band.label}
                    {active ? ' ←' : ''}
                  </td>
                  <td className="py-0.5 text-right tabular-nums">{band.factor}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="mt-1 text-[11px] text-ink-faint">
          系数是估算，不是精确值。觉得不准就在下面手填一个 TDEE。
        </p>
      </section>

      {/* ------------------------------------------------------------- 目标与缺口 */}
      <fieldset className="rounded-card border border-line bg-surface p-4">
        <legend className="px-1 text-sm font-medium">目标</legend>

        <TextField
          name="manualTdeeKj"
          label="手动指定 TDEE"
          unit="kJ"
          value={form.manualTdeeKj}
          onChange={set('manualTdeeKj')}
          error={errors.manualTdeeKj}
          placeholder="留空 = 用上面的估算值"
          hint="留空就用自动估算；填 0 也等于留空"
          preview={kcalPreview(form.manualTdeeKj)}
        />

        <div className="mt-3">
          {/*
            这一格填的是 kcal，和上面的 TDEE 不一样 —— 因为缺口是「我们自己定的目标」，
            没有食品标签可抄，而减脂的说法本来就是「每天少吃 500 大卡」。
            下面实时把等价的 kJ 显示出来，免得和别处的单位对不上时一头雾水。
          */}
          <TextField
            name="deficitKcal"
            label="每日热量缺口"
            unit="kcal"
            value={form.deficitKcal}
            onChange={set('deficitKcal')}
            error={errors.deficitKcal}
            placeholder="0"
            hint="目标摄入 = TDEE − 缺口。不减脂就填 0，减脂一般 300–500"
            preview={kjPreview(form.deficitKcal)}
            enterKeyHint="done"
          />
        </div>

        {warning ? (
          <p className="mt-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            {warning}
          </p>
        ) : null}

        {tdee ? (
          <p className="mt-3 text-xs text-ink-soft">
            目标摄入 = {formatEnergyBoth(tdee.tdeeKj)} − {formatEnergyBoth(values.deficitKj)} ={' '}
            <span className="font-medium text-ink">
              {formatEnergyBoth(tdee.tdeeKj - values.deficitKj)}
            </span>
          </p>
        ) : null}
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="min-h-12 w-full rounded-card bg-brand px-4 text-base font-medium text-white disabled:opacity-60"
      >
        {pending ? '保存中…' : '保存'}
      </button>

      <p className="text-xs text-ink-faint">
        改完记得保存。首页顶部的「还能吃」用的就是这里的 TDEE 和缺口。
      </p>
    </form>
  )
}

/**
 * kJ 输入框旁边的 kcal 预览 —— 「填 2000 kJ 到底是多吃还是少吃」得当场看得见。
 * 留空或填了非法值时返回 null（那时候不显示预览，也不该弹错）。
 */
function kcalPreview(raw: string): string | null {
  const kj = parseNumberInput(raw)
  if (kj === null || kj <= 0) return null
  return `≈ ${formatKcalValue(kjToKcal(kj))}`
}

/**
 * 反过来那一个：**kcal** 输入框旁边的 kJ 预览（只有「热量缺口」那一格用到）。
 *
 * 两个方向各写一个函数而不是加个参数开关：哪个是输入、哪个是输出，
 * 光看函数名就清楚，调用处也不用回去数一遍参数。
 */
function kjPreview(raw: string): string | null {
  const kcal = parseNumberInput(raw)
  if (kcal === null || kcal <= 0) return null
  return `≈ ${formatKj(kcalToKj(kcal))}`
}

function Row({
  label,
  value,
  strong,
  badge,
}: {
  label: string
  value: string
  strong?: boolean
  badge?: string | null
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-ink-soft">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-medium' : ''}`}>
        {value}
        {badge ? (
          <span className="ml-1.5 rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-normal text-brand">
            {badge}
          </span>
        ) : null}
      </dd>
    </div>
  )
}

function ErrorText({ children }: { children: string }) {
  return <span className="mt-1 block text-xs text-over">{children}</span>
}

function TextField({
  name,
  label,
  unit,
  value,
  onChange,
  error,
  placeholder,
  hint,
  preview,
  enterKeyHint = 'next',
}: {
  name: string
  label: string
  unit: string
  value: string
  onChange: (value: string) => void
  error?: string
  placeholder?: string
  hint?: string
  preview?: string | null
  enterKeyHint?: 'next' | 'done'
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-ink-faint">{unit}</span>
      </span>
      <input
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        // 用 text + inputMode，不用 type="number"：后者会挡住中文输入法、还容易被滚轮误改
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint={enterKeyHint}
        placeholder={placeholder}
        className={`w-full rounded-lg border px-3 py-2.5 text-base outline-none ${
          error ? 'border-over bg-over/5' : 'border-line bg-surface-2 focus:border-brand'
        }`}
      />
      {error ? (
        <ErrorText>{error}</ErrorText>
      ) : preview ? (
        <span className="mt-1 block text-xs text-brand">{preview}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-faint">{hint}</span>
      ) : null}
    </label>
  )
}
