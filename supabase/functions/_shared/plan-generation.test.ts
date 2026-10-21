// Tests for plan generation on Token Factory (DOR-135). Run: deno test --no-config supabase/functions/
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { generatePlan, type GeneratePlanInput, lintPlan, planJsonSchema, PlanGenerationError, validatePlans } from "./plan-generation.ts";

const INTAKE: GeneratePlanInput = {
  primaryGoal: "hypertrophy", experienceLevel: "intermediate", daysPerWeek: 4,
  gender: null, age: null, weightKg: null, heightCm: null, injuryNotes: null, language: "he",
};
const exercise = (orderIndex: number, name: string) => ({
  orderIndex, name, sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell",
});
const PLANS = {
  plans: [
    { name: "אימון פלג גוף עליון", exercises: [exercise(1, "לחיצת חזה עם מוט"), exercise(2, "משיכת פולי עליון")] },
    { name: "אימון פלג גוף תחתון", exercises: [exercise(1, "סקוואט עם מוט"), exercise(2, "דדליפט רומני עם מוט")] },
  ],
};
const COMMON = [
  { name: "לחיצת חזה עם מוט", muscleGroup: "chest", movementPattern: "push" as const, equipmentType: "barbell", isCompound: true },
  { name: "סקוואט עם מוט", muscleGroup: "legs", movementPattern: "squat" as const, equipmentType: "barbell", isCompound: true },
];

function replying(content: string, usage = { prompt_tokens: 2400, completion_tokens: 1500 }) {
  const bodies: Record<string, unknown>[] = [];
  const f = ((_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    return Promise.resolve(new Response(JSON.stringify({ model: "nvidia/nemotron-3-super-120b-a12b", choices: [{ message: { content } }], usage })));
  }) as unknown as typeof fetch;
  return { f, bodies };
}

Deno.test("generatePlan: the few-shot in the user's language, the schema for the split's plan count, thinking off", async () => {
  const { f, bodies } = replying(JSON.stringify(PLANS));
  const r = await generatePlan(INTAKE, COMMON, { apiKey: "k", model: "nvidia/nemotron-3-super-120b-a12b", fetch: f });
  const body = bodies[0];
  assertEquals(body.reasoning_effort, "none");
  assertEquals(body.temperature, 0.3);
  const messages = body.messages as Array<{ role: string; content: string }>;
  assertEquals(messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
  assert(messages[0].content.includes("MUST be written in Hebrew"));
  assert(messages[2].content.includes("לחיצת חזה עם מוט"), "the Hebrew example");
  assert(messages[3].content.includes('"אימון פלג גוף עליון" (upper)'));
  const schema = (body.response_format as { json_schema: { schema: { properties: { plans: { minItems: number } } } } }).json_schema.schema;
  assertEquals(schema.properties.plans.minItems, 2);
  assertEquals(r.plans.length, 2);
  assertEquals(r.usage.tokensInput, 2400);
  assert(Math.abs(r.usage.costCents - (2400 * 30 + 1500 * 90) / 1_000_000) < 1e-9, "Super's list price");
});

Deno.test("generatePlan: the movement-pattern check runs for Hebrew only", async () => {
  const he = await generatePlan(INTAKE, COMMON, { apiKey: "k", model: "m", fetch: replying(JSON.stringify(PLANS)).f });
  assertEquals(he.linterChecks.filter((c) => c.covered).map((c) => c.pattern), ["push", "squat"]);
  const en = await generatePlan({ ...INTAKE, language: "en" }, COMMON, { apiKey: "k", model: "m", fetch: replying(JSON.stringify(PLANS)).f });
  assertEquals(en.linterChecks, []);
});

Deno.test("generatePlan: a reply that isn't a valid plan is a spent failure, with its usage", async () => {
  for (const content of ["not json", JSON.stringify({ plans: [] }), JSON.stringify({ plans: [{ name: "x", exercises: [{ ...exercise(1, "y"), sets: 0 }] }] })]) {
    const e = await assertRejects(() => generatePlan(INTAKE, [], { apiKey: "k", model: "m", fetch: replying(content).f }), PlanGenerationError);
    assertEquals(e.spent, true);
    assertEquals(e.usage, { tokensInput: 2400, tokensOutput: 1500 });
  }
});

Deno.test("generatePlan: refused before the model ran is not spent", async () => {
  const f = (() => Promise.resolve(new Response("{}", { status: 401 }))) as unknown as typeof fetch;
  const e = await assertRejects(() => generatePlan(INTAKE, [], { apiKey: "k", model: "m", fetch: f }), PlanGenerationError);
  assertEquals(e.spent, false);
});

Deno.test("validatePlans: plan-import's limits; names trimmed; an empty warmup is none", () => {
  const plans = validatePlans({ plans: [{ name: " A ", exercises: [{ ...exercise(1, " Squat "), warmup: "  ", equipmentType: null }] }] });
  assertEquals(plans[0].name, "A");
  assertEquals(plans[0].exercises[0].name, "Squat");
  assertEquals(plans[0].exercises[0].warmup, null);
  assertEquals(plans[0].exercises[0].equipmentType, null);
  assertThrows(() => validatePlans({ plans: Array(11).fill(PLANS.plans[0]) }));
  assertThrows(() => validatePlans({ plans: [{ name: "A", exercises: [{ ...exercise(1, "x"), equipmentType: "kettlebell" }] }] }));
  assertThrows(() => validatePlans({ plans: [{ name: "A", exercises: [{ ...exercise(1, "x"), restSec: 4000 }] }] }));
});

Deno.test("planJsonSchema: every field required, nothing extra, the plan count fixed", () => {
  const s = planJsonSchema(3) as { properties: { plans: { minItems: number; maxItems: number; items: { properties: { exercises: { items: { required: string[]; additionalProperties: boolean } } } } } } };
  assertEquals([s.properties.plans.minItems, s.properties.plans.maxItems], [3, 3]);
  const ex = s.properties.plans.items.properties.exercises.items;
  assertEquals(ex.additionalProperties, false);
  assertEquals(ex.required.length, 8);
});

Deno.test("lintPlan: a pattern counts once any plan has a matching exercise", () => {
  const checks = lintPlan(validatePlans(PLANS), COMMON);
  assertEquals(checks.map((c) => [c.pattern, c.covered]), [["push", true], ["pull", false], ["squat", true], ["hinge", false]]);
});
