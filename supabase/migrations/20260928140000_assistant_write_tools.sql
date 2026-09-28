-- Stage A write tools for the coach chat (NH-44, D-22 in
-- docs/nebius-hackathon-plan.md).
--
-- Each write and its audit row in assistant_actions happen in one function,
-- so they commit or fail together. notch-tools calls these on the
-- service_role client with the user id resolved from the sandbox's tool
-- token; nothing here trusts an id the agent supplied without checking that
-- it belongs to that user's active plan.
--
-- Scope, decided 2026-09-28: the assistant may save a note, and change the
-- parameters of one exercise in one active plan — sets, rep range, rest,
-- intensity, warm-up — but never swap the movement itself. set_logs and the
-- progression engine key on exercise_id, so renaming "barbell bench" to
-- "dumbbell press" would turn the barbell history into dumbbell history and
-- make progression suggest barbell weights; deleting the row would cascade
-- the history away. Parameters don't change what the history means.
--
-- Expected refusals raise SQLSTATE P0001 with a short code as the message
-- (plan_not_found, exercise_not_found, workout_in_progress, invalid_input,
-- nothing_to_change, nothing_to_undo, undo_conflict); notch-tools turns them
-- into messages for the agent.

-- The parts of an exercise a write tool may change, plus what identifies it.
create or replace function public.assistant_exercise_state(e public.exercises)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'exercise_id', e.id,
    'plan_id', e.plan_id,
    'name', e.name,
    'sets', e.sets,
    'rep_range', e.rep_range,
    'rest_sec', e.rest_sec,
    'intensity', e.intensity,
    'warmup', e.warmup
  );
$$;

-- A workout on this plan is being trained right now: changing its exercises
-- mid-session would move the live coach's targets and progress under the
-- user. Sessions left open for more than 6 hours don't count.
create or replace function public.assistant_workout_in_progress(p_user_id uuid, p_plan_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workout_sessions s
    where s.user_id = p_user_id
      and s.plan_id = p_plan_id
      and s.status = 'in_progress'
      and s.started_at > now() - interval '6 hours'
  );
$$;

