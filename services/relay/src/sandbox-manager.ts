import { createHash, createHmac, randomBytes } from "node:crypto";
import type { SandboxEndpoint } from "./hermes.js";
import type { JobContext, RecordAgentStatus } from "./outbox.js";

/**
 * The sandbox manager (NH-55, NH-56): one OpenShell sandbox with its own
 * Hermes per user (D-26), created on the user's first message, started when
 * a message arrives, stopped after 10 idle minutes, and deleted once the
 * user's mapping row is gone.
 *
 * Capacity (D-31): at most `maxRunning` sandboxes run at once in this
 * environment (4 in prod, 2 in dev). A user who doesn't fit waits — their
 * job goes back to the queue unspent — and is never served from another
 * user's sandbox. To make room, the manager stops the least recently used
 * sandbox that isn't answering anyone right now.
 *
 * Every decision runs one at a time (`exclusive`), so two jobs in a batch
 * can't both take the last slot. The mapping is recorded in Supabase before
 * the sandbox is created (NH-56 deletes sandboxes without one), and the
 * user's tool token is minted here, stored only as a digest in Supabase and
 * as an OpenShell provider credential, which the gateway injects (D-28).
 */

export type SandboxPhase =
  | "provisioning"
  | "ready"
  | "stopping"
  | "stopped"
  | "starting"
  | "completed"
  | "error"
  | "deleting"
  | "unknown";

export interface SandboxInfo {
  name: string;
  phase: SandboxPhase;
}

export interface SandboxSpec {
  name: string;
  /** Unset: the gateway's default sandbox image (Helm `sandbox.image`, its tag bumped by CI). */
  image?: string;
  command: string[];
  env: Record<string, string>;
  labels: Record<string, string>;
  providers: string[];
  exposePort: number;
  cpu?: string;
  memory?: string;
}

/** What the manager needs from OpenShell; openshell-cli.ts implements it. */
export interface SandboxDriver {
  /** This environment's sandboxes, by label. */
  list(labels: Record<string, string>): Promise<SandboxInfo[]>;
  /** Returns once the sandbox is ready. */
  create(spec: SandboxSpec): Promise<void>;
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  delete(name: string): Promise<void>;
  /** The URL of the service the sandbox exposes on `port`. */
  serviceUrl(name: string, port: number): Promise<string>;
  /** Creates the provider, or replaces the credentials of an existing one. */
  upsertProvider(name: string, type: string, credentials: Record<string, string>): Promise<void>;
  listProviders(): Promise<string[]>;
  deleteProvider(name: string): Promise<void>;
}

/** The mapping in Supabase (assistant_agents), through assistant-outbox. */
export interface AgentStore {
  record(userId: string, sandboxName: string, tokenHash: string): Promise<RecordAgentStatus>;
  list(): Promise<Array<{ user_id: string; sandbox_name: string }>>;
}

export interface ManagerConfig {
  env: "dev" | "prod";
  /** Unset in the cluster: the gateway's default sandbox image is the one source of truth. */
  image?: string;
  command: string[];
  /** D-31: 4 in prod, 2 in dev. */
  maxRunning: number;
  /** D-31: 10 minutes. */
  idleStopMs: number;
  /** Derives each sandbox's Hermes API key, so the relay never has to store one. */
  apiKeySecret: string;
  /** Plain values for every sandbox: HERMES_HOME, TOKEN_FACTORY_MODEL, NOTCH_TOOLS_URL. */
  sandboxEnv: Record<string, string>;
  /** The environment's shared providers (Token Factory, Tavily; NH-33). */
  sharedProviders: string[];
  /** The provider profile id of the per-user notch-tools credential. */
  toolsProviderType: string;
  /** Hermes' API server (config.yaml: gateway.api_server.port). */
  hermesPort: number;
  cpu?: string;
  memory?: string;
}

export type SandboxLease =
  | { endpoint: SandboxEndpoint; release: () => void }
  | { defer: number; reason: string };

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

/** How long a job waits before it's claimed again. */
export const DEFER_SECONDS = { capacity: 20, busy: 10 } as const;
/** A sandbox used this recently is never stopped to make room: two users would take turns cold-starting. */
export const EVICT_GRACE_MS = 60_000;
export const MANAGED_BY = "notch-relay";
const RUNNING = new Set<SandboxPhase>(["provisioning", "starting", "ready"]);
const BUSY = new Set<SandboxPhase>(["provisioning", "starting", "stopping", "deleting", "unknown"]);
const TOOLS_SUFFIX = "-tools";

export const sha256hex = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Deterministic, so a retry finds the same sandbox (idempotent), and hashed,
 * so user ids never appear in cluster object names.
 */
