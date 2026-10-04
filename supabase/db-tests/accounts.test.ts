// Accounts: the demo/judge seed (NH-13, NH-63's wrapper) and account
// deletion, which must leave nothing of the user behind (NH-56's database
// side).
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.4.6";
import { all, asService, createUser, migratedDb, one } from "./db.ts";

const seed = (db: PGlite, email: string) =>
  one<{ r: Record<string, unknown> }>(db, "select private.seed_demo_account($1) r", [email]);

async function demoAccount(db: PGlite, email = "judge-1@example.test") {
  const id = await createUser(db, email);
  await db.query("insert into private.demo_accounts (email, label) values ($1, 'judge 1')", [email]);
  return id;
}

// Every column named user_id in public, and users.id: where a user's rows live.
async function rowsOf(db: PGlite, user: string): Promise<Record<string, number>> {
  const tables = await all<{ t: string; c: string }>(
    db,
    `select table_name t, column_name c from information_schema.columns
     where table_schema = 'public' and (column_name = 'user_id' or (table_name = 'users' and column_name = 'id'))
       and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
     order by 1`,
  );
  const counts: Record<string, number> = {};
  for (const { t, c } of tables) {
    const n = (await one<{ n: number }>(db, `select count(*)::int n from public.${t} where ${c} = $1`, [user]))!.n;
    if (n > 0) counts[t] = n;
  }
  return counts;
}

Deno.test("the demo seed builds two weeks of history and refuses unregistered and QA addresses", async () => {
  const db = await migratedDb();
  const u = await demoAccount(db);
  await seed(db, "Judge-1@Example.test ");
  const rows = await rowsOf(db, u);
  assertEquals([rows.training_plans > 0, rows.workout_sessions, rows.messages > 0, rows.coach_notes, rows.user_flags > 0], [true, 8, true, 2, true]);
  assertEquals((await one<{ n: number }>(db, "select count(*)::int n from public.set_logs s join public.workout_sessions w on w.id = s.session_id where w.user_id = $1", [u]))!.n, 128);
  await createUser(db, "someone@example.test");
  await assertRejects(() => seed(db, "someone@example.test"), Error, "not a registered demo account");
  await db.query("insert into private.demo_accounts (email) values ('qa@example.test')");
  await db.query("insert into private.dev_test_accounts (email, scenario) values ('qa@example.test', 'fresh')");
  await assertRejects(() => seed(db, "qa@example.test"), Error, "QA scenario account");
  await db.close();
});

Deno.test("re-seeding a demo account clears its coach chat, jobs, actions and facts", async () => {
  const db = await migratedDb();
  const u = await demoAccount(db);
  await seed(db, "judge-1@example.test");
  await asService(db, (tx) => tx.query("select public.assistant_enqueue_message($1, 'hi', 'c1', 50, 1000)", [u]));
  await db.query(
    `insert into public.user_facts (user_id, doc) values ($1, '{"text":"wedding in June","category":"goal","importance":4,"stability":"temporary","evidence":"explicit"}')`,
    [u],
  );
  // An action from a write tool, and a check-in: a job with no message, so the
  // message delete's cascade can't be what clears it.
  await asService(db, (tx) =>
    tx.query(
      "select public.assistant_save_note($1, (select id from public.training_plans where user_id = $1 and status = 'active' order by created_at limit 1), null, 'deload next week')",
      [u],
    )
  );
  await db.query("insert into public.assistant_jobs (user_id, environment, kind, dedup_key) values ($1, 'prod', 'checkin', 'checkin:2026-10-01')", [u]);
  const before = await rowsOf(db, u);
  assertEquals([before.assistant_actions, before.assistant_jobs, before.coach_notes > 0], [1, 2, true]);
  const r = await seed(db, "judge-1@example.test");
  assertEquals(r!.r.assistant_cleared, true);
  const rows = await rowsOf(db, u);
  for (const t of ["assistant_messages", "assistant_jobs", "assistant_actions", "user_facts", "user_memory_state"]) {
    assertEquals(rows[t], undefined, t);
  }
  assertEquals(rows.workout_sessions, 8);
  await db.close();
});

Deno.test("deleting an account removes every row of that user, and only that user", async () => {
  const db = await migratedDb();
  const u = await demoAccount(db);
  const other = await demoAccount(db, "judge-2@example.test");
  for (const id of [u, other]) {
    await seed(db, id === u ? "judge-1@example.test" : "judge-2@example.test");
    await asService(db, (tx) => tx.query("select public.assistant_enqueue_message($1, 'hi', 'c1', 50, 1000)", [id]));
    await db.query(
      `insert into public.user_facts (user_id, doc) values ($1, '{"text":"has a cranky shoulder","category":"health","importance":5,"stability":"long_term","evidence":"explicit"}')`,
      [id],
    );
    await db.query("insert into public.assistant_agents (user_id, environment) values ($1, 'dev')", [id]);
    await db.query("insert into public.push_tokens (user_id, token) values ($1, $2)", [id, `ExponentPushToken[${id}]`]);
  }
  const before = await rowsOf(db, other);
  await db.query("delete from auth.users where id = $1", [u]);
  assertEquals(await rowsOf(db, u), {});
  assertEquals(await rowsOf(db, other), before);
  await db.close();
});

Deno.test("the QA reset: a 'fresh' account loses its profile row, an 'expired' one gets an expired trial, anyone else is untouched", async () => {
  const db = await migratedDb();
  const [fresh, expired, real] = [await createUser(db, "fresh@example.test"), await createUser(db, "expired@example.test"), await createUser(db)];
  await db.query("insert into private.dev_test_accounts (email, scenario) values ('fresh@example.test', 'fresh'), ('expired@example.test', 'expired')");
  for (const id of [fresh, expired, real]) await db.query("select public.dev_test_reset_account($1)", [id]);
  assertEquals(await one(db, "select 1 from public.users where id = $1", [fresh]), undefined);
  assertEquals((await one<{ s: string }>(db, "select subscription_status s from public.users where id = $1", [expired]))!.s, "expired");
  assertEquals((await one<{ s: string }>(db, "select subscription_status s from public.users where id = $1", [real]))!.s, "trialing");
  await db.close();
});
