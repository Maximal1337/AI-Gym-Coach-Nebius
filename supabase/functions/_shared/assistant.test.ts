// Unit tests for the spend ceilings (NH-38). Run: deno test --no-config supabase/functions/
import { assert, assertAlmostEquals, assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  checkSpend,
  costCents,
  dailyCaps,
  FALLBACK_TURN_USAGE,
  priceFor,
  recordSpend,
  spendBucketFor,
  spendCeilingsCents,
  TOKEN_FACTORY_PRICES,
  usageOrFallback,
} from "./assistant.ts";

const noEnv = () => undefined;
const env = (vars: Record<string, string>) => (name: string) => vars[name];

type RpcResult = { data: unknown; error: { message: string } | null };
function fakeDb(result: RpcResult) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const db = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  } as unknown as Pick<SupabaseClient, "rpc">;
  return { db, calls };
}

// ------------------------------------------------------------ prices

Deno.test("priceFor: known Nemotron families", () => {
  assertEquals(priceFor("nvidia/Nemotron-3-Super-120B-A12B"), TOKEN_FACTORY_PRICES.super);
  assertEquals(priceFor("nvidia/Nemotron-3-Ultra"), TOKEN_FACTORY_PRICES.ultra);
  assertEquals(priceFor("nvidia/Nemotron-3.5-Lightning"), TOKEN_FACTORY_PRICES.lightning);
});

Deno.test("priceFor: an unknown model is priced as the most expensive known one", () => {
  assertEquals(priceFor("some-new-model"), TOKEN_FACTORY_PRICES.ultra);
  assertEquals(priceFor("nvidia/Nemotron-3-Nano"), TOKEN_FACTORY_PRICES.ultra);
  for (const p of Object.values(TOKEN_FACTORY_PRICES)) {
    assert(p.input <= TOKEN_FACTORY_PRICES.ultra.input && p.output <= TOKEN_FACTORY_PRICES.ultra.output);
  }
});

Deno.test("costCents: list price per 1M tokens", () => {
  assertAlmostEquals(costCents("nemotron-super", { tokensInput: 1_000_000, tokensOutput: 1_000_000 }), 120, 1e-9);
  assertAlmostEquals(costCents("nemotron-super", { tokensInput: 10_000, tokensOutput: 1_000 }), 0.39, 1e-9);
  assertEquals(costCents("nemotron-super", { tokensInput: 0, tokensOutput: 0 }), 0);
});

Deno.test("usageOrFallback: malformed or missing usage is charged the fallback", () => {
  assertEquals(usageOrFallback({ tokensInput: 12, tokensOutput: 3 }), { tokensInput: 12, tokensOutput: 3 });
  for (const bad of [null, undefined, {}, { tokensInput: 5 }, { tokensInput: -1, tokensOutput: 2 }, { tokensInput: 1.5, tokensOutput: 2 }, {
    tokensInput: Number.NaN,
    tokensOutput: 2,
  }]) {
    assertEquals(usageOrFallback(bad as never), FALLBACK_TURN_USAGE, JSON.stringify(bad));
  }
  // The fallback is a real charge, not zero: 30k in + 3k out at the Ultra price.
  assertAlmostEquals(costCents("unknown", FALLBACK_TURN_USAGE), 3.9, 1e-9);
});

// ------------------------------------------------------------ ceilings

Deno.test("spendCeilingsCents: D-34 defaults", () => {
  assertEquals(spendCeilingsCents(noEnv), { prod: 100, dev: 50, memory: 50 });
});

Deno.test("spendCeilingsCents: secrets override; 0 switches a bucket off; garbage falls back", () => {
  assertEquals(
    spendCeilingsCents(env({
      ASSISTANT_SPEND_CEILING_CENTS_PROD: "80",
      ASSISTANT_SPEND_CEILING_CENTS_DEV: "0",
      ASSISTANT_SPEND_CEILING_CENTS_MEMORY: "abc",
    })),
    { prod: 80, dev: 0, memory: 50 },
  );
  assertEquals(spendCeilingsCents(env({ ASSISTANT_SPEND_CEILING_CENTS_PROD: "-5" })).prod, 100);
  assertEquals(spendCeilingsCents(env({ ASSISTANT_SPEND_CEILING_CENTS_PROD: " " })).prod, 100);
});