export function sandboxName(env: "dev" | "prod", userId: string): string {
  return `notch-${env}-${sha256hex(userId).slice(0, 20)}`;
}

/** The sandbox's Hermes API key (API_SERVER_KEY): derived, never stored. */
export function sandboxApiKey(secret: string, name: string): string {
  return createHmac("sha256", secret).update(name).digest("base64url");
}

export function toolsProviderName(name: string): string {
  return `${name}${TOOLS_SUFFIX}`;
}

export class SandboxManager {
  private readonly inFlight = new Map<string, number>();
  private readonly lastUsed = new Map<string, number>();
  private readonly urls = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly driver: SandboxDriver,
    private readonly store: AgentStore,
    private readonly config: ManagerConfig,
    private readonly now: () => number = Date.now,
    private readonly log: (event: string, fields: Record<string, unknown>) => void = () => {},
  ) {}

  get labels(): Record<string, string> {
    return { "notch.app/env": this.config.env, "notch.app/managed-by": MANAGED_BY };
  }

  /** The user's own sandbox, ready to answer — or how long the job should wait. */
  acquire(job: JobContext): Promise<SandboxLease> {
    return this.exclusive(() => this.acquireNow(job));
  }

  /** Stops sandboxes idle for idleStopMs. Returns their names. */
  sweepIdle(): Promise<string[]> {
    return this.exclusive(() => this.sweepIdleNow());
  }

  /**
   * Deletes sandboxes whose mapping row is gone — an account deletion
   * cascades it away (NH-56) — and then their tool providers. At most
   * `maxDeletes` sandboxes per sweep, so a bad listing can't wipe everything
   * at once.
   */
  sweepOrphans(maxDeletes = 3): Promise<{ deleted: string[]; providersDeleted: string[] }> {
    return this.exclusive(() => this.sweepOrphansNow(maxDeletes));
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private busy(name: string): boolean {
    return (this.inFlight.get(name) ?? 0) > 0;
  }

  private seen(sandboxes: SandboxInfo[]): void {
    const now = this.now();
    for (const s of sandboxes) if (s.phase === "ready" && !this.lastUsed.has(s.name)) this.lastUsed.set(s.name, now);
  }

  private async acquireNow(job: JobContext): Promise<SandboxLease> {
    const userId = job.job.user_id;
    const name = sandboxName(this.config.env, userId);
    const sandboxes = await this.driver.list(this.labels);
    this.seen(sandboxes);
    const sandbox = sandboxes.find((s) => s.name === name);

    // Mid-transition: wait for it rather than pile a second operation on it.
    if (sandbox && BUSY.has(sandbox.phase)) return { defer: DEFER_SECONDS.busy, reason: `sandbox_${sandbox.phase}` };

    const needsCompute = !sandbox || sandbox.phase !== "ready";
    if (needsCompute && !(await this.makeRoom(sandboxes, name))) {
      return { defer: DEFER_SECONDS.capacity, reason: "capacity" };
    }

    // A new tool token whenever Supabase doesn't map this sandbox yet, or the
    // sandbox has to be created: the old token can't be read back.
    const mapped = job.agent?.sandbox_name === name && job.agent.provisioned === true;
    if (!sandbox || !mapped) await this.installToken(userId, name);

    if (!sandbox) {
      this.log("sandbox_create", { sandbox: name });
      await this.driver.create(this.spec(name));
    } else if (!mapped) {
      // A running process keeps the credential placeholder it started with.
      this.log("sandbox_restart", { sandbox: name, reason: "new_token" });
      if (sandbox.phase === "ready") await this.driver.stop(name);
      await this.driver.start(name);
    } else if (needsCompute) {
      this.log("sandbox_start", { sandbox: name, from: sandbox.phase });
      await this.driver.start(name);
    }

    const endpoint = { baseUrl: await this.url(name), apiKey: sandboxApiKey(this.config.apiKeySecret, name) };
    this.inFlight.set(name, (this.inFlight.get(name) ?? 0) + 1);
    this.lastUsed.set(name, this.now());
    let released = false;
    return {
      endpoint,
      release: () => {
        if (released) return;
        released = true;
        this.inFlight.set(name, Math.max(0, (this.inFlight.get(name) ?? 1) - 1));
        this.lastUsed.set(name, this.now());
      },
    };
  }

  /** Frees running slots if needed, never stopping a sandbox that's answering or was just used. */
  private async makeRoom(sandboxes: SandboxInfo[], name: string): Promise<boolean> {
    const running = sandboxes.filter((s) => RUNNING.has(s.phase) && s.name !== name);
    const needed = running.length - this.config.maxRunning + 1;
    if (needed <= 0) return true;
    const now = this.now();
    const idle = running
      .filter((s) => s.phase === "ready" && !this.busy(s.name) && now - (this.lastUsed.get(s.name) ?? now) >= EVICT_GRACE_MS)
      .sort((a, b) => (this.lastUsed.get(a.name) ?? now) - (this.lastUsed.get(b.name) ?? now));
    if (idle.length < needed) return false;
    for (const s of idle.slice(0, needed)) {
      this.log("sandbox_evict", { sandbox: s.name, for: name });
      await this.driver.stop(s.name);
      this.lastUsed.delete(s.name);
    }
    return true;
  }

  private async installToken(userId: string, name: string): Promise<void> {
    const token = randomBytes(32).toString("base64url");
    const status = await this.store.record(userId, name, sha256hex(token));
    if (status !== "recorded") throw new SandboxError(`record_agent: ${status}`);
    await this.driver.upsertProvider(toolsProviderName(name), this.config.toolsProviderType, { NOTCH_TOOL_TOKEN: token });
  }

  private spec(name: string): SandboxSpec {
    return {
      name,
      ...(this.config.image ? { image: this.config.image } : {}),
      command: this.config.command,
      env: { ...this.config.sandboxEnv, API_SERVER_KEY: sandboxApiKey(this.config.apiKeySecret, name) },
      labels: this.labels,
      providers: [...this.config.sharedProviders, toolsProviderName(name)],
      exposePort: this.config.hermesPort,
      ...(this.config.cpu ? { cpu: this.config.cpu } : {}),
      ...(this.config.memory ? { memory: this.config.memory } : {}),
    };
  }

  private async url(name: string): Promise<string> {
    const cached = this.urls.get(name);
    if (cached) return cached;
    const url = (await this.driver.serviceUrl(name, this.config.hermesPort)).replace(/\/+$/, "");
    this.urls.set(name, url);
    return url;
  }

  private async sweepIdleNow(): Promise<string[]> {
    const sandboxes = await this.driver.list(this.labels);
    this.seen(sandboxes);
    const now = this.now();
    const stopped: string[] = [];
    for (const s of sandboxes) {
      if (s.phase !== "ready" || this.busy(s.name)) continue;
      if (now - (this.lastUsed.get(s.name) ?? now) < this.config.idleStopMs) continue;
      try {
        await this.driver.stop(s.name);
        this.lastUsed.delete(s.name);
        stopped.push(s.name);
      } catch (e) {
        this.log("sandbox_stop_failed", { sandbox: s.name, error: String(e) });
      }
    }
    if (stopped.length > 0) this.log("sandboxes_idle_stopped", { sandboxes: stopped });
    return stopped;
  }

  private async sweepOrphansNow(maxDeletes: number): Promise<{ deleted: string[]; providersDeleted: string[] }> {
    // Sandboxes first, mappings second: a sandbox listed here was created after
    // its row was recorded, so the row is in the mapping list that follows.
    const sandboxes = await this.driver.list(this.labels);
    const wanted = new Set((await this.store.list()).map((a) => a.sandbox_name));
    const orphans = sandboxes.filter((s) => !wanted.has(s.name) && !this.busy(s.name));
    if (orphans.length > maxDeletes) this.log("orphans_capped", { found: orphans.length, deleting: maxDeletes });

    const deleted: string[] = [];
    for (const s of orphans.slice(0, maxDeletes)) {
      try {
        await this.driver.delete(s.name);
        this.urls.delete(s.name);
        this.lastUsed.delete(s.name);
        deleted.push(s.name);
      } catch (e) {
        this.log("sandbox_delete_failed", { sandbox: s.name, error: String(e) });
      }
    }

    // A provider can't be deleted while its sandbox exists; the next sweep
    // gets the providers of sandboxes deleted in this one.
    const present = new Set(sandboxes.map((s) => s.name));
    const prefix = `notch-${this.config.env}-`;
    const providersDeleted: string[] = [];
    for (const provider of await this.driver.listProviders()) {
      if (!provider.startsWith(prefix) || !provider.endsWith(TOOLS_SUFFIX)) continue;
      const owner = provider.slice(0, -TOOLS_SUFFIX.length);
      if (wanted.has(owner) || present.has(owner)) continue;
      try {
        await this.driver.deleteProvider(provider);
        providersDeleted.push(provider);
      } catch (e) {
        this.log("provider_delete_failed", { provider, error: String(e) });
      }
    }
    if (deleted.length > 0 || providersDeleted.length > 0) this.log("orphans_deleted", { deleted, providersDeleted });
    return { deleted, providersDeleted };
  }
}
