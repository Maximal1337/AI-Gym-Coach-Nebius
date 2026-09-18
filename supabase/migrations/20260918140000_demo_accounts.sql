-- Seeded demo and judge accounts (NH-13). Progression and memory only show
-- with history, so a demo account gets two realistic weeks of training:
--  - an English coach profile and a fitness profile;
--  - an Upper/Lower plan, eight completed workouts with set logs whose weights
--    follow services/agent/src/progression.ts exactly (the coach never
--    contradicts its own history);
--  - workout-chat messages carrying the kind of personal context the memory
--    job (NH-63) extracts facts from: a cranky left shoulder, a June wedding,
--    45-minute Thursdays, dumbbells for incline work, a short night, a new gym;
--  - two saved coach notes and the hackathon feature flags.
-- Facts themselves come once NH-60's tables exist.
--
-- Everything lives in the `private` schema, which PostgREST doesn't expose,
-- so the seed can only run out of band (SQL editor or `supabase db query
-- --linked`), never through the API. It WIPES the account's plans, workouts,
-- notes, studio sessions and usage before seeding, so it refuses any address
-- not registered in private.demo_accounts — a typo can't destroy a real
-- user's data. History is placed relative to now(): re-run it right before
-- judging to move the two weeks into the judging window.
-- Runbook: dev-test-scenario-accounts skill, "Demo and judge accounts".

create table if not exists private.demo_accounts (
  email text primary key check (email = lower(email)),
  label text,
  created_at timestamptz not null default now()
);
revoke all on private.demo_accounts from public, anon, authenticated;