-- ------------------------------------------------------------ save_note
-- Same rules as the live coach's notes (mod.ts): 1–500 characters, scoped to
-- a plan so a note stops applying when its plan is archived. A note is either
-- about one exercise (its plan is derived) or general for a plan. An
-- identical note saved in the last 10 minutes is returned instead of
-- duplicated, so a retried tool call is harmless.
create or replace function public.assistant_save_note(
  p_user_id uuid,
  p_plan_id uuid,
  p_exercise_id uuid,
  p_text text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_text text := btrim(p_text);
  v_plan uuid;
  v_plan_name text;
  v_exercise_name text;
  v_note uuid;
  v_action uuid;
begin
  if v_text is null or char_length(v_text) not between 1 and 500 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  if p_exercise_id is not null then
    select e.plan_id, p.name, e.name into v_plan, v_plan_name, v_exercise_name
    from public.exercises e
    join public.training_plans p on p.id = e.plan_id
    where e.id = p_exercise_id and e.source = 'plan' and p.user_id = p_user_id and p.status = 'active';
    if v_plan is null or (p_plan_id is not null and p_plan_id <> v_plan) then
      raise exception 'exercise_not_found' using errcode = 'P0001';
    end if;
  else
    select p.id, p.name into v_plan, v_plan_name
    from public.training_plans p
    where p.id = p_plan_id and p.user_id = p_user_id and p.status = 'active';
    if v_plan is null then
      raise exception 'plan_not_found' using errcode = 'P0001';
    end if;
  end if;

  select n.id into v_note
  from public.coach_notes n
  where n.user_id = p_user_id
    and n.plan_id = v_plan
    and n.exercise_id is not distinct from p_exercise_id
    and n.note = v_text
    and n.created_at > now() - interval '10 minutes'
  order by n.created_at desc
  limit 1;
  if v_note is not null then
    select a.id into v_action
    from public.assistant_actions a
    where a.user_id = p_user_id and a.kind = 'save_note' and a.after ->> 'note_id' = v_note::text
    limit 1;
    return jsonb_build_object('action_id', v_action, 'note_id', v_note, 'plan_id', v_plan,
                              'plan_name', v_plan_name, 'exercise_id', p_exercise_id,
                              'exercise_name', v_exercise_name, 'text', v_text, 'duplicate', true);
  end if;

  insert into public.coach_notes (user_id, plan_id, exercise_id, note)
  values (p_user_id, v_plan, p_exercise_id, v_text)
  returning id into v_note;

  insert into public.assistant_actions (user_id, kind, after)
  values (p_user_id, 'save_note', jsonb_build_object('note_id', v_note, 'plan_id', v_plan,
                                                     'exercise_id', p_exercise_id, 'text', v_text))
  returning id into v_action;

  return jsonb_build_object('action_id', v_action, 'note_id', v_note, 'plan_id', v_plan,
                            'plan_name', v_plan_name, 'exercise_id', p_exercise_id,
                            'exercise_name', v_exercise_name, 'text', v_text, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------- adjust_plan_exercise
-- p_changes holds any of: sets (integer 1–20), rep_range ("8-12" or "10" —
-- the formats progression.ts parses; anything else would silently fall back
-- to 8–12 there), rest_sec (integer 0–1800), intensity (1–60 characters),
-- warmup (up to 200 characters, or null to clear it).
create or replace function public.assistant_adjust_exercise(
  p_user_id uuid,
  p_exercise_id uuid,
  p_changes jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.exercises%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_action uuid;
  v_key text;
  v_range text[];
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'nothing_to_change' using errcode = 'P0001';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('sets', 'rep_range', 'rest_sec', 'intensity', 'warmup') then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;
  end loop;
  if p_changes ? 'sets' and not coalesce(
       jsonb_typeof(p_changes -> 'sets') = 'number' and (p_changes ->> 'sets') ~ '^\d+$'
       and (p_changes ->> 'sets')::int between 1 and 20, false) then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if p_changes ? 'rest_sec' and not coalesce(
       jsonb_typeof(p_changes -> 'rest_sec') = 'number' and (p_changes ->> 'rest_sec') ~ '^\d+$'
       and (p_changes ->> 'rest_sec')::int between 0 and 1800, false) then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if p_changes ? 'rep_range' then
    v_range := regexp_match(coalesce(p_changes ->> 'rep_range', ''), '^(\d{1,3})(?:-(\d{1,3}))?$');
    if jsonb_typeof(p_changes -> 'rep_range') <> 'string' or v_range is null
       or v_range[1]::int < 1 or (v_range[2] is not null and v_range[2]::int < v_range[1]::int) then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;
  end if;
  if p_changes ? 'intensity' and not coalesce(
       jsonb_typeof(p_changes -> 'intensity') = 'string'
       and char_length(btrim(p_changes ->> 'intensity')) between 1 and 60, false) then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if p_changes ? 'warmup' and not (
       jsonb_typeof(p_changes -> 'warmup') = 'null'
       or (jsonb_typeof(p_changes -> 'warmup') = 'string' and char_length(p_changes ->> 'warmup') <= 200)) then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  select e.* into v_row
  from public.exercises e
  join public.training_plans p on p.id = e.plan_id
  where e.id = p_exercise_id and e.source = 'plan' and p.user_id = p_user_id and p.status = 'active'
  for update of e;
  if not found then
    raise exception 'exercise_not_found' using errcode = 'P0001';
  end if;
  if public.assistant_workout_in_progress(p_user_id, v_row.plan_id) then
    raise exception 'workout_in_progress' using errcode = 'P0001';
  end if;

  v_before := public.assistant_exercise_state(v_row);
  update public.exercises e
  set sets = case when p_changes ? 'sets' then (p_changes ->> 'sets')::int else e.sets end,
      rep_range = case when p_changes ? 'rep_range' then p_changes ->> 'rep_range' else e.rep_range end,
      rest_sec = case when p_changes ? 'rest_sec' then (p_changes ->> 'rest_sec')::int else e.rest_sec end,
      intensity = case when p_changes ? 'intensity' then btrim(p_changes ->> 'intensity') else e.intensity end,
      warmup = case when p_changes ? 'warmup' then nullif(btrim(p_changes ->> 'warmup'), '') else e.warmup end
  where e.id = v_row.id
  returning public.assistant_exercise_state(e) into v_after;

  if v_after = v_before then
    raise exception 'nothing_to_change' using errcode = 'P0001';
  end if;

  insert into public.assistant_actions (user_id, kind, before, after)
  values (p_user_id, 'adjust_plan_exercise', v_before, v_after)
  returning id into v_action;

  return jsonb_build_object('action_id', v_action, 'before', v_before, 'after', v_after);
end;
$$;

-- ------------------------------------------------------- undo_last_change
-- Reverts the user's most recent assistant action from the last 24 hours
-- that isn't already undone; calling it again walks further back. A plan
-- change is reverted only if the exercise still looks exactly as the action
-- left it — anything changed since (a re-imported plan, a later edit) is an
-- undo_conflict rather than a silent overwrite.
create or replace function public.assistant_undo_last(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_action public.assistant_actions%rowtype;
  v_row public.exercises%rowtype;
  v_undo uuid;
begin
  select a.* into v_action
  from public.assistant_actions a
  where a.user_id = p_user_id
    and a.kind <> 'undo'
    and a.undone_at is null
    and a.created_at > now() - interval '24 hours'
  order by a.created_at desc, a.id desc
  limit 1
  for update;
  if not found then
    raise exception 'nothing_to_undo' using errcode = 'P0001';
  end if;

  if v_action.kind = 'save_note' then
    delete from public.coach_notes
    where id = (v_action.after ->> 'note_id')::uuid and user_id = p_user_id;
  elsif v_action.kind = 'adjust_plan_exercise' then
    select e.* into v_row
    from public.exercises e
    join public.training_plans p on p.id = e.plan_id
    where e.id = (v_action.before ->> 'exercise_id')::uuid and p.user_id = p_user_id and p.status = 'active'
    for update of e;
    if not found or public.assistant_exercise_state(v_row) <> v_action.after then
      raise exception 'undo_conflict' using errcode = 'P0001';
    end if;
    if public.assistant_workout_in_progress(p_user_id, v_row.plan_id) then
      raise exception 'workout_in_progress' using errcode = 'P0001';
    end if;
    update public.exercises
    set sets = (v_action.before ->> 'sets')::int,
        rep_range = v_action.before ->> 'rep_range',
        rest_sec = (v_action.before ->> 'rest_sec')::int,
        intensity = v_action.before ->> 'intensity',
        warmup = v_action.before ->> 'warmup'
    where id = v_row.id;
  end if;

  update public.assistant_actions set undone_at = now() where id = v_action.id;
  insert into public.assistant_actions (user_id, kind, undoes)
  values (p_user_id, 'undo', v_action.id)
  returning id into v_undo;

  return jsonb_build_object('undo_action_id', v_undo, 'undone_action_id', v_action.id,
                            'kind', v_action.kind, 'before', v_action.before, 'after', v_action.after);
end;
$$;

revoke execute on function public.assistant_exercise_state(public.exercises) from public, anon, authenticated;
revoke execute on function public.assistant_workout_in_progress(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.assistant_save_note(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.assistant_adjust_exercise(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.assistant_undo_last(uuid) from public, anon, authenticated;
grant execute on function public.assistant_save_note(uuid, uuid, uuid, text) to service_role;
grant execute on function public.assistant_adjust_exercise(uuid, uuid, jsonb) to service_role;
grant execute on function public.assistant_undo_last(uuid) to service_role;
