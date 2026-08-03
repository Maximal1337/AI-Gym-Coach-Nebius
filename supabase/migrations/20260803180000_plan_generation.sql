-- AI-generated training plans (System Design §21).
--
-- fitness_profiles: self-reported intake facts (goal/experience/days plus
-- optional gender/age/weight/height/injury notes) collected once during the
-- generation flow and reused if the user regenerates or adds another plan
-- later. Written exclusively by the plan-generate Edge Function
-- (service_role) — same "one choke point" discipline as every other table
-- that isn't pure persona flavor text (contrast coach_profiles, which IS
-- fully client-writable).
create table public.fitness_profiles (
  user_id uuid primary key references public.users (id) on delete cascade,
  primary_goal text not null check (
    primary_goal in ('strength', 'hypertrophy', 'general_fitness', 'fat_loss')
  ),
  experience_level text not null check (
    experience_level in ('beginner', 'intermediate', 'advanced')
  ),
  days_per_week int not null check (days_per_week between 2 and 6),
  gender text check (gender in ('male', 'female', 'other')),
  age int check (age between 10 and 100),
  weight_kg numeric(5, 1) check (weight_kg between 20 and 400),
  height_cm numeric(5, 1) check (height_cm between 100 and 250),
  injury_notes text,
  updated_at timestamptz not null default now()
);

alter table public.fitness_profiles enable row level security;

create policy fitness_profiles_select_own on public.fitness_profiles
  for select to authenticated using (user_id = (select auth.uid()));

-- common_exercises: a small, hand-curated seed list (System Design §21) —
-- NOT a knowledge source for the model (it already knows these exercises
-- cold), it exists so the plan-quality linter has real ground truth to
-- check a generated plan's exercise names against (movement-pattern
-- coverage, muscle balance). A starter set spanning the common patterns,
-- meant to grow over time — public reference data, identical for every
-- user, so it's a plain read-all table with no per-row ownership.
create table public.common_exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  muscle_group text not null,
  movement_pattern text not null check (
    movement_pattern in ('push', 'pull', 'squat', 'hinge', 'lunge', 'core', 'isolation')
  ),
  equipment_type text not null check (
    equipment_type in ('barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other')
  ),
  is_compound boolean not null default false
);

alter table public.common_exercises enable row level security;

create policy common_exercises_select_all on public.common_exercises
  for select to authenticated using (true);

insert into public.common_exercises (name, muscle_group, movement_pattern, equipment_type, is_compound) values
  ('לחיצת חזה במכונה', 'chest', 'push', 'machine', false),
  ('לחיצת חזה עם מוט', 'chest', 'push', 'barbell', true),
  ('לחיצת חזה עם משקולות', 'chest', 'push', 'dumbbell', true),
  ('לחיצת חזה בשיפוע חיובי עם משקולות', 'chest', 'push', 'dumbbell', true),
  ('פרפר בכבלים', 'chest', 'push', 'cable', false),
  ('שכיבות שמיכה', 'chest', 'push', 'bodyweight', true),
  ('לחיצת כתפיים בישיבה עם מוט', 'shoulders', 'push', 'barbell', true),
  ('לחיצת כתפיים עם משקולות', 'shoulders', 'push', 'dumbbell', true),
  ('הרחקת כתפיים לצד עם משקולות', 'shoulders', 'isolation', 'dumbbell', false),
  ('פשיטת מרפקים בפולי', 'triceps', 'isolation', 'cable', false),
  ('פשיטת מרפקים מעל הראש עם משקולת', 'triceps', 'isolation', 'dumbbell', false),
  ('מקבילים', 'chest', 'push', 'bodyweight', true),
  ('משיכת פולי עליון', 'back', 'pull', 'cable', true),
  ('מתח', 'back', 'pull', 'bodyweight', true),
  ('חתירה עם מוט', 'back', 'pull', 'barbell', true),
  ('חתירה עם משקולת חד-יד', 'back', 'pull', 'dumbbell', true),
  ('חתירה בישיבה בכבל', 'back', 'pull', 'cable', true),
  ('כפיפת מרפקים עם מוט', 'biceps', 'isolation', 'barbell', false),
  ('כפיפת מרפקים עם משקולות', 'biceps', 'isolation', 'dumbbell', false),
  ('כפיפת מרפקים בפטיש', 'biceps', 'isolation', 'dumbbell', false),
  ('כפיפת מרפקים בכבל', 'biceps', 'isolation', 'cable', false),
  ('סקוואט עם מוט', 'legs', 'squat', 'barbell', true),
  ('סקוואט גובלט עם משקולת', 'legs', 'squat', 'dumbbell', true),
  ('לחיצת רגליים', 'legs', 'squat', 'machine', true),
  ('פשיטת ברכיים במכונה', 'legs', 'isolation', 'machine', false),
  ('מדרגות עם משקולות', 'legs', 'lunge', 'dumbbell', true),
  ('דדליפט עם מוט', 'back', 'hinge', 'barbell', true),
  ('דדליפט רומני עם מוט', 'hamstrings', 'hinge', 'barbell', true),
  ('דדליפט רומני עם משקולות', 'hamstrings', 'hinge', 'dumbbell', true),
  ('הרמת אגן עם מוט', 'glutes', 'hinge', 'barbell', true),
  ('כפיפת ברכיים במכונה', 'hamstrings', 'isolation', 'machine', false),
  ('גב תחתון במכונה', 'lower_back', 'hinge', 'machine', false),
  ('לאנג׳ עם משקולות', 'legs', 'lunge', 'dumbbell', true),
  ('לאנג׳ עם מוט', 'legs', 'lunge', 'barbell', true),
  ('לאנג׳ בהליכה עם משקולות', 'legs', 'lunge', 'dumbbell', true),
  ('פלאנק', 'core', 'core', 'bodyweight', false),
  ('כפיפות בטן', 'core', 'core', 'bodyweight', false),
  ('הרמות רגליים תלויות', 'core', 'core', 'bodyweight', false),
  ('פיתול רוסי עם משקולת', 'core', 'core', 'dumbbell', false),
  ('גלגלת בטן', 'core', 'core', 'bodyweight', false),
  ('עמידה על קצות אצבעות בעמידה', 'calves', 'isolation', 'machine', false),
  ('עמידה על קצות אצבעות בישיבה', 'calves', 'isolation', 'machine', false),
  ('כתף אחורית בפולי', 'shoulders', 'isolation', 'cable', false);
