-- ============================================================================
-- 饮食计划监测工作台 —— 初始化迁移
--
-- 用法：整段复制到 Supabase Dashboard → SQL Editor → New query → Run。
-- 幂等：可以重复执行，不会重复建表或报错。
--
-- 安全模型（重要）：
--   应用使用 Supabase **匿名登录**，没有登录界面。匿名用户在数据库看来是一个
--   真实的 authenticated 角色用户，有真实 UUID，所以下面每条 RLS 策略里的
--   auth.uid() = user_id 都照常生效 —— 你的数据只有你能读写。
--   陌生人打开网址只会得到他自己的空账户，看不到你的任何数据。
--   注意区分：authenticated（登录后角色，匿名用户也属于它）与 anon（未登录角色）。
--   本文件把 anon 角色的权限显式收回，所以没有会话的请求一行数据都读不到。
--
-- 能量单位约定：全库以 **kJ** 为唯一真相（用户输入的就是 kJ/100g），
--   kcal 只在界面上由 kJ 派生显示（1 kcal = 4.184 kJ）。
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. 扩展
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";  -- gen_random_uuid()
create extension if not exists "pg_trgm";   -- 食物名模糊搜索用


-- ---------------------------------------------------------------------------
-- 1. updated_at 自动维护
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. user_profile —— 与 auth.users 一对一
-- ---------------------------------------------------------------------------
create table if not exists public.user_profile (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique references auth.users(id) on delete cascade,

  -- 身体数据。允许为空：允许用户先只设 TDEE，之后再补身体数据
  height_cm             numeric(5,1) check (height_cm is null or (height_cm between 50 and 260)),
  weight_kg             numeric(5,1) check (weight_kg is null or (weight_kg between 20 and 400)),
  age                   integer      check (age is null or (age between 10 and 120)),
  gender                text         check (gender is null or gender in ('male','female')),
  weekly_exercise_hours numeric(4,1) not null default 0
                        check (weekly_exercise_hours between 0 and 80),

  -- 手动覆盖的 TDEE。为空或 0 时回落到公式估算值
  manual_tdee_kj        numeric(10,2) check (manual_tdee_kj is null or manual_tdee_kj >= 0),
  -- 每日热量缺口（kJ）
  calorie_deficit_kj    numeric(10,2) not null default 0
                        check (calorie_deficit_kj between 0 and 50000),

  -- 决定「今天是几号」。服务端算日期时用它，避免部署在 UTC 机器上把晚上的记录算到前一天
  timezone              text not null default 'Asia/Shanghai',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists user_profile_set_updated_at on public.user_profile;
create trigger user_profile_set_updated_at
  before update on public.user_profile
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 3. foods —— 个人食物库
-- ---------------------------------------------------------------------------
create table if not exists public.foods (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  name                 text not null check (char_length(btrim(name)) between 1 and 100),

  -- 营养数据一律按「每 100g」记，用 numeric 而不是 float，避免浮点误差进库
  calories_kj_per_100g numeric(10,2) not null default 0
                       check (calories_kj_per_100g between 0 and 200000),
  protein_g_per_100g   numeric(6,2)  not null default 0
                       check (protein_g_per_100g between 0 and 1000),
  carbs_g_per_100g     numeric(6,2)  not null default 0
                       check (carbs_g_per_100g between 0 and 1000),
  fat_g_per_100g       numeric(6,2)  not null default 0
                       check (fat_g_per_100g between 0 and 1000),

  -- 归档标记。已经出现在历史记录里的食物不允许真删除（否则历史会缺一块），
  -- 改成归档：从食物库列表和选择器里隐藏，但历史记录照常显示并继续联动它的营养值。
  archived_at          timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists foods_set_updated_at on public.foods;
create trigger foods_set_updated_at
  before update on public.foods
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 4. meals —— 某一天里的一个餐次（早餐/午餐/…）
--    故意不加 (user_id, date, name) 唯一约束：用户可能想要两个「加餐」
-- ---------------------------------------------------------------------------
create table if not exists public.meals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  date       date not null,
  name       text not null check (char_length(btrim(name)) between 1 and 50),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 5. meal_items —— 餐次里的一个食物条目
--
--    设计决定（用户已确认）：**只存 food_id 链接，不存营养快照**。
--    也就是「历史跟着食物变」—— 以后修正某个食物的热量，所有历史记录一起更新。
--    代价是食物不能被真删除，所以 foods 有 archived_at，且这里用 on delete restrict
--    作为数据库层的最后一道防线（删不掉，而不是悄悄删掉历史）。
-- ---------------------------------------------------------------------------
create table if not exists public.meal_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  meal_id    uuid not null references public.meals(id) on delete cascade,
  food_id    uuid not null references public.foods(id) on delete restrict,
  amount_g   numeric(8,2) not null default 100 check (amount_g > 0 and amount_g <= 20000),
  created_at timestamptz not null default now()
);

-- 防越权：user_id 一律从父 meals 派生，客户端传什么都不信
create or replace function public.meal_items_set_user_id()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select m.user_id into v_owner from public.meals m where m.id = new.meal_id;
  if v_owner is null then
    -- 餐次不存在，或者不属于当前用户（RLS 让它查不到）
    raise exception 'meal % not found or not owned by current user', new.meal_id
      using errcode = 'foreign_key_violation';
  end if;
  new.user_id := v_owner;
  return new;
end;
$$;

drop trigger if exists meal_items_set_user_id on public.meal_items;
create trigger meal_items_set_user_id
  before insert or update of meal_id on public.meal_items
  for each row execute function public.meal_items_set_user_id();


-- ---------------------------------------------------------------------------
-- 6. 索引
-- ---------------------------------------------------------------------------
create index if not exists foods_user_name_idx
  on public.foods (user_id, lower(name)) where archived_at is null;

-- 食物名模糊搜索（手机端输入「牛奶」要能命中「伊利牛奶」）
create index if not exists foods_name_trgm_idx
  on public.foods using gin (name gin_trgm_ops);

create index if not exists meals_user_date_sort_idx
  on public.meals (user_id, date desc, sort_order);

create index if not exists meal_items_meal_idx
  on public.meal_items (meal_id, created_at);

create index if not exists meal_items_user_idx
  on public.meal_items (user_id);

create index if not exists meal_items_food_idx
  on public.meal_items (food_id);


-- ---------------------------------------------------------------------------
-- 7. 权限：显式收回 anon，显式授予 authenticated
--    即使 RLS 已经能挡住匿名请求，这里也显式收一遍，作为纵深防御
-- ---------------------------------------------------------------------------
revoke all on public.user_profile, public.foods, public.meals, public.meal_items from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete
  on public.user_profile, public.foods, public.meals, public.meal_items
  to authenticated;


-- ---------------------------------------------------------------------------
-- 8. RLS —— 四张表全部启用，策略一律 auth.uid() = user_id
--    用 (select auth.uid()) 包一层：让 Postgres 走 InitPlan 只求值一次，
--    否则会对每一行都调用一次 auth.uid()，数据量大时明显变慢。
-- ---------------------------------------------------------------------------
alter table public.user_profile enable row level security;
alter table public.foods        enable row level security;
alter table public.meals        enable row level security;
alter table public.meal_items   enable row level security;

-- user_profile
drop policy if exists user_profile_select_own on public.user_profile;
create policy user_profile_select_own on public.user_profile
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists user_profile_insert_own on public.user_profile;
create policy user_profile_insert_own on public.user_profile
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists user_profile_update_own on public.user_profile;
create policy user_profile_update_own on public.user_profile
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_profile_delete_own on public.user_profile;
create policy user_profile_delete_own on public.user_profile
  for delete to authenticated using ((select auth.uid()) = user_id);

-- foods
drop policy if exists foods_select_own on public.foods;
create policy foods_select_own on public.foods
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists foods_insert_own on public.foods;
create policy foods_insert_own on public.foods
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists foods_update_own on public.foods;
create policy foods_update_own on public.foods
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists foods_delete_own on public.foods;
create policy foods_delete_own on public.foods
  for delete to authenticated using ((select auth.uid()) = user_id);

-- meals
drop policy if exists meals_select_own on public.meals;
create policy meals_select_own on public.meals
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists meals_insert_own on public.meals;
create policy meals_insert_own on public.meals
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists meals_update_own on public.meals;
create policy meals_update_own on public.meals
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists meals_delete_own on public.meals;
create policy meals_delete_own on public.meals
  for delete to authenticated using ((select auth.uid()) = user_id);

-- meal_items
drop policy if exists meal_items_select_own on public.meal_items;
create policy meal_items_select_own on public.meal_items
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists meal_items_insert_own on public.meal_items;
create policy meal_items_insert_own on public.meal_items
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists meal_items_update_own on public.meal_items;
create policy meal_items_update_own on public.meal_items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists meal_items_delete_own on public.meal_items;
create policy meal_items_delete_own on public.meal_items
  for delete to authenticated using ((select auth.uid()) = user_id);


-- ---------------------------------------------------------------------------
-- 9. 新用户（含匿名用户）自动建 profile 行
--    security definer：以函数属主身份运行，绕过 RLS —— 因为触发时机在
--    用户刚被创建、还没有任何会话上下文的时候
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profile (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- 10. ensure_day_meals —— 打开某一天时自动补齐餐次结构
--
--    规则（用户已确认）：该天已有餐次 → 直接用；否则复制「最近一个有记录的日期」
--    的餐次名称与顺序；完全没有历史 → 用默认四餐。
--
--    为什么做成数据库函数而不是在 TS 里写「查→判断→插」三步：
--    三步之间可能被并发插入打断，产生重复餐次。这里一次往返、天然幂等。
--    security invoker：RLS 照常生效，不会越权读到别人的数据。
-- ---------------------------------------------------------------------------
create or replace function public.ensure_day_meals(p_date date)
returns setof public.meals
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_src  date;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- 已经有餐次了，直接返回（这就是幂等点）
  if exists (select 1 from public.meals where user_id = v_user and date = p_date) then
    return query
      select * from public.meals
      where user_id = v_user and date = p_date
      order by sort_order, created_at;
    return;
  end if;

  -- 找最近一个早于 p_date 且有餐次的日期
  select max(m.date) into v_src
  from public.meals m
  where m.user_id = v_user and m.date < p_date;

  if v_src is not null then
    -- 复制那一天的餐次结构（只复制名称和顺序，不复制食物条目）
    insert into public.meals (user_id, date, name, sort_order)
    select v_user, p_date, m.name, m.sort_order
    from public.meals m
    where m.user_id = v_user and m.date = v_src
    order by m.sort_order, m.created_at;
  else
    -- 完全没有历史 → 默认四餐
    insert into public.meals (user_id, date, name, sort_order) values
      (v_user, p_date, '早餐', 0),
      (v_user, p_date, '午餐', 1),
      (v_user, p_date, '晚餐', 2),
      (v_user, p_date, '加餐', 3);
  end if;

  return query
    select * from public.meals
    where user_id = v_user and date = p_date
    order by sort_order, created_at;
end;
$$;

grant execute on function public.ensure_day_meals(date) to authenticated;
revoke execute on function public.ensure_day_meals(date) from anon;


-- ---------------------------------------------------------------------------
-- 11. 让 PostgREST 立刻感知新表（否则可能要等一会儿才能查询）
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
