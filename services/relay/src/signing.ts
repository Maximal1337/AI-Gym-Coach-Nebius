import { createHmac } from "node:crypto";

/**
 * Request signing for assistant-outbox / assistant-deliver — the Node side of
 * supabase/functions/_shared/relay-auth.ts. Both compute
 * HMAC-SHA256(secret, `${env}.${timestamp}.${body}`) as hex; a shared test
 * vector in both test suites keeps them from drifting apart.
 */
export type RelayEnvironment = "dev" | "prod";

export function relaySignature(secret: string, env: RelayEnvironment, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${env}.${timestamp}.${body}`).digest("hex");
}

export function relayHeaders(secret: string, env: RelayEnvironment, body: string, nowSec: number): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-relay-env": env,
    "x-relay-timestamp": String(nowSec),
    "x-relay-signature": relaySignature(secret, env, nowSec, body),
  };
}
