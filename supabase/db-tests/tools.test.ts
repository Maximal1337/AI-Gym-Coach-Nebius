// The assistant's write tools (NH-44, D-22): save a note, change one
// exercise's parameters in an active plan, and undo — each write recorded in
// assistant_actions in the same transaction.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.4.6";
import { all, asService, asUser, createUser, migratedDb, one } from "./db.ts";

async function planWithExercise(db: PGlite, user: string, status = "active") {
  const plan = await one<{ id: string }>(db, "insert into public.training_plans (user_id, name, status) values ($1, 'Upper', $2) returning id", [user, status]);
  const ex = await one<{ id: string }>(
    db,
    "insert into public.exercises (plan_id, order_index, name, sets, rep_range, rest_sec, intensity) values ($1, 0, 'Bench press', 3, '8-12', 120, 'RPE 8') returning id",
    [plan!.id],
  );
  return { plan: plan!.id, exercise: ex!.id };
}

const call = (db: PGlite, sql: string, params: unknown[]) =>
  asService(db, async (tx) => (await tx.query<{ r: Record<string, any> }>(`select ${sql} r`, params)).rows[0].r);

const adjust = (db: PGlite, user: string, exercise: string, changes: unknown) =>
  call(db, "public.assistant_adjust_exercise($1, $2, $3)", [user, exercise, changes]);

const undo = (db: PGlite, user: string) => call(db, "public.assistant_undo_last($1)", [user]);

const exercise = (db: PGlite, id: string) =>
  one(db, "select name, sets, rep_range, rest_sec, intensity, warmup from public.exercises where id = $1", [id]);

Deno.test("adjust changes the allowed parameters, records before and after, and undo puts them back", async () => {
  const db = await migratedDb();
  const u = await createUser(db);
  const { exercise: ex } = await planWithExercise(db, u);
  const r = await adjust(db, u, ex, { sets: 4, rep_range: "6-8", rest_sec: 150, intensity: " RPE 9 ", warmup: "2 light sets" });
  assertEquals([r.before.sets, r.after.sets, r.after.intensity], [3, 4, "RPE 9"]);
  assertEquals(await exercise(db, ex), { name: "Bench press", sets: 4, rep_range: "6-8", rest_sec: 150, intensity: "RPE 9", warmup: "2 light sets" });
  const undone = await undo(db, u);
  assertEquals([undone.kind, undone.undone_action_id], ["adjust_plan_exercise", r.action_id]);
  assertEquals(await exercise(db, ex), { name: "Bench press", sets: 3, rep_range: "8-12", rest_sec: 120, intensity: "RPE 8", warmup: null });
  assertEquals((await all(db, "select kind from public.assistant_actions order by created_at, kind")).map((a) => a.kind).sort(), ["adjust_plan_exercise", "undo"]);
  await assertRejects(() => undo(db, u), Error, "nothing_to_undo");
  await db.close();
});

Deno.test("adjust never renames the movement and refuses values progression can't use", async () => {
  const db = await migratedDb();
  const u = await createUser(db);
  const { exercise: ex } = await planWithExercise(db, u);
  for (const bad of [
    { name: "Dumbbell press" },
    { sets: 0 },
    { sets: 21 },
    { sets: "4" },
    { sets: 3.5 },
    { rest_sec: 1801 },
    { rep_range: "8–12" },
    { rep_range: "12-8" },
    { rep_range: "AMRAP" },
    { intensity: "" },
    { warmup: "x".repeat(201) },
  ]) {
    await assertRejects(() => adjust(db, u, ex, bad), Error, "invalid_input", JSON.stringify(bad));
  }
  await assertRejects(() => adjust(db, u, ex, {}), Error, "nothing_to_change");
  await assertRejects(() => adjust(db, u, ex, { sets: 3 }), Error, "nothing_to_change");
  assertEquals(await all(db, "select 1 from public.assistant_actions"), []);
  await db.close();
});

