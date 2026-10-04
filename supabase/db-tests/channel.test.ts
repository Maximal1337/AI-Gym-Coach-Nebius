// The coach chat channel (NH-50…NH-53, NH-55, NH-66, NH-70): enqueue, the
// relay's claim, lease, defer and ack, delivery, check-ins, and the app's
// view of its open jobs. Time is moved by editing timestamps, since now() is
// fixed inside a transaction.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.4.6";
import { all, asService, asUser, createUser, migratedDb, one } from "./db.ts";

type Job = { id: number; user_id: string; status: string; attempts: number; lease_token: string | null; kind: string };

const send = (db: PGlite, user: string, text: string, clientId: string, userCap = 50, globalCap = 1000) =>
  asService(db, async (tx) =>
    (await tx.query<{ r: Record<string, unknown> }>(
      "select public.assistant_enqueue_message($1, $2, $3, $4, $5) r",
      [user, text, clientId, userCap, globalCap],
    )).rows[0].r
  );

const claim = (db: PGlite, env = "prod", limit = 10) =>
  asService(db, async (tx) => (await tx.query<Job>("select * from public.assistant_claim_jobs($1, $2, 60)", [env, limit])).rows);

const ack = (db: PGlite, job: Job, ok: boolean, error?: string) =>
  asService(db, async (tx) =>
    (await tx.query<{ ok: boolean }>("select public.assistant_ack_job($1, $2, $3, $4) ok", [job.id, job.lease_token, ok, error ?? null]))
      .rows[0].ok
  );

const expireLeases = (db: PGlite) => db.query("update public.assistant_jobs set leased_until = now() - interval '1 second' where status = 'leased'");

Deno.test("send stores the message and queues one job; a retried send returns the original", async () => {
  const db = await migratedDb();
  const u = await createUser(db);
  const first = await send(db, u, "  How was my week?  ", "c1");
  assertEquals([first.duplicate, first.job_status, first.environment], [false, "pending", "prod"]);
  assertEquals((first.message as { doc: { text: string } }).doc.text, "How was my week?");
  const again = await send(db, u, "How was my week?", "c1");
  assertEquals([again.duplicate, (again.message as { id: string }).id], [true, (first.message as { id: string }).id]);
  assertEquals((await all(db, "select 1 from public.assistant_jobs")).length, 1);
  await db.close();
});

Deno.test("send refuses bad input and enforces the per-account and global daily caps", async () => {
  const db = await migratedDb();
  const [a, b] = [await createUser(db), await createUser(db)];
  await assertRejects(() => send(db, a, "   ", "c0"), Error, "invalid_input");
  await assertRejects(() => send(db, a, "x".repeat(2001), "c0"), Error, "invalid_input");
  await send(db, a, "one", "c1", 2);
  await send(db, a, "two", "c2", 2);
  await assertRejects(() => send(db, a, "three", "c3", 2), Error, "user_daily_cap");
  // A retry of a message already stored still answers after the cap is hit.
  assertEquals((await send(db, a, "two", "c2", 2)).duplicate, true);
  await assertRejects(() => send(db, b, "hello", "c1", 50, 2), Error, "global_daily_cap");
  await db.close();
});

Deno.test("a team account with a dev row is routed to the dev queue", async () => {
  const db = await migratedDb();
  const u = await createUser(db);
  await db.query("insert into public.assistant_agents (user_id, environment) values ($1, 'dev')", [u]);
  assertEquals((await send(db, u, "hi", "c1")).environment, "dev");
  assertEquals(await claim(db, "prod"), []);
  assertEquals((await claim(db, "dev")).length, 1);
  await db.close();
});

