// Tests for coach-turn's session check. Run: deno test --no-config supabase/functions/
import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { openSessionFor, SESSION_MAX_AGE_MS } from "./session.ts";

const NOW = Date.parse("2026-10-23T06:10:00Z");

/** workout_sessions with one row (or none): the select finds it by its filters; updates are kept. */
function fakeDb(row: Record<string, string> | null) {
  const updates: Array<{ values: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const db = {
    from: (_table: string) => ({
      select: (_cols: string) => {
        const filters: Record<string, unknown> = {};
        const q = {
          eq: (col: string, v: unknown) => {
            filters[col] = v;
            return q;
          },
          maybeSingle: () => {
            const hit = row && Object.entries(filters).every(([c, v]) => row[c] === v);
            return Promise.resolve({ data: hit ? row : null, error: null });
          },
        };
        return q;
      },
      update: (values: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {};
        const q = {
          eq: (col: string, v: unknown) => {
            filters[col] = v;
            if (Object.keys(filters).length === 2) updates.push({ values, filters });
            return q;
          },
        };
        return q;
      },
    }),
  } as unknown as Pick<SupabaseClient, "from">;
  return { db, updates };
}

const row = (startedAt: string, status = "in_progress") => ({
  id: "s1", user_id: "u1", plan_id: "p1", status, started_at: startedAt,
});

Deno.test("a running session of this user's is the turn's", async () => {
  const { db, updates } = fakeDb(row("2026-10-23T05:40:00Z"));
  const open = await openSessionFor(db, "u1", "s1", NOW);
  assertEquals("session" in open && open.session.id, "s1");
  assertEquals(updates, []);
});

Deno.test("a session that isn't there any more is session_expired (410), not a 404", async () => {
  // Reseeded away (the demo account on 2026-10-23), finished, or another user's.
  for (const db of [fakeDb(null).db, fakeDb(row("2026-10-23T05:40:00Z", "completed")).db]) {
    assertEquals(await openSessionFor(db, "u1", "s1", NOW), { status: 410, body: { error: "session_expired" } });
  }
  assertEquals(await openSessionFor(fakeDb(row("2026-10-23T05:40:00Z")).db, "u2", "s1", NOW), {
    status: 410,
    body: { error: "session_expired" },
  });
});

Deno.test("a session past its age is session_expired and marked abandoned", async () => {
  const { db, updates } = fakeDb(row(new Date(NOW - SESSION_MAX_AGE_MS - 1000).toISOString()));
  assertEquals(await openSessionFor(db, "u1", "s1", NOW), { status: 410, body: { error: "session_expired" } });
  assertEquals(updates, [{ values: { status: "abandoned" }, filters: { id: "s1", user_id: "u1" } }]);
});
