/**
 * Authentication for the relay on the VPS (NH-52, NH-53). The relay has no
 * Supabase user JWT; it signs every request with its environment's secret:
 *
 *   x-relay-env:        dev | prod
 *   x-relay-timestamp:  unix seconds
 *   x-relay-signature:  hex HMAC-SHA256(secret, `${env}.${timestamp}.${body}`)
 *
 * The signature covers the environment and the exact body, so a request
 * can't be replayed against the other environment or altered in transit.
 * A timestamp outside RELAY_MAX_SKEW_SEC is refused, which bounds replays;
 * the endpoints are idempotent per job and lease on top of that.
 *
 * Web Crypto only, so the relay (Node) can use the same signing code.
 */

export type RelayEnvironment = "dev" | "prod";
export const RELAY_ENVIRONMENTS: readonly RelayEnvironment[] = ["dev", "prod"];
export const RELAY_MAX_SKEW_SEC = 300;
/** Secrets shorter than this are ignored, so a placeholder can't authenticate anything. */
export const RELAY_MIN_SECRET_LENGTH = 32;

type EnvGetter = (name: string) => string | undefined;

/** Per-environment secrets from ASSISTANT_RELAY_SECRET_DEV / _PROD. */
export function relaySecrets(get: EnvGetter = (n) => Deno.env.get(n)): Partial<Record<RelayEnvironment, string>> {
  const out: Partial<Record<RelayEnvironment, string>> = {};
  for (const env of RELAY_ENVIRONMENTS) {
    const value = get(`ASSISTANT_RELAY_SECRET_${env.toUpperCase()}`)?.trim();
    if (value && value.length >= RELAY_MIN_SECRET_LENGTH) out[env] = value;
  }
  return out;
}

export async function relaySignature(secret: string, env: RelayEnvironment, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${env}.${timestamp}.${body}`));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Headers for a signed relay request — what the relay sends. */
export async function relayHeaders(secret: string, env: RelayEnvironment, body: string, nowSec: number): Promise<Record<string, string>> {
  return {
    "content-type": "application/json",
    "x-relay-env": env,
    "x-relay-timestamp": String(nowSec),
    "x-relay-signature": await relaySignature(secret, env, nowSec, body),
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The environment a correctly signed, fresh request comes from; null for anything else. */
export async function verifyRelayRequest(
  headers: Headers,
  body: string,
  secrets: Partial<Record<RelayEnvironment, string>>,
  nowSec: number,
): Promise<RelayEnvironment | null> {
  const env = headers.get("x-relay-env");
  if (env !== "dev" && env !== "prod") return null;
  const secret = secrets[env];
  if (!secret) return null;
  const rawTs = headers.get("x-relay-timestamp") ?? "";
  if (!/^\d{1,12}$/.test(rawTs)) return null;
  const timestamp = Number(rawTs);
  if (Math.abs(nowSec - timestamp) > RELAY_MAX_SKEW_SEC) return null;
  const signature = (headers.get("x-relay-signature") ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(signature)) return null;
  const expected = await relaySignature(secret, env, timestamp, body);
  return constantTimeEqual(signature, expected) ? env : null;
}
