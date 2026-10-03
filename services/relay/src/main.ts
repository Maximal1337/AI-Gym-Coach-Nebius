import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type GatewayConfig, gatewayConfigFromEnv, gatewayFetch, registerGateway } from "./gateway.js";
import { chat } from "./hermes.js";
import { execOpenShell, OpenShellCli } from "./openshell-cli.js";
import { staticAcquire, staticSandboxes } from "./sandboxes.js";
import { OutboxClient } from "./outbox.js";
import { type RelayDeps, runOnce, turnBudget } from "./relay.js";
import { SandboxManager } from "./sandbox-manager.js";
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
 *   RELAY_BATCH (2), RELAY_LEASE_SECONDS (180), RELAY_TURN_TIMEOUT_MS (120000),
 *   RELAY_IDLE_POLL_MS (2000), RELAY_HEARTBEAT_FILE (/tmp/relay-heartbeat).
 *   The lease must cover the turn timeout plus 45 s (src/relay.ts turnBudget),
 *   or the relay refuses to start.
 *
 * Where sandboxes come from: RELAY_SANDBOXES = static (the default, the spike's
 * map) or manager (the sandbox manager, NH-55). The manager needs:
 *   SANDBOX_KEY_SECRET        at least 32 characters; derives each sandbox's Hermes API key
 *   SANDBOX_SHARED_PROVIDERS  comma-separated OpenShell providers every sandbox gets:
 *                             the environment's Token Factory and Tavily providers (NH-33)
 *   SANDBOX_TOOLS_PROFILE (notch-tools), SANDBOX_MAX_RUNNING (prod 4, dev 2),
 *   SANDBOX_IDLE_MINUTES (10), SANDBOX_HERMES_HOME (/sandbox/.hermes),
 *   SANDBOX_COMMAND_JSON (install the profile, then `hermes gateway run` in the foreground),
 *   SANDBOX_CPU, SANDBOX_MEMORY (unset until NH-25 measures), OPENSHELL_BIN (openshell),
 *   SANDBOX_IMAGE (unset: the gateway's default sandbox image, bumped by CI in Git)
 * The environment's OpenShell gateway (NH-29, src/gateway.ts):
 *   OPENSHELL_GATEWAY_ENDPOINT  https://openshell.notch-<env>.svc:8080; with it, the
 *                             CLI is registered against the gateway at startup and
 *                             HTTPS calls to sandboxes go through the gateway with
 *                             the client certificate
 *   OPENSHELL_TLS_DIR (/etc/openshell-tls), OPENSHELL_GATEWAY_NAME (notch)
 * The static map:
 *   RELAY_STATIC_SANDBOXES    {"<user id>": {"baseUrl": "...", "apiKey": "..."}}
 */

const DEFAULT_SANDBOX_COMMAND = ["sh", "-c", "/opt/notch/hermes-profile/install-profile.sh && exec hermes gateway run"];
const IDLE_SWEEP_MS = 60_000;
const ORPHAN_SWEEP_MS = 15 * 60_000;

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
  const functionsUrl = required("SUPABASE_FUNCTIONS_URL").replace(/\/+$/, "");
  const outbox = new OutboxClient({ functionsUrl, env: env as RelayEnvironment, secret: required("RELAY_SECRET") });
  const model = required("TOKEN_FACTORY_MODEL");
  const timeoutMs = number("RELAY_TURN_TIMEOUT_MS", 120_000);
  const batch = number("RELAY_BATCH", 2);
  const leaseSeconds = number("RELAY_LEASE_SECONDS", 180);
  const turnBudgetMs = turnBudget(leaseSeconds, timeoutMs);
  const idlePollMs = number("RELAY_IDLE_POLL_MS", 2_000);
  const heartbeat = process.env.RELAY_HEARTBEAT_FILE ?? "/tmp/relay-heartbeat";
  const timers: NodeJS.Timeout[] = [];
  let acquireSandbox: RelayDeps["acquireSandbox"];
  const mode = process.env.RELAY_SANDBOXES?.trim() || "static";
  if (mode !== "static" && mode !== "manager") throw new Error("RELAY_SANDBOXES must be static or manager");

  // The gateway's client bundle comes from a Secret the OpenShell chart creates
  // after the relay first starts (sync waves). The manager can't work without
  // it; a static map of plain-HTTP sandboxes can.
  let gateway: GatewayConfig | undefined;
  try {
    gateway = gatewayConfigFromEnv(process.env);
  } catch (e) {
    if (mode === "manager") throw e;
    log("gateway_unavailable", { error: String(e) });
  }
  if (gateway) process.env.OPENSHELL_GATEWAY = gateway.name;

  if (mode === "manager") {
    const keySecret = required("SANDBOX_KEY_SECRET");
    if (keySecret.length < 32) throw new Error("SANDBOX_KEY_SECRET must be at least 32 characters");
    if (!gateway) throw new Error("RELAY_SANDBOXES=manager needs OPENSHELL_GATEWAY_ENDPOINT");
    const exec = execOpenShell(process.env.OPENSHELL_BIN || "openshell");
    log("gateway", { name: gateway.name, endpoint: gateway.endpoint, status: await registerGateway(gateway, join(homedir(), ".config", "openshell"), exec) });
    const manager = new SandboxManager(
      new OpenShellCli(exec),
      { record: (userId, sandboxName, tokenHash) => outbox.recordAgent({ user_id: userId, sandbox_name: sandboxName, tool_token_hash: tokenHash }), list: () => outbox.listAgents() },
      {
        env: env as RelayEnvironment,
        image: process.env.SANDBOX_IMAGE?.trim() || undefined,
        command: process.env.SANDBOX_COMMAND_JSON ? (JSON.parse(process.env.SANDBOX_COMMAND_JSON) as string[]) : DEFAULT_SANDBOX_COMMAND,
        maxRunning: number("SANDBOX_MAX_RUNNING", env === "prod" ? 4 : 2),
        idleStopMs: number("SANDBOX_IDLE_MINUTES", 10) * 60_000,
        apiKeySecret: keySecret,
        sandboxEnv: {
          HERMES_HOME: process.env.SANDBOX_HERMES_HOME || "/sandbox/.hermes",
          TOKEN_FACTORY_MODEL: model,
          NOTCH_TOOLS_URL: `${functionsUrl}/notch-tools`,
        },
        sharedProviders: (process.env.SANDBOX_SHARED_PROVIDERS ?? "").split(",").map((p) => p.trim()).filter(Boolean),
        toolsProviderType: process.env.SANDBOX_TOOLS_PROFILE || "notch-tools",
        hermesPort: 8642,
        cpu: process.env.SANDBOX_CPU || undefined,
        memory: process.env.SANDBOX_MEMORY || undefined,
      },
      Date.now,
      log,
    );
    acquireSandbox = (job) => manager.acquire(job);
    const sweep = (name: string, fn: () => Promise<unknown>) => () =>
      void fn().catch((e) => log("sweep_failed", { sweep: name, error: String(e) }));
    timers.push(setInterval(sweep("idle", () => manager.sweepIdle()), IDLE_SWEEP_MS));
    timers.push(setInterval(sweep("orphans", () => manager.sweepOrphans()), ORPHAN_SWEEP_MS));
    log("sandbox_manager", { image: process.env.SANDBOX_IMAGE || "gateway default", maxRunning: number("SANDBOX_MAX_RUNNING", env === "prod" ? 4 : 2) });
  } else {
    const map = staticSandboxes(process.env.RELAY_STATIC_SANDBOXES);
    acquireSandbox = staticAcquire(map);
    log("static_sandboxes", { users: map.size });
  }
  // HTTPS sandbox URLs are the gateway's service URLs: through the gateway, with its client certificate.
  const sandboxFetch = gateway ? gatewayFetch(gateway.route) : undefined;

  const deps: RelayDeps = {
    outbox,
    acquireSandbox,
    chat: (endpoint, messages, options) => chat(endpoint, messages, { ...options, timeoutMs, ...(sandboxFetch ? { fetch: sandboxFetch } : {}) }),
    model,
    turnBudgetMs,
    now: () => new Date(),
    log,
  };

  let running = true;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      log("stopping", { signal });
      running = false;
      for (const t of timers) clearInterval(t);
    });
  }

  log("started", { env, batch, leaseSeconds });
  let backoffMs = 1_000;
  while (running) {
    // The heartbeat says "the loop is turning", not "Supabase is up": it's
    // written on every iteration, failed polls included, so the liveness probe
    // restarts a stuck relay but not one waiting out an outage in backoff.
    await writeFile(heartbeat, new Date().toISOString()).catch(() => {});
    try {
      const outcomes = await runOnce(deps, batch, leaseSeconds);
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
