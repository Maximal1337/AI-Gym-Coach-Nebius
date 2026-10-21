import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type GatewayConfig, gatewayConfigFromEnv, gatewayFetch, registerGateway, sandboxServiceUrl } from "./gateway.js";
import { EDGE_CALLS_EVERY_MS, EdgeCallMeter } from "./edge-calls.js";
import { chat } from "./hermes.js";
import { readTurn } from "./hermes-session.js";
import { execOpenShell, OpenShellCli } from "./openshell-cli.js";
import { staticAcquire, staticSandboxes } from "./sandboxes.js";
import { OutboxClient } from "./outbox.js";
import { pause, pollLoop, type RelayDeps } from "./relay.js";
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
 *   RELAY_HEARTBEAT_FILE (/tmp/relay-heartbeat)
 *   RELAY_CLAIM_WAIT_SECONDS (50)  how long assistant-outbox holds a claim open for
 *                             a job (long polling); 0 makes every claim one look
 *   RELAY_IDLE_POLL_MS (30000)  the pause after an empty answer that came back fast
 *                             (the spend ceiling, or no long polling) and after an error
 *
 * Where sandboxes come from: RELAY_SANDBOXES = static (the default, the spike's
 * map) or manager (the sandbox manager, NH-55). The manager needs:
 *   SANDBOX_KEY_SECRET        at least 32 characters; derives each sandbox's Hermes API key
 *   SANDBOX_SHARED_PROVIDERS  comma-separated OpenShell providers every sandbox gets:
 *                             the environment's Token Factory and Tavily providers (NH-33)
 *   SANDBOX_TOOLS_PROFILE (notch-tools), SANDBOX_MAX_RUNNING (prod 4, dev 2),
 *   SANDBOX_IDLE_MINUTES (10), SANDBOX_HERMES_HOME (/sandbox/.hermes),
 *   SANDBOX_COMMAND_JSON (the image's start-hermes.sh: installs the profile, then runs
 *                             Hermes in the foreground without API_SERVER_KEY in its environment),
 *   SANDBOX_CPU, SANDBOX_MEMORY (640Mi in both overlays, from NH-25's soak), OPENSHELL_BIN (openshell),
 *   SANDBOX_IMAGE (unset: the gateway's default sandbox image, bumped by CI in Git)
 *   SANDBOX_KEEP_RUNNING      comma-separated user ids whose sandbox is never stopped as
 *                             idle: the demo and judge accounts (NH-27). In
 *                             /etc/notch/<env>.env, not the overlay: the repository is public
 * The environment's OpenShell gateway (NH-29, src/gateway.ts):
 *   OPENSHELL_GATEWAY_ENDPOINT  https://openshell.notch-<env>.svc:8080; with it, the
 *                             CLI is registered against the gateway at startup (with
 *                             static sandboxes too: the setup commands in
 *                             deploy/README.md use this pod's CLI) and HTTPS calls to
 *                             sandboxes go through the gateway with the client certificate
 *   OPENSHELL_TLS_DIR (/etc/openshell-tls), OPENSHELL_GATEWAY_NAME (notch)
 * The static map:
 *   RELAY_STATIC_SANDBOXES    {"<user id>": {"baseUrl": "...", "apiKey": "..."}}
 */

// In the sandbox image (deploy/images/hermes-sandbox/profile): installs the
// profile and API_SERVER_KEY into $HERMES_HOME, then runs Hermes itself —
// NemoClaw's `hermes` wrapper refuses every start on a Kubernetes volume.
const DEFAULT_SANDBOX_COMMAND = ["/opt/notch/hermes-profile/start-hermes.sh"];
const IDLE_SWEEP_MS = 60_000;
const ORPHAN_SWEEP_MS = 15 * 60_000;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** User ids, comma-separated; anything that isn't one stops the relay rather than being skipped quietly. */
function userIds(name: string): string[] {
  const ids = (process.env[name] ?? "").split(",").map((id) => id.trim().toLowerCase()).filter(Boolean);
  for (const id of ids) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error(`${name}: not a user id`);
  }
  return ids;
}

function number(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The claim's wait: a whole number of seconds from 0 to assistant-outbox's 50. */
function claimWaitSeconds(): number {
  const raw = process.env.RELAY_CLAIM_WAIT_SECONDS?.trim();
  if (!raw) return 50;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 50) throw new Error("RELAY_CLAIM_WAIT_SECONDS must be a whole number from 0 to 50");
  return value;
}

const log = (event: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));

async function main(): Promise<void> {
  const env = required("RELAY_ENV");
  if (env !== "dev" && env !== "prod") throw new Error("RELAY_ENV must be dev or prod");
  const functionsUrl = required("SUPABASE_FUNCTIONS_URL").replace(/\/+$/, "");
  // Its Edge Function calls, logged every 5 minutes for the health check (DOR-133).
  const meter = new EdgeCallMeter();
  const outbox = new OutboxClient({ functionsUrl, env: env as RelayEnvironment, secret: required("RELAY_SECRET"), meter });
  const model = required("TOKEN_FACTORY_MODEL");
  const timers: NodeJS.Timeout[] = [];
  timers.push(setInterval(() => {
    for (const [event, fields] of meter.report()) log(event, fields);
  }, EDGE_CALLS_EVERY_MS));
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
  const exec = execOpenShell(process.env.OPENSHELL_BIN || "openshell");
  if (gateway) {
    process.env.OPENSHELL_GATEWAY = gateway.name;
    // With static sandboxes the relay itself never calls the CLI, so a failed
    // registration only goes in the log.
    const status = await registerGateway(gateway, join(homedir(), ".config", "openshell"), exec).catch((e: unknown) => {
      if (mode === "manager") throw e;
      return `not registered: ${e instanceof Error ? e.message : String(e)}`;
    });
    log("gateway", { name: gateway.name, endpoint: gateway.endpoint, status });
  }

  if (mode === "manager") {
    const keySecret = required("SANDBOX_KEY_SECRET");
    if (keySecret.length < 32) throw new Error("SANDBOX_KEY_SECRET must be at least 32 characters");
    if (!gateway) throw new Error("RELAY_SANDBOXES=manager needs OPENSHELL_GATEWAY_ENDPOINT");
    const { endpoint } = gateway;
    const keepRunning = userIds("SANDBOX_KEEP_RUNNING");
    const manager = new SandboxManager(
      new OpenShellCli(exec, undefined, (name) => sandboxServiceUrl(endpoint, name)),
      { record: (userId, sandboxName, tokenHash) => outbox.recordAgent({ user_id: userId, sandbox_name: sandboxName, tool_token_hash: tokenHash }), list: () => outbox.listAgents() },
      {
        env: env as RelayEnvironment,
        image: process.env.SANDBOX_IMAGE?.trim() || undefined,
        command: process.env.SANDBOX_COMMAND_JSON ? (JSON.parse(process.env.SANDBOX_COMMAND_JSON) as string[]) : DEFAULT_SANDBOX_COMMAND,
        maxRunning: number("SANDBOX_MAX_RUNNING", env === "prod" ? 4 : 2),
        idleStopMs: number("SANDBOX_IDLE_MINUTES", 10) * 60_000,
        keepRunning,
        apiKeySecret: keySecret,
        sandboxEnv: {
          HERMES_HOME: process.env.SANDBOX_HERMES_HOME || "/sandbox/.hermes",
          // Not TOKEN_FACTORY_MODEL: a plain value under a credential-shaped name is what NH-26's probe flags.
          NOTCH_MODEL: model,
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
    log("sandbox_manager", {
      image: process.env.SANDBOX_IMAGE || "gateway default",
      maxRunning: number("SANDBOX_MAX_RUNNING", env === "prod" ? 4 : 2),
      keepRunning: keepRunning.length,
    });
  } else {
    const map = staticSandboxes(process.env.RELAY_STATIC_SANDBOXES);
    acquireSandbox = staticAcquire(map);
    log("static_sandboxes", { users: map.size });
  }
  const timeoutMs = number("RELAY_TURN_TIMEOUT_MS", 120_000);
  const batch = number("RELAY_BATCH", 2);
  const leaseSeconds = number("RELAY_LEASE_SECONDS", 180);
  const waitSeconds = claimWaitSeconds();
  const idlePauseMs = number("RELAY_IDLE_POLL_MS", 30_000);
  const heartbeat = process.env.RELAY_HEARTBEAT_FILE ?? "/tmp/relay-heartbeat";
  // HTTPS sandbox URLs are the gateway's service URLs: through the gateway, with its client certificate.
  const sandboxFetch = gateway ? gatewayFetch(gateway.route) : undefined;

  const deps: RelayDeps = {
    outbox,
    acquireSandbox,
    chat: (endpoint, messages, options) => chat(endpoint, messages, { ...options, timeoutMs, ...(sandboxFetch ? { fetch: sandboxFetch } : {}) }),
    readTurn: (endpoint, sessionId) => readTurn(endpoint, sessionId, sandboxFetch ? { fetch: sandboxFetch } : {}),
    model,
    now: () => new Date(),
    log,
  };

  // Stopping lets a claim that is waiting for a job come back (within its
  // wait) and hands back whatever it brings; a batch already running finishes
  // first. Either fits the pod's terminationGracePeriodSeconds
  // (deploy/notch/base/relay.yaml).
  const stop = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      log("stopping", { signal });
      stop.abort();
      for (const t of timers) clearInterval(t);
    });
  }

  log("started", { env, batch, leaseSeconds, waitSeconds, idlePauseMs });
  await pollLoop(deps, { batch, leaseSeconds, waitSeconds, idlePauseMs }, stop.signal, {
    sleep: pause,
    heartbeat: () => writeFile(heartbeat, new Date().toISOString()).catch(() => {}),
  });
  log("stopped", {});
  // Nothing is left to finish; open keep-alive connections mustn't hold the pod.
  process.exit(0);
}

main().catch((e) => {
  log("fatal", { error: String(e) });
  process.exit(1);
});
