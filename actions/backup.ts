'use server'

/**
 * 从备份文件恢复数据（Server Action）。
 *
 * 这是整个应用里**唯一会删除用户数据**的地方，所以处理得比别处更谨慎：
 *
 *   1. **先整体校验，再动数据库**。校验（lib/backup.ts 的 parseBackup）在删除之前
 *      跑完，任何一个字段不合法就原样退回 —— 绝不出现「删完了才发现文件后半截坏了」。
 *   2. **必须显式勾选确认**。没有那个勾就不执行，防止手滑点中。
 *   3. **删除顺序固定**：meal_items → meals → foods。
 *      meal_items 对 foods 是 `on delete restrict`（数据库在保护「历史跟着食物变」
 *      这条规则），反过来删会被拦住。
 *   4. **id 全部重新生成**。文件里带着原 id，但那些行很可能还在原账户里躺着
 *      （换手机的场景：旧身份没被删，只是你再也没法登录它），照着原 id 插会撞主键。
 *      所以文件内部的 id 只用来表达「谁指向谁」，写库时整体换一套新 UUID。
 *   5. **分批写入**。一次 POST 上万行会让请求体过大、失败时报错也难懂。
 *      代价是中途失败会留下恢复了一半的数据 —— 所以错误信息里明说了「重新导入一次」，
 *      重新导入会从清空开始，天然可以重试。
 *
 * 没做「清空数据」按钮：恢复本身已经是「先清空再写入」，所以
 * 「导入同一个文件两次」的结果和导入一次完全相同，不需要额外的清空入口。
 */

import { randomUUID } from 'node:crypto'

import { revalidatePath } from 'next/cache'

import { MAX_BACKUP_BYTES, parseBackup } from '@/lib/backup'
import { TIMEZONE } from '@/lib/date'
import { createClient, requireUserId } from '@/lib/supabase/server'

export type RestoreState = { ok: boolean; message: string } | null

/** 一次插入多少行。见文件头第 5 条。 */
const INSERT_CHUNK = 1000

