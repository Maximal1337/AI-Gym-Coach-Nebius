// Tests for My Coach's turns on Token Factory (DOR-135). Run: deno test --no-config supabase/functions/
import { assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { costCents, FALLBACK_TURN_USAGE, LIMIT_REACHED_ERROR, type SpendBucket } from "./assistant.ts";
import {
  coachAgentCall,
  coachFlagRefusal,
  CoachInputError,
  coachModel,
  type CoachPath,
  type CoachReply,
  DEFAULT_COACH_MODEL,
  setsLoggedReply,
} from "./coach.ts";

const MODEL = "nvidia/nemotron-3-super-120b-a12b";
const CEILINGS: Record<SpendBucket, number> = { prod: 35, dev: 30, memory: 10, coach: 15 };
const USAGE = { tokensInput: 4200, tokensOutput: 300, costCents: 0.18 };

/** assistant_spend_today answers `spentToday`; every assistant_record_spend is kept. */
function fakeDb(spentToday: number | null) {
  const recorded: Array<Record<string, unknown>> = [];
  const db = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === "assistant_spend_today") {
        return Promise.resolve(spentToday === null ? { data: null, error: { message: "boom" } } : { data: spentToday, error: null });
      }
      recorded.push(args);
      return Promise.resolve({ data: 1, error: null });
    },
  } as unknown as Pick<SupabaseClient, "rpc">;
  return { db, recorded };
}

function runner(result: CoachReply | Error | { status: number }) {
  const calls: Array<{ path: CoachPath; apiKey: string | null }> = [];
  const run = (path: CoachPath, _payload: unknown, apiKey: string | null) => {
    calls.push({ path, apiKey });
    return result instanceof Error || "status" in result ? Promise.reject(result) : Promise.resolve(result);
  };
  return { run, calls };
}

const call = (db: Pick<SupabaseClient, "rpc">, run: ReturnType<typeof runner>["run"], apiKey = "tf-key") =>
  coachAgentCall(db, run, { apiKey, model: MODEL, ceilings: CEILINGS });

Deno.test("under the ceiling: the agent runs on the key, its spend is recorded and priced at Token Factory's rates", async () => {
  const { db, recorded } = fakeDb(3);
  const { run, calls } = runner({ message: "Squat: 82.5 kg", loggedSets: [{ weightKg: 82.5, reps: 8 }], usage: USAGE, degraded: false } as CoachReply);
  const res = await call(db, run)({ any: "payload" }, "/converse");
  assertEquals(res.status, 200);
  assertEquals(calls, [{ path: "/converse", apiKey: "tf-key" }]);
  const body = await res.json();
  assertEquals(body.message, "Squat: 82.5 kg");
  assertEquals(body.loggedSets, [{ weightKg: 82.5, reps: 8 }]);
  const priced = costCents(MODEL, USAGE);
  assertAlmostEquals(body.usage.costCents, priced, 1e-9);
  assertEquals(recorded.length, 1);
  assertEquals(recorded[0].p_bucket, "coach");
  assertEquals(recorded[0].p_tokens_input, 4200);
  assertAlmostEquals(recorded[0].p_cost_cents as number, priced, 1e-9);
});

Deno.test("at the ceiling: a workout doesn't start and free text isn't read, with nothing sent to the model", async () => {
  for (const path of ["/turn", "/converse"] as const) {
    const { db, recorded } = fakeDb(15);
    const { run, calls } = runner({ message: "x", usage: USAGE });
    const res = await call(db, run)({}, path);
    assertEquals(res.status, 503);
    assertEquals(await res.json(), { error: "coach_unavailable", reason: LIMIT_REACHED_ERROR });
    assertEquals(calls.length, 0);
    assertEquals(recorded.length, 0);
  }
});

Deno.test("at the ceiling: confirmed sets are answered without a key, free, in the user's language", async () => {
  const { db, recorded } = fakeDb(20);
  const { run, calls } = runner({ message: "Logged 82.5kg x 8/8/7. Let's keep going!", nextSuggestedWeightKg: 60, usage: { tokensInput: 0, tokensOutput: 0, costCents: 0 }, degraded: true } as CoachReply);
  const payload = {
    profile: { language: "he", units: "metric" },
    confirmedSets: [{ weightKg: 82.5, reps: 8 }, { weightKg: 82.5, reps: 8 }, { weightKg: 82.5, reps: 7 }],
  };
  const res = await call(db, run)(payload, "/confirm-turn");
  assertEquals(res.status, 200);
  assertEquals(calls, [{ path: "/confirm-turn", apiKey: null }]);
  const body = await res.json();
  assertEquals(body.message, "רשמתי: 82.5kg × 8/8/7. ממשיכים!");
  assertEquals(body.nextSuggestedWeightKg, 60);
  assertEquals(body.degraded, true);
  assertEquals(body.usage, { tokensInput: 0, tokensOutput: 0, costCents: 0 });
  assertEquals(recorded.length, 0);
});