Deno.test("claim hands out one job per user, oldest first, and holds a user's next message until the first is acked", async () => {
  const db = await migratedDb();
  const [a, b] = [await createUser(db), await createUser(db)];
  await send(db, a, "a1", "a1");
  await send(db, b, "b1", "b1");
  await send(db, a, "a2", "a2");
  const first = await claim(db);
  assertEquals(first.map((j) => j.user_id), [a, b]);
  assertEquals(first.every((j) => j.status === "leased" && j.attempts === 1), true);
  assertEquals(await claim(db), []);
  assertEquals(await ack(db, first[0], true), true);
  const next = await claim(db);
  assertEquals(next.length, 1);
  assertEquals((await one<{ t: string }>(db, "select m.doc->>'text' t from public.assistant_messages m join public.assistant_jobs j on j.message_id = m.id where j.id = $1", [next[0].id]))!.t, "a2");
  await db.close();
});

Deno.test("an expired lease is claimed again and the old holder's ack is refused", async () => {
  const db = await migratedDb();
  const u = await createUser(db);
  await send(db, u, "hi", "c1");
  const [old] = await claim(db);
  await expireLeases(db);
  const [renewed] = await claim(db);
  assertEquals([renewed.id, renewed.attempts], [old.id, 2]);
  assertEquals(await ack(db, old, true), false);
  assertEquals(await ack(db, renewed, true), true);
  assertEquals(await ack(db, renewed, true), false);
  await db.close();
});

Deno.test("a failed attempt goes back to the queue until max_attempts, then fails", async () => {
  const db = await migratedDb();
  const u = await createUser(db);
  await send(db, u, "hi", "c1");
  await db.query("update public.assistant_jobs set max_attempts = 2");
  await ack(db, (await claim(db))[0], false, "hermes timeout");
  assertEquals((await one<{ status: string }>(db, "select status from public.assistant_jobs"))!.status, "pending");
  await ack(db, (await claim(db))[0], false, "hermes timeout");
  assertEquals(await one(db, "select status, attempts, last_error from public.assistant_jobs"), {
    status: "failed",
    attempts: 2,
    last_error: "hermes timeout",
  });
  assertEquals(await claim(db), []);
  // An expired lease on the last attempt is failed by the next claim, not handed out.
  await send(db, u, "again", "c2");
  await db.query("update public.assistant_jobs set max_attempts = 1 where status = 'pending'");
  await claim(db);
  await expireLeases(db);
  assertEquals(await claim(db), []);
  assertEquals((await one<{ e: string }>(db, "select last_error e from public.assistant_jobs where max_attempts = 1"))!.e, "lease expired");
  await db.close();
});

Deno.test("a deferred job keeps its attempt and its place: the user's later message waits behind it", async () => {
  const db = await migratedDb();
  const u = await createUser(db);
  await send(db, u, "first", "c1");
  await send(db, u, "second", "c2");
  const [job] = await claim(db);
  const deferred = await asService(db, async (tx) =>
    (await tx.query<{ ok: boolean }>("select public.assistant_defer_job('prod', $1, $2, 30, 'capacity') ok", [job.id, job.lease_token])).rows[0].ok
  );
  assertEquals(deferred, true);
  assertEquals(await one(db, "select status, attempts from public.assistant_jobs where id = $1", [job.id]), { status: "pending", attempts: 0 });
  assertEquals(await claim(db), []);
  await db.query("update public.assistant_jobs set not_before = now() - interval '1 second' where id = $1", [job.id]);
  assertEquals((await claim(db)).map((j) => j.id), [job.id]);
  // Deferring with a lease that isn't held is refused.
  const stale = await asService(db, async (tx) =>
    (await tx.query<{ ok: boolean }>("select public.assistant_defer_job('prod', $1, gen_random_uuid(), 30) ok", [job.id])).rows[0].ok
  );
  assertEquals(stale, false);
  await db.close();
});