export async function restoreBackup(
  _prev: RestoreState,
  formData: FormData,
): Promise<RestoreState> {
  const userId = await requireUserId()

  // 只要求「这个字段有值」，不写死等于 'on' —— 勾选框没有 value 时浏览器发的就是 on，
  // 但将来给那个框加上 value="yes" 之类的话，写死 'on' 会让恢复静默失效
  const confirmed = formData.get('confirm')
  if (typeof confirmed !== 'string' || confirmed === '') {
    return { ok: false, message: '请先勾选下面的确认框 —— 恢复会覆盖当前的全部数据' }
  }

  const upload = formData.get('file')
  if (!(upload instanceof File) || upload.size === 0) {
    return { ok: false, message: '请选择要导入的备份文件（.json）' }
  }
  if (upload.size > MAX_BACKUP_BYTES) {
    return {
      ok: false,
      message: `这个文件有 ${formatBytes(upload.size)}，超过了 ${formatBytes(MAX_BACKUP_BYTES)} 的上限`,
    }
  }

  let raw: unknown
  try {
    raw = JSON.parse(await upload.text())
  } catch {
    return { ok: false, message: '这个文件不是合法的 JSON，可能没下载完整 —— 重新导出一次再试' }
  }

  const parsed = parseBackup(raw)
  if (!parsed.ok) return { ok: false, message: `备份文件有问题，没有动你的数据：${parsed.message}` }
  const file = parsed.file

  const supabase = await createClient()

  // ------------------------------------------------------------------ 清空
  // 顺序不能改，原因见文件头第 3 条
  for (const table of ['meal_items', 'meals', 'foods'] as const) {
    const { error } = await supabase.from(table).delete().eq('user_id', userId)
    if (error) {
      return {
        ok: false,
        message: `清空原有数据时就失败了（${table}），你的数据没有被动过：${error.message}`,
      }
    }
  }

  // ------------------------------------------------------------------ 资料
  // 备份里没有资料（profile: null）时写回默认值，而不是删掉那一行 ——
  // 应用各处都假设「每个用户恰好有一行资料」。
  const profile = file.profile ?? {
    heightCm: null,
    weightKg: null,
    age: null,
    gender: null,
    weeklyExerciseHours: 0,
    manualTdeeKj: null,
    deficitKj: 0,
    timezone: TIMEZONE,
  }

  const { error: profileError } = await supabase.from('user_profile').upsert(
    {
      user_id: userId,
      height_cm: profile.heightCm,
      weight_kg: profile.weightKg,
      age: profile.age,
      gender: profile.gender,
      weekly_exercise_hours: profile.weeklyExerciseHours,
      manual_tdee_kj: profile.manualTdeeKj,
      calorie_deficit_kj: profile.deficitKj,
      timezone: profile.timezone,
    },
    { onConflict: 'user_id' },
  )
  if (profileError) {
    return { ok: false, message: `恢复个人资料失败：${profileError.message}` }
  }

  // ------------------------------------------------------------------ 写入
  // 新旧 id 的对照表。文件内部的引用关系靠它翻译成写库时的新 UUID。
  const foodIds = new Map(file.foods.map((food) => [food.id, randomUUID()]))
  const mealIds = new Map(file.meals.map((meal) => [meal.id, randomUUID()]))

  const counts = { foods: 0, meals: 0, mealItems: 0 }

  // 食物必须先写：meal_items.food_id 是指向它的外键
  for (const batch of chunked(file.foods, INSERT_CHUNK)) {
    const { error } = await supabase.from('foods').insert(
      batch.map((food) => ({
        id: foodIds.get(food.id),
        user_id: userId,
        name: food.name,
        calories_kj_per_100g: food.energyKjPer100g,
        protein_g_per_100g: food.proteinGPer100g,
        carbs_g_per_100g: food.carbsGPer100g,
        fat_g_per_100g: food.fatGPer100g,
        archived_at: food.archivedAt,
        // 显式写 created_at：它决定条目在同一餐里的先后顺序（见 lib/backup.ts）
        created_at: food.createdAt,
      })),
    )
    if (error) return halfDone(counts, `写入食物失败：${error.message}`)
    counts.foods += batch.length
  }

  for (const batch of chunked(file.meals, INSERT_CHUNK)) {
    const { error } = await supabase.from('meals').insert(
      batch.map((meal) => ({
        id: mealIds.get(meal.id),
        user_id: userId,
        date: meal.date,
        name: meal.name,
        sort_order: meal.sortOrder,
        created_at: meal.createdAt,
      })),
    )
    if (error) return halfDone(counts, `写入餐次失败：${error.message}`)
    counts.meals += batch.length
  }

  for (const batch of chunked(file.mealItems, INSERT_CHUNK)) {
    const { error } = await supabase.from('meal_items').insert(
      batch.map((item) => ({
        id: randomUUID(),
        // user_id 其实会被数据库触发器按「这一餐属于谁」覆盖掉，这里显式带上只是双保险
        user_id: userId,
        meal_id: mealIds.get(item.mealId),
        food_id: foodIds.get(item.foodId),
        amount_g: item.amountG,
        created_at: item.createdAt,
      })),
    )
    if (error) return halfDone(counts, `写入饮食记录失败：${error.message}`)
    counts.mealItems += batch.length
  }

  revalidatePath('/', 'layout')

  const total = counts.foods + counts.meals + counts.mealItems
  if (total === 0) {
    return { ok: true, message: '已恢复：这个备份是空的，当前数据已被清空' }
  }
  return {
    ok: true,
    message: `已恢复 ${counts.foods} 个食物、${counts.meals} 个餐次、${counts.mealItems} 条饮食记录`,
  }
}

/** 中途失败：把已经写进去的数量告诉用户，并说明重新导入即可（重新导入会从清空开始） */
function halfDone(counts: Counts, message: string): RestoreState {
  const written = counts.foods + counts.meals + counts.mealItems
  return {
    ok: false,
    message:
      written === 0
        ? `恢复失败，你的数据已经被清空了：${message}`
        : `恢复失败，只写进去一部分（${written} 行）：${message}。再导入一次这个文件即可重新来一遍。`,
  }
}

type Counts = { foods: number; meals: number; mealItems: number }

function chunked<T>(rows: readonly T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < rows.length; i += size) batches.push(rows.slice(i, i + size))
  return batches
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} 字节`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
