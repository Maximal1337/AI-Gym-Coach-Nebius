// Personalization memory (NH-60, NH-63), feature flags (NH-10, NH-57) and the
// spend ledger (NH-38).
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.4.6";
import { all, asService, asUser, createUser, migratedDb, one } from "./db.ts";

const fact = (text: string, category = "preference", importance = 3) => ({
  text,
  category,
  importance,
  stability: "long_term",
  evidence: "explicit",
});

const insertFact = (db: PGlite, user: string, doc: object, pinned = false) =>
  one<{ id: string }>(db, "insert into public.user_facts (user_id, doc, pinned) values ($1, $2, $3) returning id", [user, doc, pinned]);

const version = async (db: PGlite, user: string) =>
  (await one<{ v: number }>(db, "select facts_version::int v from public.user_memory_state where user_id = $1", [user]))?.v;

const apply = (db: PGlite, user: string, remove: string[], updates: object[], inserts: object[], watermark: string | null) =>
  asService(db, async (tx) =>
    (await tx.query<{ r: Record<string, number> }>(
      "select public.assistant_memory_apply($1, $2::uuid[], $3, $4, $5) r",
      [user, remove, JSON.stringify(updates), JSON.stringify(inserts), watermark],
    )).rows[0].r
  );

Deno.test("facts: at most 15 per user and 3 pinned, pins only on health facts, bad documents refused", async () => {
  const db = await migratedDb();
  const u = await createUser(db);
  for (let i = 0; i < 15; i++) await insertFact(db, u, fact(`fact ${i}`));
  await assertRejects(() => insertFact(db, u, fact("one too many")), Error, "already has 15 facts");
  const v = await createUser(db);
  for (let i = 0; i < 3; i++) await insertFact(db, v, fact(`injury ${i}`, "health"), true);
  await assertRejects(() => insertFact(db, v, fact("injury 3", "health"), true), Error, "already has 3 pinned facts");
  const w = await createUser(db);
  await assertRejects(() => insertFact(db, w, fact("likes mornings"), true), Error, "violates check constraint");
  for (const bad of [{ ...fact("x"), category: "secret" }, { ...fact("x"), importance: 6 }, { ...fact("x"), importance: "3" }, fact("x".repeat(141)), { text: "x" }]) {
    await assertRejects(() => insertFact(db, v, bad), Error, "violates check constraint", JSON.stringify(bad));
  }
  await db.close();
});

Deno.test("a user deletes their own fact, not someone else's, and the facts version moves", async () => {
  const db = await migratedDb();
  const [u, other] = [await createUser(db), await createUser(db)];
  const mine = await insertFact(db, u, fact("trains Thursdays", "schedule"));
  const theirs = await insertFact(db, other, fact("has dumbbells", "equipment"));
  assertEquals(await version(db, u), 1);
  // A score-only refresh doesn't count as a change.
  await db.query("update public.user_facts set score = 0.5 where id = $1", [mine!.id]);
  assertEquals(await version(db, u), 1);
  await asUser(db, u, (tx) => tx.query("delete from public.user_facts where id = any($1::uuid[])", [[mine!.id, theirs!.id]]));
  assertEquals(await all(db, "select user_id from public.user_facts"), [{ user_id: other }]);
  assertEquals(await version(db, u), 2);
  await assertRejects(
    () => asUser(db, u, (tx) => tx.query("insert into public.user_facts (user_id, doc) values ($1, $2)", [u, fact("made up")])),
    Error,
    "permission denied",
  );
  await db.close();
});

Deno.test("memory apply removes before it inserts, so a full list can swap a fact, and the watermark only moves forward", async () => {
  const db = await migratedDb();
  const u = await createUser(db);
  const ids: string[] = [];
  for (let i = 0; i < 15; i++) ids.push((await insertFact(db, u, fact(`fact ${i}`)))!.id);
  const r = await apply(db, u, [ids[0]], [{ id: ids[1], score: 0.9, doc: fact("fact 1, reinforced") }], [{ doc: fact("new fact"), score: 0.7 }], "2026-10-02T10:00:00Z");
  assertEquals(r, { removed: 1, inserted: 1, facts: 15 });
  assertEquals((await one<{ t: string }>(db, "select doc->>'text' t from public.user_facts where id = $1", [ids[1]]))!.t, "fact 1, reinforced");
  await apply(db, u, [], [], [], "2026-10-01T00:00:00Z");
  const state = await one<{ w: string; err: string | null }>(db, "select watermark::text w, last_error err from public.user_memory_state where user_id = $1", [u]);
  assertEquals(state, { w: "2026-10-02 10:00:00+00", err: null });
  await db.close();
});

