'use client'

/**
 * 食物录入 / 编辑表单。
 *
 * 几个针对手机做的决定：
 *
 * 1. 所有输入框是**受控**的（useState 保存原始字符串）。
 *    非受控的话，React 19 在 form action 跑完会把表单重置，用户辛苦打的一屏内容
 *    在「热量没填」这种小错上直接清空 —— 那是很气人的体验。受控就不受影响。
 *
 * 2. 输入框用 `type="text"` + `inputMode="decimal"`，**不用 `type="number"`**。
 *    type="number" 在手机上会挡住中文输入法、还有滚轮误触改值的毛病；
 *    inputMode 只负责弹出数字键盘，输入本身仍是文本，全角数字也能被 lib/num.ts 归一化。
 *
 * 3. 字号在 globals.css 里统一锁了 1rem（≥16px），否则 iOS Safari 点进输入框会自动放大页面。
 *
 * 4. 热量是唯一必填的数字项。它旁边的 kcal 换算是**边打边算**的，
 *    因为你手上的包装写的是 kJ，而你对 kcal 更有概念 —— 打的时候就看到才不用心算。
 */

import Link from 'next/link'
import { useActionState, useEffect, useState, type ReactNode } from 'react'

import { createFood, updateFood, type FoodFormState } from '@/actions/foods'
import { LIMITS } from '@/lib/constants'
import { EMPTY_FOOD_FORM, type FoodFormRaw } from '@/lib/food-input'
import { formatKcal } from '@/lib/format'
import { parseNumberInput } from '@/lib/num'

type Props =
  /** next：保存成功后跳回哪一页（站内路径）。只有「在选食物时现场新建」会带上它 */
  | { mode: 'create'; next?: string }
  | { mode: 'edit'; foodId: string; initial: FoodFormRaw }

export function FoodForm(props: Props) {
  const [form, setForm] = useState<FoodFormRaw>(
    props.mode === 'edit' ? props.initial : EMPTY_FOOD_FORM,
  )

  /*
   * 编辑模式必须用 `.bind(null, foodId)`，**不能**写成
   *   (prev, formData) => updateFood(foodId, prev, formData)
   * 这种箭头函数闭包。
   *
   * 原因：bind 出来的是一个「服务端函数引用 + 绑定参数」，React 能在服务端渲染时
   * 把它写进表单的隐藏字段，于是没有 JavaScript 也能提交；而箭头闭包只是个普通的
   * 客户端函数，React 渲不出引用 —— 表单就变成只能在浏览器里跑，
   * 而且直接 POST 会得到 500「Failed to find Server Action」。
   */
  const action =
    props.mode === 'edit' ? updateFood.bind(null, props.foodId) : createFood

  const [state, formAction, pending] = useActionState<FoodFormState, FormData>(action, null)

  // 「保存并继续添加下一个」走的是「不跳转 + 返回 saved: true」这条路，
  // 这里收到信号就把表单清空，光标还在名称框上，可以直接接着录。
  useEffect(() => {
    if (state?.saved) setForm(EMPTY_FOOD_FORM)
  }, [state])

  const set = (key: keyof FoodFormRaw) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const errors = state?.errors ?? {}

  // 边打边算：只在这一格能解析出数字时才显示
  const parsedEnergy = parseNumberInput(form.energyKj)
  const energyPreview =
    parsedEnergy !== null && parsedEnergy >= 0 ? formatKcal(parsedEnergy) : null

  return (
    <form action={formAction} className="space-y-4">
      {props.mode === 'create' && props.next ? (
        <input type="hidden" name="next" value={props.next} />
      ) : null}

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

      <Field label="食物名称" error={errors.name}>
        <input
          name="name"
          value={form.name}
          onChange={(e) => set('name')(e.target.value)}
          maxLength={LIMITS.foodNameLength}
          placeholder="比如：伊利纯牛奶"
          autoComplete="off"
          autoFocus={props.mode === 'create'}
          enterKeyHint="next"
          className={inputClass(errors.name)}
        />
      </Field>

      <Field
        label="热量"
        suffix="kJ / 100g"
        error={errors.energyKj}
        hint={energyPreview ? `≈ ${energyPreview} / 100g` : '直接抄包装上的「能量」那一行'}
      >
        <input
          name="energyKj"
          value={form.energyKj}
          onChange={(e) => set('energyKj')(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="next"
          placeholder="1234"
          className={inputClass(errors.energyKj)}
        />
      </Field>

      <fieldset className="rounded-card border border-line bg-surface p-4">
        <legend className="px-1 text-sm font-medium">三大营养素（每 100g）</legend>
        <p className="mb-3 text-xs text-ink-faint">
          包装上没有、或者你不想记，留空就行（按 0 算）。
        </p>
        <div className="grid grid-cols-3 gap-2">
          <MacroField
            name="proteinG"
            label="蛋白质"
            value={form.proteinG}
            onChange={set('proteinG')}
            error={errors.proteinG}
          />
          <MacroField
            name="carbsG"
            label="碳水"
            value={form.carbsG}
            onChange={set('carbsG')}
            error={errors.carbsG}
          />
          <MacroField
            name="fatG"
            label="脂肪"
            value={form.fatG}
            onChange={set('fatG')}
            error={errors.fatG}
          />
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="min-h-12 rounded-card bg-brand px-4 text-base font-medium text-white disabled:opacity-60"
        >
          {pending ? '保存中…' : props.mode === 'edit' ? '保存修改' : '保存'}
        </button>

        {props.mode === 'create' ? (
          <button
            type="submit"
            name="intent"
            value="another"
            disabled={pending}
            className="min-h-12 rounded-card border border-brand bg-surface px-4 text-base font-medium text-brand disabled:opacity-60"
          >
            保存并继续添加下一个
          </button>
        ) : (
          <Link
            href="/foods"
            className="flex min-h-12 items-center justify-center rounded-card border border-line bg-surface px-4 text-base text-ink-soft"
          >
            取消
          </Link>
        )}
      </div>
    </form>
  )
}

/** 输入框外观。有错时描红，让「哪一格错了」一眼可见 */
function inputClass(error?: string): string {
  return `w-full rounded-lg border px-3 py-2.5 text-base outline-none ${
    error ? 'border-over bg-over/5' : 'border-line bg-surface-2 focus:border-brand'
  }`
}

function Field({
  label,
  suffix,
  hint,
  error,
  children,
}: {
  label: string
  suffix?: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {suffix ? <span className="text-xs text-ink-faint">{suffix}</span> : null}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-over">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-faint">{hint}</span>
      ) : null}
    </label>
  )
}

/** 三大营养素共用的小输入框（横向三格排开，一屏就能填完） */
function MacroField({
  name,
  label,
  value,
  onChange,
  error,
}: {
  name: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-ink-soft">{label}</span>
      <input
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="next"
        placeholder="0"
        className={`${inputClass(error)} text-center`}
      />
      <span className="mt-1 block text-right text-[11px] text-ink-faint">g</span>
    </label>
  )
}
