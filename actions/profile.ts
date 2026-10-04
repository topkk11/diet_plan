'use server'

/**
 * 个人资料的写操作（Server Action）。
 *
 * 用 useActionState 驱动（不是 `<form action={fn.bind(...)}>`），因为这一页需要
 * **留在原地把错误逐格显示出来** —— 身高体重这种数字字段，跳走再跳回来会让用户
 * 不知道刚才哪一格填错了。代价是没有 JavaScript 时这条表单提交不了，
 * 但资料页本来就是低频操作，手机上不会没有 JavaScript。
 *
 * 顺带一提：`user_profile` 那一行是注册时由 handle_new_user() 触发器建好的，
 * 正常情况永远存在。这里仍然写成 upsert，是为了万一那次插入失败过也能自愈，
 * 而不是让用户对着一个永远保存不上的页面发呆。
 */

import { revalidatePath } from 'next/cache'

import {
  readProfileForm,
  validateProfileForm,
  type ProfileFormErrors,
} from '@/lib/profile-input'
import { createClient, requireUserId } from '@/lib/supabase/server'

export type ProfileFormState = {
  errors: ProfileFormErrors
  /** 顶部提示条文案 */
  message: string
  /** 是否保存成功 */
  saved: boolean
} | null

export async function saveProfile(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const userId = await requireUserId()

  const parsed = validateProfileForm(readProfileForm(formData))
  if (!parsed.ok) return { errors: parsed.errors, message: '', saved: false }

  const values = parsed.values
  const supabase = await createClient()

  const { error } = await supabase.from('user_profile').upsert(
    {
      user_id: userId,
      height_cm: values.heightCm,
      weight_kg: values.weightKg,
      age: values.age,
      gender: values.gender,
      weekly_exercise_hours: values.weeklyExerciseHours,
      manual_tdee_kj: values.manualTdeeKj,
      calorie_deficit_kj: values.deficitKj,
    },
    { onConflict: 'user_id' },
  )

  if (error) return { errors: {}, message: `保存失败：${error.message}`, saved: false }

  // 首页顶部那张汇总卡用的就是这里存的值，必须让客户端路由缓存失效，
  // 否则用户改完缺口回到首页还看到旧数字。
  revalidatePath('/', 'layout')

  return { errors: {}, message: '已保存', saved: true }
}
