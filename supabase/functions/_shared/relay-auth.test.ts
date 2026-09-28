// Tests for relay request signing (NH-52, NH-53). Run: deno test --no-config supabase/functions/
import { assertEquals } from "jsr:@std/assert@1";
import { RELAY_MAX_SKEW_SEC, relayHeaders, relaySecrets, relaySignature, verifyRelayRequest } from "./relay-auth.ts";

const PROD = "p".repeat(40);
const DEV = "d".repeat(40);
const SECRETS = { prod: PROD, dev: DEV };
const NOW = 1_790_000_000;
const BODY = JSON.stringify({ action: "claim", limit: 2 });

const headersOf = async (secret: string, env: "dev" | "prod", body = BODY, ts = NOW) => new Headers(await relayHeaders(secret, env, body, ts));

Deno.test("a correctly signed, fresh request is accepted as its environment", async () => {
  assertEquals(await verifyRelayRequest(await headersOf(PROD, "prod"), BODY, SECRETS, NOW), "prod");
  assertEquals(await verifyRelayRequest(await headersOf(DEV, "dev"), BODY, SECRETS, NOW), "dev");
});

Deno.test("the signature is HMAC-SHA256 over env, timestamp and body", async () => {
  // RFC 4231-style sanity: a fixed input always gives the same 64-hex digest.
  const a = await relaySignature("k".repeat(32), "prod", 1, "{}");
  assertEquals(a, await relaySignature("k".repeat(32), "prod", 1, "{}"));
  assertEquals(a.length, 64);
});

Deno.test("an altered body, another environment's secret or a swapped env header is refused", async () => {
  assertEquals(await verifyRelayRequest(await headersOf(PROD, "prod"), BODY.replace("2", "9"), SECRETS, NOW), null);
  assertEquals(await verifyRelayRequest(await headersOf(DEV, "prod"), BODY, SECRETS, NOW), null);
  const swapped = await headersOf(PROD, "prod");
  swapped.set("x-relay-env", "dev");
  assertEquals(await verifyRelayRequest(swapped, BODY, SECRETS, NOW), null);
});

Deno.test("a stale or future timestamp is refused", async () => {
  assertEquals(await verifyRelayRequest(await headersOf(PROD, "prod", BODY, NOW - RELAY_MAX_SKEW_SEC), BODY, SECRETS, NOW), "prod");
  assertEquals(await verifyRelayRequest(await headersOf(PROD, "prod", BODY, NOW - RELAY_MAX_SKEW_SEC - 1), BODY, SECRETS, NOW), null);
  assertEquals(await verifyRelayRequest(await headersOf(PROD, "prod", BODY, NOW + RELAY_MAX_SKEW_SEC + 1), BODY, SECRETS, NOW), null);
});

Deno.test("missing or malformed headers are refused", async () => {
  const good = await headersOf(PROD, "prod");
  for (const [name, value] of [["x-relay-env", "staging"], ["x-relay-timestamp", "soon"], ["x-relay-signature", "abc"]]) {
    const h = new Headers(good);
    h.set(name, value);
    assertEquals(await verifyRelayRequest(h, BODY, SECRETS, NOW), null, name);
  }
  for (const name of ["x-relay-env", "x-relay-timestamp", "x-relay-signature"]) {
    const h = new Headers(good);
    h.delete(name);
    assertEquals(await verifyRelayRequest(h, BODY, SECRETS, NOW), null, name);
  }
});

Deno.test("an environment without a configured secret accepts nothing", async () => {
  assertEquals(await verifyRelayRequest(await headersOf(DEV, "dev"), BODY, { prod: PROD }, NOW), null);
});

Deno.test("relaySecrets ignores short placeholder secrets", () => {
  const get = (vars: Record<string, string>) => (n: string) => vars[n];
  assertEquals(relaySecrets(get({ ASSISTANT_RELAY_SECRET_PROD: PROD, ASSISTANT_RELAY_SECRET_DEV: "changeme" })), { prod: PROD });
  assertEquals(relaySecrets(get({})), {});
});

Deno.test("contract: the signature matches the relay's reference vector (services/relay/src/signing.test.ts)", async () => {
  assertEquals(
    await relaySignature("k".repeat(32), "prod", 1790000000, JSON.stringify({ action: "claim", limit: 2 })),
    "325657353be7e5649e69ebaa369bf56a036b24cc984e1354f143a9be80e66710",
  );
});