Deno.test("budget invariant: the default ceilings fit the credits for the whole run (D-34, §7)", () => {
  const days = 78; // 2026-09-29 → 2026-12-15 inclusive
  const tokenFactoryCreditsCents = 150 * 100; // per member
  const c = spendCeilingsCents(noEnv);
  // Member A's keys: the agent, prod + dev.
  assert((c.prod + c.dev) * days <= tokenFactoryCreditsCents, `agent worst case ${(c.prod + c.dev) * days}¢`);
  // Member B's key: the nightly memory job.
  assert(c.memory * days <= tokenFactoryCreditsCents, `memory worst case ${c.memory * days}¢`);
});

Deno.test("dailyCaps: message caps keep their defaults", () => {
  assertEquals(dailyCaps(noEnv), { messagesPerUser: 100, messagesGlobal: 1000 });
});

Deno.test("spendBucketFor: environments map to their own buckets", () => {
  assertEquals(spendBucketFor("prod"), "prod");
  assertEquals(spendBucketFor("dev"), "dev");
});

// ------------------------------------------------------------ checkSpend

const CEILINGS = { prod: 100, dev: 50, memory: 50 };

Deno.test("checkSpend: under the ceiling is allowed, at it is not", async () => {
  const under = fakeDb({ data: 99.999, error: null });
  assert((await checkSpend(under.db, "prod", CEILINGS)).allowed);
  assertEquals(under.calls, [{ fn: "assistant_spend_today", args: { p_bucket: "prod" } }]);
  assertFalse((await checkSpend(fakeDb({ data: 100, error: null }).db, "prod", CEILINGS)).allowed);
  assertFalse((await checkSpend(fakeDb({ data: 120, error: null }).db, "prod", CEILINGS)).allowed);
});

Deno.test("checkSpend: a numeric that arrives as a string still counts", async () => {
  const r = await checkSpend(fakeDb({ data: "49.5", error: null }).db, "dev", CEILINGS);
  assertEquals(r, { allowed: true, spentCents: 49.5, ceilingCents: 50 });
});

Deno.test("checkSpend: a ceiling of 0 blocks even with nothing spent", async () => {
  assertFalse((await checkSpend(fakeDb({ data: 0, error: null }).db, "dev", { ...CEILINGS, dev: 0 })).allowed);
});

Deno.test("checkSpend: fails closed when the total can't be read", async () => {
  assertFalse((await checkSpend(fakeDb({ data: null, error: { message: "boom" } }).db, "prod", CEILINGS)).allowed);
  assertFalse((await checkSpend(fakeDb({ data: "not a number", error: null }).db, "prod", CEILINGS)).allowed);
});

// ------------------------------------------------------------ recordSpend

Deno.test("recordSpend: records tokens and cost, returns the new total", async () => {
  const { db, calls } = fakeDb({ data: 12.5, error: null });
  const total = await recordSpend(db, "memory", "nemotron-ultra", { tokensInput: 20_000, tokensOutput: 2_000 });
  assertEquals(total, 12.5);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "assistant_record_spend");
  assertEquals(calls[0].args.p_bucket, "memory");
  assertEquals(calls[0].args.p_tokens_input, 20_000);
  assertEquals(calls[0].args.p_tokens_output, 2_000);
  assertAlmostEquals(calls[0].args.p_cost_cents as number, 2.6, 1e-9);
});

Deno.test("recordSpend: missing usage is charged the fallback", async () => {
  const { db, calls } = fakeDb({ data: 3.9, error: null });
  await recordSpend(db, "prod", "unknown", undefined);
  assertEquals(calls[0].args.p_tokens_input, FALLBACK_TURN_USAGE.tokensInput);
  assertEquals(calls[0].args.p_tokens_output, FALLBACK_TURN_USAGE.tokensOutput);
});

Deno.test("recordSpend: a failed write returns null", async () => {
  assertEquals(await recordSpend(fakeDb({ data: null, error: { message: "boom" } }).db, "prod", "x", { tokensInput: 1, tokensOutput: 1 }), null);
});