Deno.test("delivery stores one reply per job, finishes it, and refuses a lost lease", async () => {
  const db = await migratedDb();
  const u = await createUser(db);
  await send(db, u, "hi", "c1");
  const [job] = await claim(db);
  const complete = (token: string | null, skip = false) =>
    asService(db, async (tx) =>
      (await tx.query<{ r: Record<string, unknown> }>(
        "select public.assistant_complete_job('prod', $1, $2, $3, $4) r",
        [job.id, token, { text: "Solid week." }, skip],
      )).rows[0].r
    );
  await assertRejects(() => complete(crypto.randomUUID()), Error, "lease_lost");
  const delivered = await complete(job.lease_token);
  assertEquals(delivered.status, "delivered");
  const again = await complete(job.lease_token);
  assertEquals([again.status, again.message_id], ["already_delivered", delivered.message_id]);
  assertEquals(await one(db, "select status from public.assistant_jobs"), { status: "done" });
  const replies = await all<{ doc: { text: string; kind: string } }>(db, "select doc from public.assistant_messages where role = 'assistant'");
  assertEquals(replies.map((r) => [r.doc.text, r.doc.kind]), [["Solid week.", "chat"]]);
  await assertRejects(
    () => asService(db, (tx) => tx.query("select public.assistant_complete_job('dev', $1, $2, '{}'::jsonb)", [job.id, job.lease_token])),
    Error,
    "job_not_found",
  );
  await db.close();
});

Deno.test("the job context carries the message, earlier history, facts, persona and sandbox", async () => {
  const db = await migratedDb();
  const u = await createUser(db);
  await db.query(
    "insert into public.coach_profiles (user_id, coach_name, language, tone_preset, accountability_style, persona_freeform) values ($1, 'Notch', 'en', 'calm_precise', 'gentle', '  short answers  ')",
    [u],
  );
  await db.query("insert into public.assistant_messages (user_id, role, doc, created_at) values ($1, 'user', '{\"text\":\"earlier\"}', now() - interval '1 hour')", [u]);
  await db.query(
    `insert into public.user_facts (user_id, doc, score, pinned) values ($1, '{"text":"left shoulder is cranky","category":"health","importance":5,"stability":"long_term","evidence":"explicit"}', 1, true)`,
    [u],
  );
  await send(db, u, "now", "c1");
  const [job] = await claim(db);
  const ctx = await asService(db, async (tx) =>
    (await tx.query<{ c: Record<string, any> }>("select public.assistant_job_context($1) c", [job.id])).rows[0].c
  );
  assertEquals(ctx.message.text, "now");
  assertEquals(ctx.history.map((h: { text: string }) => h.text), ["earlier"]);
  assertEquals(ctx.facts, [{ text: "left shoulder is cranky", category: "health", pinned: true }]);
  assertEquals([ctx.user.language, ctx.user.coach_name, ctx.user.accountability, ctx.user.persona], ["en", "Notch", "gentle", "short answers"]);
  assertEquals(ctx.agent, null);
  await db.close();
});

Deno.test("two messages in a row: the second turn's history has the reply to the first", async () => {
  const db = await migratedDb();
  const u = await createUser(db);
  await send(db, u, "hi", "c1");
  await send(db, u, "how was my week?", "c2");
  await send(db, u, "and next week?", "c3");
  const [first] = await claim(db);
  await asService(db, (tx) => tx.query("select public.assistant_complete_job('prod', $1, $2, '{\"text\":\"Hey! What can I do?\"}')", [first.id, first.lease_token]));
  const [second] = await claim(db);
  const ctx = await asService(db, async (tx) =>
    (await tx.query<{ c: Record<string, any> }>("select public.assistant_job_context($1) c", [second.id])).rows[0].c
  );
  assertEquals(ctx.message.text, "how was my week?");
  // The reply was stored after the second message was sent, and the third
  // message is a later turn: neither order of arrival may hide or leak them.
  assertEquals(ctx.history.map((h: { role: string; text: string }) => `${h.role}: ${h.text}`), [
    "user: hi",
    "assistant: Hey! What can I do?",
  ]);
  await db.close();
});

