import { writeFile } from "node:fs/promises";
import { chat } from "./hermes.js";
import { staticSandboxes } from "./sandboxes.js";
import { OutboxClient } from "./outbox.js";
import { type RelayDeps, runOnce } from "./relay.js";
import type { RelayEnvironment } from "./signing.js";

/**
 * Relay entry point (NH-54). One process per environment, deployed through
 * Argo CD into that environment's namespace (D-31, D-32). It only makes
 * outbound calls: to Supabase, and to the sandboxes on the cluster network.
 *
 * Environment:
 *   RELAY_ENV                 dev | prod
 *   SUPABASE_FUNCTIONS_URL    https://<project-ref>.supabase.co/functions/v1
 *   RELAY_SECRET              the environment's ASSISTANT_RELAY_SECRET_* value
 *   TOKEN_FACTORY_MODEL       the model the sandboxes run, for pricing spend
 *   RELAY_STATIC_SANDBOXES    until the sandbox manager (NH-55) lands: a JSON map
 *                             {"<user id>": {"baseUrl": "...", "apiKey": "..."}}
 *   RELAY_BATCH (2), RELAY_LEASE_SECONDS (180), RELAY_TURN_TIMEOUT_MS (120000),
 *   RELAY_IDLE_POLL_MS (2000), RELAY_HEARTBEAT_FILE (/tmp/relay-heartbeat)
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function number(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (event: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));

async function main(): Promise<void> {
  const env = required("RELAY_ENV");
  if (env !== "dev" && env !== "prod") throw new Error("RELAY_ENV must be dev or prod");
  const outbox = new OutboxClient({
    functionsUrl: required("SUPABASE_FUNCTIONS_URL").replace(/\/+$/, ""),
    env: env as RelayEnvironment,
    secret: required("RELAY_SECRET"),
  });
  const sandboxes = staticSandboxes(process.env.RELAY_STATIC_SANDBOXES);
  const timeoutMs = number("RELAY_TURN_TIMEOUT_MS", 120_000);
  const batch = number("RELAY_BATCH", 2);
  const leaseSeconds = number("RELAY_LEASE_SECONDS", 180);
  const idlePollMs = number("RELAY_IDLE_POLL_MS", 2_000);
  const heartbeat = process.env.RELAY_HEARTBEAT_FILE ?? "/tmp/relay-heartbeat";

  const deps: RelayDeps = {
    outbox,
    sandboxFor: (job) => Promise.resolve(sandboxes.get(job.job.user_id) ?? null),
    chat: (endpoint, messages, options) => chat(endpoint, messages, { ...options, timeoutMs }),
    model: required("TOKEN_FACTORY_MODEL"),
    now: () => new Date(),
    log,
  };

  let running = true;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      log("stopping", { signal });
      running = false;
    });
  }

  log("started", { env, batch, leaseSeconds, staticSandboxes: sandboxes.size });
  let backoffMs = 1_000;
  while (running) {
    try {
      const outcomes = await runOnce(deps, batch, leaseSeconds);
      await writeFile(heartbeat, new Date().toISOString());
      backoffMs = 1_000;
      if (outcomes.length > 0) log("batch", { outcomes });
      else await sleep(idlePollMs);
    } catch (e) {
      log("poll_error", { error: String(e), retryInMs: backoffMs });
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 60_000);
    }
  }
}

main().catch((e) => {
  log("fatal", { error: String(e) });
  process.exit(1);
});
