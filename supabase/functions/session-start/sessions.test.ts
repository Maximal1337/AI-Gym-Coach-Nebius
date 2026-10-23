// Tests for session-start's clean-up of other open workouts. Run: deno test --no-config supabase/functions/
import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { abandonOtherSessions } from "./sessions.ts";

type Row = { id: string; user_id: string; status: string };

/** workout_sessions as rows: an update applies to the rows its eq/neq filters match. */
function fakeDb(rows: Row[], error: { message: string } | null = null) {
  const db = {
    from: (_table: string) => ({
      update: (values: Partial<Row>) => {
        const eq: Array<[keyof Row, string]> = [];
        const neq: Array<[keyof Row, string]> = [];
        const q = {
          eq: (col: keyof Row, v: string) => (eq.push([col, v]), q),
          neq: (col: keyof Row, v: string) => {
            neq.push([col, v]);
            if (!error) {
              for (const r of rows) {
                if (eq.every(([c, x]) => r[c] === x) && neq.every(([c, x]) => r[c] !== x)) Object.assign(r, values);
              }
            }
            return Promise.resolve({ error });
          },
        };
        return q;
      },
    }),
  } as unknown as Pick<SupabaseClient, "from">;
  return db;
}

Deno.test("abandons the user's other open sessions, keeps the started one", async () => {
  const rows: Row[] = [
    { id: "s-old", user_id: "u1", status: "in_progress" },
    { id: "s-new", user_id: "u1", status: "in_progress" },
    { id: "s-done", user_id: "u1", status: "completed" },
    { id: "s-other-user", user_id: "u2", status: "in_progress" },
  ];
  await abandonOtherSessions(fakeDb(rows), "u1", "s-new");
  assertEquals(rows.map((r) => `${r.id}:${r.status}`), [
    "s-old:abandoned",
    "s-new:in_progress",
    "s-done:completed",
    "s-other-user:in_progress",
  ]);
});

Deno.test("a failed update never throws: the workout still starts", async () => {
  const rows: Row[] = [{ id: "s-old", user_id: "u1", status: "in_progress" }];
  await abandonOtherSessions(fakeDb(rows, { message: "boom" }), "u1", "s-new");
  assertEquals(rows[0].status, "in_progress");
});
