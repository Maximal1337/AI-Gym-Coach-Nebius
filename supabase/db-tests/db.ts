// SQL checks against a real Postgres 17 (PGlite) with every migration in
// supabase/migrations applied, so CI catches a migration that doesn't apply
// or a SQL function that misbehaves without a Supabase project. What Supabase
// provides before the first migration comes from supabase-stubs.sql.
//
//   DENO_NO_PACKAGE_JSON=1 deno test --no-config --allow-read supabase/db-tests/
//
// --allow-read is for the migrations and for PGlite's own files in Deno's npm cache.
import { PGlite, type Transaction } from "npm:@electric-sql/pglite@0.4.6";

export type Tx = Transaction;

const migrations = new URL("../migrations/", import.meta.url);
const stubs = new URL("./supabase-stubs.sql", import.meta.url);

let snapshot: File | Blob | undefined;

async function build(): Promise<File | Blob> {
  const db = await PGlite.create();
  await db.exec(await Deno.readTextFile(stubs));
  const files = [...Deno.readDirSync(migrations)].map((e) => e.name).filter((n) => n.endsWith(".sql")).sort();
  for (const name of files) {
    try {
      await db.exec(await Deno.readTextFile(new URL(name, migrations)));
    } catch (e) {
      throw new Error(`migration ${name} failed: ${(e as Error).message}`);
    }
  }
  const dump = await db.dumpDataDir("none");
  await db.close();
  return dump;
}

/** A fresh database with every migration applied. Built once, then copied. */
export async function migratedDb(): Promise<PGlite> {
  snapshot ??= await build();
  return await PGlite.create({ loadDataDir: snapshot });
}

/** The migration file names, in the order they apply. */
export function migrationNames(): string[] {
  return [...Deno.readDirSync(migrations)].map((e) => e.name).filter((n) => n.endsWith(".sql")).sort();
}

type Querier = Pick<PGlite, "query">;

/** The first row of a query, or undefined. */
export async function one<T = Record<string, unknown>>(db: Querier, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await db.query<T>(sql, params)).rows[0];
}

/** All rows of a query. */
export async function all<T = Record<string, unknown>>(db: Querier, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/**
 * A signed-up user: the auth row Supabase Auth would create and the public
 * profile row the app's Edge Function creates. Backdated so the signup rate
 * limit (20 in 10 minutes) never trips however many users a test makes.
 */
export async function createUser(db: Querier, email = `${crypto.randomUUID()}@example.test`): Promise<string> {
  const row = await one<{ id: string }>(
    db,
    "insert into auth.users (email, created_at) values ($1, now() - interval '1 day') returning id",
    [email],
  );
  await db.query("insert into public.users (id) values ($1)", [row!.id]);
  return row!.id;
}

/** Runs `fn` as PostgREST would for a signed-in user: role authenticated, the JWT's subject set. */
export async function asUser<T>(db: PGlite, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return await db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await tx.query("set local role authenticated");
    return await fn(tx);
  });
}

/** Runs `fn` as an Edge Function's admin client: role service_role. */
export async function asService<T>(db: PGlite, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return await db.transaction(async (tx) => {
    await tx.query("set local role service_role");
    return await fn(tx);
  });
}

/** Runs `fn` as a client with no session: role anon. */
export async function asAnon<T>(db: PGlite, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return await db.transaction(async (tx) => {
    await tx.query("set local role anon");
    return await fn(tx);
  });
}