Deno.test("adjust touches only the caller's own active plan, and not mid-workout", async () => {
  const db = await migratedDb();
  const [me, other] = [await createUser(db), await createUser(db)];
  const theirs = await planWithExercise(db, other);
  await assertRejects(() => adjust(db, me, theirs.exercise, { sets: 4 }), Error, "exercise_not_found");
  const archived = await planWithExercise(db, me, "archived");
  await assertRejects(() => adjust(db, me, archived.exercise, { sets: 4 }), Error, "exercise_not_found");
  const mine = await planWithExercise(db, me);
  await db.query("insert into public.workout_sessions (user_id, plan_id) values ($1, $2)", [me, mine.plan]);
  await assertRejects(() => adjust(db, me, mine.exercise, { sets: 4 }), Error, "workout_in_progress");
  // A session left open for more than 6 hours no longer counts.
  await db.query("update public.workout_sessions set started_at = now() - interval '7 hours'");
  assertEquals((await adjust(db, me, mine.exercise, { sets: 4 })).after.sets, 4);
  await db.close();
});

Deno.test("undo refuses to overwrite a change made since, and walks back one action per call", async () => {
  const db = await migratedDb();
  const u = await createUser(db);
  const { exercise: ex } = await planWithExercise(db, u);
  await adjust(db, u, ex, { sets: 4 });
  await adjust(db, u, ex, { sets: 5 });
  await undo(db, u);
  assertEquals((await exercise(db, ex))!.sets, 4);
  await undo(db, u);
  assertEquals((await exercise(db, ex))!.sets, 3);
  await adjust(db, u, ex, { rest_sec: 90 });
  await db.query("update public.exercises set rest_sec = 60 where id = $1", [ex]);
  await assertRejects(() => undo(db, u), Error, "undo_conflict");
  assertEquals((await exercise(db, ex))!.rest_sec, 60);
  // Older than 24 hours is out of reach.
  await db.query("update public.assistant_actions set created_at = now() - interval '25 hours'");
  await assertRejects(() => undo(db, u), Error, "nothing_to_undo");
  await db.close();
});

Deno.test("save_note scopes the note to the plan, doesn't duplicate a retry, and undo deletes it", async () => {
  const db = await migratedDb();
  const [u, other] = [await createUser(db), await createUser(db)];
  const { plan, exercise: ex } = await planWithExercise(db, u);
  const save = (p: string | null, e: string | null, text: string) => call(db, "public.assistant_save_note($1, $2, $3, $4)", [u, p, e, text]);
  const first = await save(null, ex, " Keep elbows tucked ");
  assertEquals([first.plan_id, first.exercise_name, first.text, first.duplicate], [plan, "Bench press", "Keep elbows tucked", false]);
  const retry = await save(null, ex, "Keep elbows tucked");
  assertEquals([retry.duplicate, retry.note_id, retry.action_id], [true, first.note_id, first.action_id]);
  assertEquals((await all(db, "select 1 from public.coach_notes")).length, 1);
  await assertRejects(() => save(null, null, "general"), Error, "plan_not_found");
  await assertRejects(() => save(null, ex, ""), Error, "invalid_input");
  const theirs = await planWithExercise(db, other);
  await assertRejects(() => save(theirs.plan, null, "not yours"), Error, "plan_not_found");
  await assertRejects(() => save(null, theirs.exercise, "not yours"), Error, "exercise_not_found");
  await undo(db, u);
  assertEquals(await all(db, "select 1 from public.coach_notes"), []);
  await db.close();
});

Deno.test("users read their own action trail but can't write it or call the tools", async () => {
  const db = await migratedDb();
  const [u, other] = [await createUser(db), await createUser(db)];
  const { exercise: ex } = await planWithExercise(db, u);
  await adjust(db, u, ex, { sets: 4 });
  assertEquals((await asUser(db, u, (tx) => tx.query("select * from public.assistant_actions"))).rows.length, 1);
  assertEquals((await asUser(db, other, (tx) => tx.query("select * from public.assistant_actions"))).rows.length, 0);
  await assertRejects(() => asUser(db, u, (tx) => tx.query("delete from public.assistant_actions")), Error, "permission denied");
  await assertRejects(
    () => asUser(db, u, (tx) => tx.query("select public.assistant_adjust_exercise($1, $2, '{\"sets\":5}')", [u, ex])),
    Error,
    "permission denied",
  );
  await db.close();
});