Deno.test("check-ins: one per opted-in user a day, only with both flags, stale ones failed", async () => {
  const db = await migratedDb();
  const [both, chatOnly] = [await createUser(db), await createUser(db)];
  await createUser(db); // no flags at all
  await db.query("insert into public.user_flags (user_id, flag) values ($1, 'assistant_chat'), ($1, 'assistant_checkin'), ($2, 'assistant_chat')", [both, chatOnly]);
  const enqueue = (day: string) =>
    asService(db, async (tx) => (await tx.query<{ n: number }>("select public.assistant_enqueue_checkins($1::date) n", [day])).rows[0].n);
  assertEquals(await enqueue("2026-10-01"), 1);
  assertEquals(await enqueue("2026-10-01"), 0);
  assertEquals((await all<{ user_id: string }>(db, "select user_id from public.assistant_jobs where kind = 'checkin'")).map((r) => r.user_id), [both]);
  assertEquals(await enqueue("2026-10-02"), 1);
  assertEquals(
    await all(db, "select dedup_key, status from public.assistant_jobs order by dedup_key"),
    [{ dedup_key: "checkin:2026-10-01", status: "failed" }, { dedup_key: "checkin:2026-10-02", status: "pending" }],
  );
  // The kill switch stops them for everyone.
  await db.query("update public.feature_flags set enabled = false where flag = 'assistant_chat'");
  assertEquals(await enqueue("2026-10-03"), 0);
  await db.close();
});

Deno.test("a check-in from an earlier day is failed by the claim, never sent late; today's goes out", async () => {
  const db = await migratedDb();
  const u = await createUser(db);
  await db.query("insert into public.user_flags (user_id, flag) values ($1, 'assistant_chat'), ($1, 'assistant_checkin')", [u]);
  const days = (await one<{ yesterday: string; today: string }>(
    db,
    "select ((now() at time zone 'utc')::date - 1)::text yesterday, (now() at time zone 'utc')::date::text today",
  ))!;
  const enqueue = (day: string) => asService(db, (tx) => tx.query("select public.assistant_enqueue_checkins($1::date)", [day]));
  const statusOf = async (day: string) =>
    (await one<{ status: string; last_error: string | null }>(db, "select status, last_error from public.assistant_jobs where dedup_key = $1", [`checkin:${day}`]))!;

  // Held back past UTC midnight (the spend ceiling, a relay outage): never
  // claimed, failed as stale, and it no longer holds the user's place in line.
  await enqueue(days.yesterday);
  await send(db, u, "a question", "c1");
  const claimed = await claim(db);
  assertEquals(claimed.map((j) => j.kind), ["chat"]);
  assertEquals(await statusOf(days.yesterday), { status: "failed", last_error: "stale: not sent on its day" });
  await ack(db, claimed[0], true);

  // Today's check-in is claimed as usual.
  await enqueue(days.today);
  assertEquals((await claim(db)).map((j) => j.kind), ["checkin"]);
  await db.close();
});

Deno.test("a stale check-in still being answered finishes; handed back or left to expire, it's failed", async () => {
  const db = await migratedDb();
  const [a, b] = [await createUser(db), await createUser(db)];
  await db.query(
    "insert into public.user_flags (user_id, flag) values ($1, 'assistant_chat'), ($1, 'assistant_checkin'), ($2, 'assistant_chat'), ($2, 'assistant_checkin')",
    [a, b],
  );
  const yesterday = (await one<{ d: string }>(db, "select ((now() at time zone 'utc')::date - 1)::text d"))!.d;
  // Leased on its day (set directly: a claim today would fail them), the
  // leases still live after midnight: they're being answered and are left be.
  await asService(db, (tx) => tx.query("select public.assistant_enqueue_checkins($1::date)", [yesterday]));
  const [ja, jb] = await all<Job>(
    db,
    "update public.assistant_jobs set status = 'leased', attempts = 1, lease_token = gen_random_uuid(), leased_until = now() + interval '60 seconds' returning *",
  ).then((rows) => rows.sort((x, y) => x.id - y.id));
  assertEquals(await claim(db), []);
  assertEquals((await all<{ status: string }>(db, "select status from public.assistant_jobs order by id")).map((r) => r.status), ["leased", "leased"]);
  // a's is deferred (handed back to pending), b's lease runs out: the next claim fails both.
  await asService(db, (tx) => tx.query("select public.assistant_defer_job('prod', $1, $2, 1, 'capacity')", [ja.id, ja.lease_token]));
  await db.query("update public.assistant_jobs set not_before = now() - interval '1 second' where id = $1", [ja.id]);
  await db.query("update public.assistant_jobs set leased_until = now() - interval '1 second' where id = $1", [jb.id]);
  assertEquals(await claim(db), []);
  assertEquals(
    await all(db, "select status, last_error from public.assistant_jobs order by id"),
    [{ status: "failed", last_error: "stale: not sent on its day" }, { status: "failed", last_error: "stale: not sent on its day" }],
  );
  await db.close();
});