create or replace function private.seed_demo_account(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_uid uuid;
  v_plan_upper uuid;
  v_plan_lower uuid;
  v_plan uuid;
  v_started timestamptz;
  v_session uuid;
  v_sessions uuid[] := '{}';
  s record;
begin
  if not exists (select 1 from private.demo_accounts where email = v_email) then
    raise exception 'not a registered demo account: % (insert it into private.demo_accounts first)', v_email;
  end if;
  if exists (select 1 from private.dev_test_accounts where email = v_email) then
    raise exception '% is a QA scenario account (private.dev_test_accounts); its state is reset on every login', v_email;
  end if;
  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is null then
    raise exception 'no auth user for % yet: sign in once through dev-test-login first', v_email;
  end if;

  -- Wipe. Deleting the plans cascades to exercises, workouts, set logs,
  -- workout-chat messages, skips and plan-scoped notes.
  delete from public.training_plans where user_id = v_uid;
  delete from public.coach_notes where user_id = v_uid;
  delete from public.studio_sessions where user_id = v_uid;
  delete from public.studio_custom_units where user_id = v_uid;
  delete from public.usage_ledger where user_id = v_uid;

  -- Account state: consent given, onboarding done, a trial that outlasts judging.
  insert into public.users (id, locale, terms_accepted_at, terms_version, plan_setup_skipped_at,
                            trial_ends_at, subscription_status, subscription_expires_at)
  values (v_uid, 'en', now(), 'demo', null, now() + interval '120 days', 'trialing', null)
  on conflict (id) do update set
    locale = excluded.locale,
    terms_accepted_at = excluded.terms_accepted_at,
    terms_version = excluded.terms_version,
    plan_setup_skipped_at = excluded.plan_setup_skipped_at,
    trial_ends_at = excluded.trial_ends_at,
    subscription_status = excluded.subscription_status,
    subscription_expires_at = excluded.subscription_expires_at;

  insert into public.coach_profiles (user_id, coach_name, language, tone_preset, accountability_style,
                                     persona_freeform, units)
  values (v_uid, 'Notch', 'en', 'friendly_casual', 'gentle', null, 'metric')
  on conflict (user_id) do update set
    coach_name = excluded.coach_name,
    language = excluded.language,
    tone_preset = excluded.tone_preset,
    accountability_style = excluded.accountability_style,
    persona_freeform = excluded.persona_freeform,
    units = excluded.units;

  insert into public.fitness_profiles (user_id, primary_goal, experience_level, days_per_week, gender,
                                       age, weight_kg, height_cm, injury_notes, updated_at)
  values (v_uid, 'hypertrophy', 'intermediate', 4, 'male', 29, 82, 180,
          'Left shoulder gets irritated by overhead pressing.', now())
  on conflict (user_id) do update set
    primary_goal = excluded.primary_goal,
    experience_level = excluded.experience_level,
    days_per_week = excluded.days_per_week,
    gender = excluded.gender,
    age = excluded.age,
    weight_kg = excluded.weight_kg,
    height_cm = excluded.height_cm,
    injury_notes = excluded.injury_notes,
    updated_at = excluded.updated_at;

  insert into public.user_flags (user_id, flag, enabled)
  values (v_uid, 'assistant_chat', true), (v_uid, 'assistant_memory', true)
  on conflict (user_id, flag) do update set enabled = true, updated_at = now();

  -- Plan.
  insert into public.training_plans (user_id, name, status, created_at)
  values (v_uid, 'Upper Body', 'active', date_trunc('day', now()) - interval '14 days')
  returning id into v_plan_upper;
  insert into public.training_plans (user_id, name, status, created_at)
  values (v_uid, 'Lower Body', 'active', date_trunc('day', now()) - interval '14 days')
  returning id into v_plan_lower;

  -- Exercises, with the top weight and reps of each of the plan's four
  -- workouts ("rounds"). Every weight change is the one progression.ts would
  -- suggest: a first set at the top of the range moves the weight up by the
  -- equipment's increment (barbell +2.5, dumbbell >=10kg +2, machine/cable
  -- >=22.5kg +7); anything less keeps it.
  drop table if exists pg_temp.demo_exercises;
  create temp table demo_exercises (
    plan_key text,
    order_index int,
    name text,
    sets int,
    rep_range text,
    rest_sec int,
    intensity text,
    warmup text,
    equipment_type text,
    weights numeric[],
    reps text[]
  ) on commit drop;

  insert into pg_temp.demo_exercises values
    ('U', 1, 'Barbell Bench Press', 4, '6-8', 150, 'RIR 1-2',
     'Two ramp-up sets: the empty bar for 10, then about 60% for 5', 'barbell',
     '{80,80,82.5,85}', '{7/7/6/6,8/8/7/7,8/7/7/6,6/6/5/5}'),
    ('U', 2, 'Incline Dumbbell Press', 3, '8-10', 120, 'RIR 1-2', null, 'dumbbell',
     '{26,26,28,28}', '{9/8/8,10/9/9,9/8/8,10/9/8}'),
    ('U', 3, 'Chest-Supported Row', 3, '8-10', 120, 'RIR 1-2', null, 'machine',
     '{60,60,67,67}', '{9/9/8,10/10/9,8/8/8,9/9/8}'),
    ('U', 4, 'Lat Pulldown', 3, '10-12', 90, 'RIR 2', null, 'cable',
     '{55,55,62,62}', '{11/10/10,12/11/11,10/10/9,11/10/10}'),
    ('U', 5, 'Cable Lateral Raise', 3, '12-15', 60, 'RIR 1', 'One light set first to check the shoulder', 'cable',
     '{7.5,7.5,7.5,7.5}', '{13/12/12,14/13/12,14/14/13,15/14/13}'),
    ('L', 1, 'Back Squat', 4, '5-7', 180, 'RIR 1-2', 'Three ramp-up sets', 'barbell',
     '{100,100,102.5,102.5}', '{6/6/5/5,7/7/6/6,6/5/5/4,7/7/6/6}'),
    ('L', 2, 'Romanian Deadlift', 3, '8-10', 150, 'RIR 2', null, 'barbell',
     '{90,90,92.5,92.5}', '{9/9/8,10/10/9,8/7/7,9/9/8}'),
    ('L', 3, 'Leg Press', 3, '10-12', 120, 'RIR 1-2', null, 'machine',
     '{180,180,187,187}', '{11/11/10,12/12/11,10/9/9,11/11/10}'),
    ('L', 4, 'Seated Leg Curl', 3, '10-12', 90, 'RIR 1', null, 'machine',
     '{45,45,52,52}', '{11/10/10,12/11/11,10/9/9,11/10/10}'),
    ('L', 5, 'Standing Calf Raise', 3, '12-15', 60, 'RIR 1', null, 'machine',
     '{70,70,77,77}', '{14/13/13,15/14/14,12/12/11,13/13/12}');

  insert into public.exercises (plan_id, order_index, name, sets, rep_range, rest_sec, intensity, warmup, equipment_type)
  select case d.plan_key when 'U' then v_plan_upper else v_plan_lower end,
         d.order_index, d.name, d.sets, d.rep_range, d.rest_sec, d.intensity, d.warmup, d.equipment_type
  from pg_temp.demo_exercises d;

  -- Eight completed workouts over the last two weeks, alternating Upper/Lower.
  for s in
    select * from (values
      (1, 'U', 13, 1), (2, 'L', 12, 1), (3, 'U', 10, 2), (4, 'L', 9, 2),
      (5, 'U', 6, 3), (6, 'L', 5, 3), (7, 'U', 3, 4), (8, 'L', 2, 4)
    ) as t(session_no, plan_key, days_ago, round)
    order by session_no
  loop
    v_plan := case s.plan_key when 'U' then v_plan_upper else v_plan_lower end;
    v_started := date_trunc('day', now()) - make_interval(days => s.days_ago) + interval '17 hours 30 minutes';

    insert into public.workout_sessions (user_id, plan_id, started_at, completed_at, status, source)
    values (v_uid, v_plan, v_started, v_started + interval '70 minutes', 'completed', 'live')
    returning id into v_session;
    v_sessions[s.session_no] := v_session;

    insert into public.set_logs (session_id, exercise_id, set_no, weight_kg, reps, created_at)
    select v_session, e.id, r.set_no::int, d.weights[s.round], r.reps::int,
           v_started + make_interval(mins => (d.order_index - 1) * 14 + r.set_no::int * 3)
    from pg_temp.demo_exercises d
    join public.exercises e on e.plan_id = v_plan and e.order_index = d.order_index
    cross join lateral unnest(string_to_array(d.reps[s.round], '/')) with ordinality as r(reps, set_no)
    where d.plan_key = s.plan_key;
  end loop;

  -- Workout chat. The numbers match the set logs above.
  insert into public.messages (session_id, user_id, from_role, text, created_at)
  select v_sessions[m.session_no], v_uid, m.from_role, m.body, w.started_at + make_interval(mins => m.at_minute)
  from (values
    (1, 0, 'coach', 'Upper Body day! 💪 We''re opening with **Barbell Bench Press**: 4 sets of 6-8, 150s rest. Two ramp-up sets first: the empty bar for 10, then about 60% for 5.'),
    (1, 6, 'me', 'Quick heads-up: my left shoulder gets cranky with overhead work, so I''d rather keep my pressing shoulder-friendly.'),
    (1, 7, 'coach', 'Thanks for telling me. We''ll stick to bench and incline angles and skip overhead pressing. If anything ever feels sharp, stop the set and get it checked by a professional. I''ll remind you to warm the shoulder up before pressing.'),
    (1, 20, 'me', 'Bench done: 80 for 7, 7, 6, 6'),
    (1, 21, 'coach', '**80kg for 7, 7, 6, 6**, a solid first session to build from. Next up: **Incline Dumbbell Press**, 3 sets of 8-10.'),
    (2, 0, 'coach', 'Leg day 🦵 First up: **Back Squat**, 4 sets of 5-7 after three ramp-up sets.'),
    (2, 12, 'me', 'Squats felt solid! 100 for 6, 6, 5, 5. Also, my brother''s wedding is in June and I want to look sharp in the suit 😄'),
    (2, 13, 'coach', '**100kg for 6, 6, 5, 5**, strong start! June is a great target, plenty of time for steady progress. Next: **Romanian Deadlift**, 3 sets of 8-10.'),
    (3, 0, 'coach', 'Upper Body again! **Barbell Bench Press** first. Last time you did **80kg for 7, 7, 6, 6**, so let''s beat that.'),
    (3, 2, 'me', 'Heads-up, I only have about 45 minutes on Thursdays because of work. Can we keep these sessions tight?'),
    (3, 3, 'coach', 'Absolutely. On Thursdays we''ll keep rest at the short end of the range and move briskly between exercises.'),
    (3, 25, 'me', 'Bench: 80 for 8, 8, 7, 7'),
    (3, 26, 'coach', '**80kg for 8, 8, 7, 7**, one more rep on every set 🔥 Next: **Incline Dumbbell Press**.'),
    (4, 0, 'coach', 'Lower Body day. **Back Squat** first. Last time you did **100kg for 6, 6, 5, 5**.'),
    (4, 30, 'me', 'RDLs done, 90 for 10, 10, 9. They always leave my lower back a bit tight the next day, is that normal?'),
    (4, 31, 'coach', '**90kg for 10, 10, 9**, nice work. I can''t diagnose anything, but keep the bar close, brace hard and stop before your back rounds. If the tightness ever turns into pain, check in with a professional.'),
    (5, 0, 'coach', 'Upper Body! Band pull-aparts for the left shoulder first, then **Barbell Bench Press**. Last time you did **80kg for 8, 8, 7, 7**.'),
    (5, 24, 'me', 'Bench done: 82.5 for 8, 7, 7, 6. By the way, I prefer dumbbells over the barbell for incline work, it feels much better on the shoulder.'),
    (5, 25, 'coach', '**82.5kg for 8, 7, 7, 6**, great first session at the new weight. Noted: incline stays on dumbbells. Next: **Incline Dumbbell Press**, 3 sets of 8-10.'),
    (6, 0, 'coach', 'Leg day 🦵 **Back Squat** first. Last time you did **100kg for 7, 7, 6, 6**.'),
    (6, 1, 'me', 'Slept like 4 hours last night, legs feel heavy today.'),
    (6, 2, 'coach', 'Thanks for the heads-up. We''ll still train, just listen to your body and keep the technique crisp.'),
    (6, 14, 'me', 'Squats: 102.5 for 6, 5, 5, 4'),
    (6, 15, 'coach', '**102.5kg for 6, 5, 5, 4** on 4 hours of sleep, heavier than last time even on a rough day. Get some rest and we''ll push the reps back up next session.'),
    (7, 0, 'coach', 'Upper Body! **Barbell Bench Press** first. Last time you did **82.5kg for 8, 7, 7, 6**.'),
    (7, 20, 'me', 'New bench PR! 85 for 6, 6, 5, 5 🎉'),
    (7, 21, 'coach', '🎉 **85kg for 6**, a new best! That''s the payoff of steady work. Next: **Incline Dumbbell Press**.'),
    (8, 0, 'coach', 'Leg day! **Back Squat** first. Last time you did **102.5kg for 6, 5, 5, 4**. Fresh legs today? Let''s push the reps back up.'),
    (8, 3, 'me', 'I switched to a gym closer to home. They don''t have a hack squat, but there''s a belt squat machine.'),
    (8, 4, 'coach', 'Good to know, I''ll keep that in mind for substitutions. The belt squat is a great quad-focused swap if we ever need one.'),
    (8, 16, 'me', 'Squats: 102.5 for 7, 7, 6, 6'),
    (8, 17, 'coach', '**102.5kg for 7, 7, 6, 6**, way up from last session. That''s the bounce-back we wanted 💪')
  ) as m(session_no, at_minute, from_role, body)
  join public.workout_sessions w on w.id = v_sessions[m.session_no];

  -- Saved coach notes: a plan-wide reminder and an exercise preference.
  insert into public.coach_notes (user_id, plan_id, exercise_id, note, created_at)
  select v_uid, v_plan_upper, null,
         'Warm up the left shoulder with band pull-aparts before pressing.',
         w.started_at + interval '8 minutes'
  from public.workout_sessions w where w.id = v_sessions[1];
  insert into public.coach_notes (user_id, plan_id, exercise_id, note, created_at)
  select v_uid, v_plan_upper, e.id,
         'Prefers dumbbells over the barbell for incline pressing, easier on the left shoulder.',
         w.started_at + interval '25 minutes'
  from public.workout_sessions w
  join public.exercises e on e.plan_id = v_plan_upper and e.order_index = 2
  where w.id = v_sessions[5];

  return jsonb_build_object(
    'user_id', v_uid,
    'plans', (select count(*) from public.training_plans where user_id = v_uid),
    'exercises', (select count(*) from public.exercises e
                  join public.training_plans p on p.id = e.plan_id where p.user_id = v_uid),
    'workouts', (select count(*) from public.workout_sessions where user_id = v_uid),
    'sets', (select count(*) from public.set_logs l
             join public.workout_sessions w on w.id = l.session_id where w.user_id = v_uid),
    'messages', (select count(*) from public.messages where user_id = v_uid),
    'notes', (select count(*) from public.coach_notes where user_id = v_uid)
  );
end;
$$;

revoke all on function private.seed_demo_account(text) from public, anon, authenticated;