Deno.test("memory apply can unpin one health fact and pin another when three are already pinned", async () => {
  const db = await migratedDb();
  const u = await createUser(db);
  const pinned: string[] = [];
  for (let i = 0; i < 3; i++) pinned.push((await insertFact(db, u, fact(`injury ${i}`, "health"), true))!.id);
  const spare = (await insertFact(db, u, fact("new injury", "health")))!.id;
  await apply(db, u, [], [{ id: spare, score: 1, pinned: true }, { id: pinned[0], score: 0.2, pinned: false }], [], null);
  assertEquals(
    (await all<{ t: string }>(db, "select doc->>'text' t from public.user_facts where pinned order by 1")).map((r) => r.t),
    ["injury 1", "injury 2", "new injury"],
  );
  await db.close();
});

Deno.test("due users: flagged, not run today, with facts or new messages; a failure counts as today's run", async () => {
  const db = await migratedDb();
  const [withFacts, withMessage, quiet, unflagged] = [await createUser(db), await createUser(db), await createUser(db), await createUser(db)];
  for (const u of [withFacts, withMessage, quiet]) await db.query("insert into public.user_flags (user_id, flag) values ($1, 'assistant_memory')", [u]);
  await insertFact(db, withFacts, fact("likes mornings"));
  await insertFact(db, unflagged, fact("likes evenings"));
  await db.query("insert into public.assistant_messages (user_id, role, doc) values ($1, 'user', '{\"text\":\"my shoulder hurts\"}')", [withMessage]);
  const due = async () =>
    (await asService(db, async (tx) => (await tx.query<{ u: string }>("select u from public.assistant_memory_due(10) u")).rows)).map((r) => r.u).sort();
  assertEquals(await due(), [withFacts, withMessage].sort());
  await asService(db, (tx) => tx.query("select public.assistant_memory_mark_failed($1, 'model timeout')", [withMessage]));
  assertEquals(await due(), [withFacts]);
  const sources = await asService(db, async (tx) =>
    (await tx.query<{ s: Record<string, any> }>("select public.assistant_memory_sources($1) s", [withMessage])).rows[0].s
  );
  assertEquals([sources.messages.length, sources.watermark], [1, null]);
  await db.close();
});

Deno.test("flags: on only when the global switch and the user's row are both on; the kill switch hides them", async () => {
  const db = await migratedDb();
  const [u, other] = [await createUser(db), await createUser(db)];
  await db.query("insert into public.user_flags (user_id, flag) values ($1, 'assistant_chat'), ($1, 'assistant_memory'), ($1, 'assistant_workout')", [u]);
  const mine = async (user: string) => (await asUser(db, user, async (tx) => (await tx.query<{ f: string[] }>("select public.my_feature_flags() f")).rows[0].f));
  assertEquals(await mine(u), ["assistant_chat", "assistant_memory"]); // assistant_workout is off globally
  assertEquals(await mine(other), []);
  await db.query("update public.feature_flags set enabled = false where flag like 'assistant_%'");
  assertEquals(await mine(u), []);
  await db.query("update public.feature_flags set enabled = true where flag in ('assistant_chat', 'assistant_memory')");
  assertEquals(await mine(u), ["assistant_chat", "assistant_memory"]);
  await db.close();
});

Deno.test("spend adds up per UTC day and bucket, and refuses negative amounts", async () => {
  const db = await migratedDb();
  const record = (bucket: string, cents: number) =>
    asService(db, async (tx) => Number((await tx.query<{ t: string }>("select public.assistant_record_spend($1, 100, 20, $2) t", [bucket, cents])).rows[0].t));
  assertEquals(await record("prod", 1.25), 1.25);
  assertEquals(await record("prod", 0.5), 1.75);
  assertEquals(await record("memory", 3), 3);
  const today = await asService(db, async (tx) => Number((await tx.query<{ t: string }>("select public.assistant_spend_today('prod') t")).rows[0].t));
  assertEquals(today, 1.75);
  assertEquals(await one(db, "select calls, tokens_input::int ti from public.assistant_spend where bucket = 'prod'"), { calls: 2, ti: 200 });
  await assertRejects(() => record("prod", -1), Error, "must not be negative");
  await assertRejects(() => record("staging", 1), Error, "violates check constraint");
  await db.close();
});
