// What clients can reach once every migration has run. These pin the access
// model in the init migration's header: clients read their own rows, write
// only their own profile, persona, fitness profile and push tokens (and
// delete their own facts), and everything else goes through Edge Functions
// on service_role. A new table or function that a client can reach fails
// here until it's added on purpose.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { all, asAnon, asUser, createUser, migratedDb, migrationNames, one } from "./db.ts";

Deno.test("every migration applies, in order, on Postgres 17", async () => {
  const db = await migratedDb();
  const v = await one<{ v: string }>(db, "select current_setting('server_version') v");
  assertEquals(v!.v.split(".")[0], "17");
  assertEquals(migrationNames().length > 0, true);
  await db.close();
});

Deno.test("row level security is on for every table in public", async () => {
  const db = await migratedDb();
  const off = await all<{ t: string }>(
    db,
    `select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
  );
  assertEquals(off, []);
  await db.close();
});

// Policies that apply to a role (or to everyone), by command: r select,
// a insert, w update, d delete, * all.
const appliesTo = (role: string) =>
  `(0 = any(pol.polroles) or (select oid from pg_roles where rolname = '${role}') = any(pol.polroles))`;

// A table a role can actually write: it holds the privilege and a permissive
// policy for that command lets it through. Column-level grants count.
const writable = (role: string) => `
  select c.relname || ' ' || lower(cmd.c) w
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('INSERT', 'a'), ('UPDATE', 'w'), ('DELETE', 'd')) cmd(c, code)
  where n.nspname = 'public' and c.relkind = 'r'
    and (has_table_privilege('${role}', c.oid, cmd.c)
         or (cmd.c <> 'DELETE' and has_any_column_privilege('${role}', c.oid, cmd.c)))
    and exists (
      select 1 from pg_policy pol
      where pol.polrelid = c.oid and pol.polpermissive and pol.polcmd in (cmd.code, '*') and ${appliesTo(role)}
    )
  order by 1`;

const readable = (role: string) => `
  select c.relname t
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('${role}', c.oid, 'select')
    and exists (
      select 1 from pg_policy pol
      where pol.polrelid = c.oid and pol.polpermissive and pol.polcmd in ('r', '*') and ${appliesTo(role)}
    )
  order by 1`;

Deno.test("anon reads only app_config and writes nothing", async () => {
  const db = await migratedDb();
  assertEquals((await all<{ t: string }>(db, readable("anon"))).map((r) => r.t), ["app_config"]);
  assertEquals(await all(db, writable("anon")), []);
  await db.close();
});

Deno.test("authenticated writes only its own profile rows, and deletes its own facts", async () => {
  const db = await migratedDb();
  assertEquals((await all<{ w: string }>(db, writable("authenticated"))).map((r) => r.w), [
    "coach_profiles delete",
    "coach_profiles insert",
    "coach_profiles update",
    "fitness_profiles delete",
    "fitness_profiles insert",
    "fitness_profiles update",
    "push_tokens delete",
    "push_tokens insert",
    "push_tokens update",
    "user_facts delete",
    "users insert",
    "users update",
  ]);
  await db.close();
});

Deno.test("a user can change their locale but not their trial or subscription", async () => {
  const db = await migratedDb();
  const me = await createUser(db);
  await asUser(db, me, (tx) => tx.query("update public.users set locale = 'en' where id = $1", [me]));
  assertEquals((await one<{ locale: string }>(db, "select locale from public.users where id = $1", [me]))!.locale, "en");
  for (const set of ["trial_ends_at = now() + interval '10 years'", "subscription_status = 'active'", "subscription_expires_at = now() + interval '1 year'"]) {
    await assertRejects(
      () => asUser(db, me, (tx) => tx.query(`update public.users set ${set} where id = $1`, [me])),
      Error,
      "permission denied",
    );
  }
  await db.close();
});

Deno.test("clients can call only these security definer functions", async () => {
  const db = await migratedDb();
  const callable = (role: string) =>
    all<{ f: string }>(
      db,
      `select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' f
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prosecdef and p.prorettype <> 'trigger'::regtype
         and has_function_privilege('${role}', p.oid, 'execute')
       order by 1`,
    );
  // dev-test-login resets QA scenario accounts with it; for anyone else it's a no-op.
  assertEquals((await callable("anon")).map((r) => r.f), ["public.dev_test_reset_account(p_user_id uuid)"]);
  assertEquals((await callable("authenticated")).map((r) => r.f), [
    "public.assistant_my_open_jobs()",
    "public.dev_test_reset_account(p_user_id uuid)",
    "public.feature_enabled(p_user_id uuid, p_flag text)",
    "public.my_feature_flags()",
  ]);
  await db.close();
});

Deno.test("the private schema is closed to clients", async () => {
  const db = await migratedDb();
  for (const role of ["anon", "authenticated"]) {
    const r = await one<{ ok: boolean }>(db, `select has_schema_privilege('${role}', 'private', 'usage') ok`);
    assertEquals(r!.ok, false, role);
  }
  await assertRejects(() => asAnon(db, (tx) => tx.query("select * from private.demo_accounts")), Error, "permission denied");
  await db.close();
});

Deno.test("a user reads their own rows and nobody else's", async () => {
  const db = await migratedDb();
  const [a, b] = [await createUser(db), await createUser(db)];
  for (const u of [a, b]) {
    await db.query("insert into public.assistant_messages (user_id, role, doc) values ($1, 'user', '{\"text\":\"hi\"}')", [u]);
    await db.query(
      `insert into public.user_facts (user_id, doc) values ($1, '{"text":"likes mornings","category":"schedule","importance":3,"stability":"long_term","evidence":"explicit"}')`,
      [u],
    );
  }
  for (const table of ["assistant_messages", "user_facts", "users"]) {
    const col = table === "users" ? "id" : "user_id";
    const seen = await asUser(db, a, (tx) => tx.query<{ u: string }>(`select ${col} u from public.${table}`));
    assertEquals(seen.rows.map((r) => r.u), [a], table);
  }
  for (const table of ["assistant_jobs", "assistant_agents", "assistant_spend", "user_memory_state", "feature_flags", "user_flags"]) {
    await assertRejects(() => asUser(db, a, (tx) => tx.query(`select * from public.${table}`)), Error, "permission denied", table);
  }
  await db.close();
});