Deno.test("a check-in's history ends when it was queued: a message sent while it waited is its own turn", async () => {
  const db = await migratedDb();
  const u = await createUser(db);
  await db.query("insert into public.user_flags (user_id, flag) values ($1, 'assistant_chat'), ($1, 'assistant_checkin')", [u]);
  await db.query("insert into public.assistant_messages (user_id, role, doc, created_at) values ($1, 'user', '{\"text\":\"yesterday\"}', now() - interval '1 day')", [u]);
  await db.query("insert into public.assistant_messages (user_id, role, doc, created_at) values ($1, 'assistant', '{\"text\":\"see you\"}', now() - interval '23 hours')", [u]);
  await asService(db, (tx) => tx.query("select public.assistant_enqueue_checkins()"));
  await db.query("update public.assistant_jobs set created_at = now() - interval '1 minute' where kind = 'checkin'");
  await send(db, u, "what's my workout today?", "c1");
  const [job] = await claim(db);
  assertEquals(job.kind, "checkin");
  const ctx = await asService(db, async (tx) =>
    (await tx.query<{ c: Record<string, any> }>("select public.assistant_job_context($1) c", [job.id])).rows[0].c
  );
  assertEquals(ctx.message, null);
  assertEquals(ctx.history.map((h: { role: string; text: string }) => `${h.role}: ${h.text}`), ["user: yesterday", "assistant: see you"]);
  await db.close();
});

Deno.test("the app sees only its own open chat jobs, without errors or leases", async () => {
  const db = await migratedDb();
  const [a, b] = [await createUser(db), await createUser(db)];
  await send(db, a, "a1", "a1");
  await send(db, b, "b1", "b1");
  const mine = await asUser(db, a, async (tx) => (await tx.query("select * from public.assistant_my_open_jobs()")).rows);
  assertEquals(mine.length, 1);
  assertEquals(Object.keys(mine[0] as object).sort(), ["message_id", "status", "updated_at"]);
  await db.close();
});

Deno.test("recording a sandbox: only for the environment's own users, with a name it owns", async () => {
  const db = await migratedDb();
  const [p, d] = [await createUser(db), await createUser(db)];
  await db.query("insert into public.assistant_agents (user_id, environment) values ($1, 'dev')", [d]);
  const record = (env: string, user: string, name: string) =>
    asService(db, async (tx) =>
      (await tx.query<{ r: string }>("select public.assistant_agent_record($1, $2, $3, $4) r", [env, user, name, "a".repeat(64)])).rows[0].r
    );
  assertEquals(await record("prod", p, "notch-prod-1"), "recorded");
  assertEquals(await record("prod", d, "notch-prod-2"), "wrong_environment");
  assertEquals(await record("prod", crypto.randomUUID(), "notch-prod-3"), "user_gone");
  await assertRejects(() => record("prod", p, "notch-dev-1"), Error, "invalid_input");
  // Recording again is an update, not a second row.
  assertEquals(await record("prod", p, "notch-prod-1"), "recorded");
  const listed = await asService(db, async (tx) => (await tx.query("select * from public.assistant_agents_list('prod')")).rows);
  assertEquals(listed, [{ user_id: p, sandbox_name: "notch-prod-1" }]);
  const resolved = await asService(db, async (tx) =>
    (await tx.query<{ u: string }>("select public.assistant_user_for_tool_token($1) u", ["a".repeat(64)])).rows[0].u
  );
  assertEquals(resolved, p);
  await db.close();
});