Deno.test("setsLoggedReply: the sets in the user's units, in their language, English otherwise", () => {
  const sets = (...s: Array<[number, number]>) => s.map(([weightKg, reps]) => ({ weightKg, reps }));
  assertEquals(
    setsLoggedReply({ profile: { language: "en", units: "metric" }, confirmedSets: sets([82.5, 8], [82.5, 7]) }),
    "Logged 82.5kg × 8/7. Let's keep going!",
  );
  assertEquals(
    setsLoggedReply({ profile: { language: "fr", units: "imperial" }, confirmedSets: sets([100, 5]) }),
    "C'est noté : 220.5lb × 5. On continue !",
  );
  assertEquals(
    setsLoggedReply({ profile: { language: "he-IL" }, confirmedSets: sets([80, 8], [82.5, 6]) }),
    "רשמתי: 80kg × 8, 82.5kg × 6. ממשיכים!",
  );
  assertEquals(setsLoggedReply({ profile: { language: "xx" }, confirmedSets: sets([20, 12]) }), "Logged 20kg × 12. Let's keep going!");
  assertEquals(setsLoggedReply({ profile: { language: "he" }, confirmedSets: [] }), null);
  assertEquals(setsLoggedReply(null), null);
});

Deno.test("coachFlagRefusal: the chat's flag, 403 assistant_disabled without it, closed when the check fails", async () => {
  const flagDb = (result: { data: unknown; error: { message: string } | null }) => {
    const calls: Array<Record<string, unknown>> = [];
    const db = {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, ...args });
        return Promise.resolve(result);
      },
    } as unknown as Pick<SupabaseClient, "rpc">;
    return { db, calls };
  };
  const on = flagDb({ data: true, error: null });
  assertEquals(await coachFlagRefusal(on.db, "user-1"), null);
  assertEquals(on.calls, [{ fn: "feature_enabled", p_user_id: "user-1", p_flag: "assistant_chat" }]);
  const refused = { status: 403, body: { error: "assistant_disabled" } };
  assertEquals(await coachFlagRefusal(flagDb({ data: false, error: null }).db, "user-1"), refused);
  assertEquals(await coachFlagRefusal(flagDb({ data: null, error: { message: "boom" } }).db, "user-1"), refused);
});

Deno.test("an unreadable spend total counts as the ceiling (fails closed)", async () => {
  const { db } = fakeDb(null);
  const { run, calls } = runner({ message: "x", usage: USAGE });
  assertEquals((await call(db, run)({}, "/turn")).status, 503);
  assertEquals(calls.length, 0);
});

Deno.test("a model reply without usage is charged the fallback, so the ceiling can't be switched off", async () => {
  const { db, recorded } = fakeDb(0);
  const { run } = runner({ message: "x", usage: { tokensInput: 0, tokensOutput: 0, costCents: 0 }, degraded: false } as CoachReply);
  const body = await (await call(db, run)({}, "/turn")).json();
  assertEquals(recorded[0].p_tokens_input, FALLBACK_TURN_USAGE.tokensInput);
  assertAlmostEquals(body.usage.costCents, costCents(MODEL, FALLBACK_TURN_USAGE), 1e-9);
});

Deno.test("a failed call is 503 and charged the fallback, unless the key was refused or the payload rejected", async () => {
  const failed = fakeDb(0);
  const res = await call(failed.db, runner(new Error("socket hang up")).run)({}, "/converse");
  assertEquals(res.status, 503);
  assertEquals(await res.json(), { error: "coach_unavailable" });
  assertEquals(failed.recorded.length, 1);
  assertEquals(failed.recorded[0].p_tokens_output, FALLBACK_TURN_USAGE.tokensOutput);

  const refused = fakeDb(0);
  assertEquals((await call(refused.db, runner({ status: 401 }).run)({}, "/turn")).status, 503);
  assertEquals(refused.recorded.length, 0);

  const rejected = fakeDb(0);
  const bad = await call(rejected.db, runner(new CoachInputError("invalid_input")).run)({}, "/turn");
  assertEquals(bad.status, 400);
  assertEquals(rejected.recorded.length, 0);
});

Deno.test("without the key nothing runs; an unknown route isn't the coach's", async () => {
  const { db, recorded } = fakeDb(0);
  const { run, calls } = runner({ message: "x", usage: USAGE });
  assertEquals(await (await call(db, run, "")({}, "/turn")).json(), { error: "agent_not_configured" });
  assertEquals((await call(db, run)({}, "/parse-plan")).status, 404);
  assertEquals(calls.length, 0);
  assertEquals(recorded.length, 0);
});

Deno.test("coachModel: Super unless COACH_MODEL names another", () => {
  assertEquals(DEFAULT_COACH_MODEL, MODEL);
  assertEquals(coachModel(() => undefined), MODEL);
  assertEquals(coachModel(() => ""), MODEL);
  assertEquals(coachModel(() => "nvidia/Nemotron-3_5-Lightning"), "nvidia/Nemotron-3_5-Lightning");
});
