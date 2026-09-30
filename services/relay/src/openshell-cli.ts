import { execFile } from "node:child_process";
import type { SandboxDriver, SandboxInfo, SandboxPhase, SandboxSpec } from "./sandbox-manager.js";

/**
 * The sandbox manager's driver: the `openshell` CLI (the static
 * openshell-x86_64-unknown-linux-musl binary in the relay image), called with
 * `-o json` — no SDK, so nothing to install from an authenticated registry.
 * The gateway is chosen by the CLI's own configuration (OPENSHELL_GATEWAY and
 * its gateway directory); how the relay authenticates to it is settled in the
 * spike (NH-29) and needs nothing here.
 *
 * Commands and flags follow the OpenShell 0.1.2 docs. The JSON shapes are
 * read loosely (snake or camel case, a bare list or an envelope, phases as
 * "Ready" or "SANDBOX_PHASE_READY") until the spike pins them. Secrets never
 * go on a command line: a provider credential is passed by name and read by
 * the CLI from its own environment (the documented "bare key" form).
 */

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export type Exec = (args: string[], options?: { env?: Record<string, string>; timeoutMs?: number }) => Promise<ExecResult>;

export class OpenShellError extends Error {
  constructor(message: string, readonly args: string[], readonly stderr: string) {
    super(message);
    this.name = "OpenShellError";
  }
}

/** Runs the real binary. Credentials added through `env` reach only that one child process. */
export function execOpenShell(binary = "openshell"): Exec {
  return (args, options = {}) =>
    new Promise((resolve, reject) => {
      execFile(
        binary,
        args,
        {
          env: { ...process.env, NO_COLOR: "1", ...options.env },
          timeout: options.timeoutMs ?? 60_000,
          maxBuffer: 8 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            // The first line of stderr, never the environment: it may hold a credential.
            const detail = String(stderr).trim().split("\n")[0]?.slice(0, 300) ?? "";
            reject(new OpenShellError(`openshell ${args.slice(0, 2).join(" ")} failed: ${detail || error.message}`, args, String(stderr)));
            return;
          }
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
}

const PHASES: Record<string, SandboxPhase> = {
  provisioning: "provisioning",
  ready: "ready",
  stopping: "stopping",
  stopped: "stopped",
  starting: "starting",
  completed: "completed",
  error: "error",
  deleting: "deleting",
};

export function parsePhase(value: unknown): SandboxPhase {
  if (typeof value !== "string") return "unknown";
  const key = value.replace(/^SANDBOX_PHASE_/i, "").toLowerCase();
  return PHASES[key] ?? "unknown";
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function parseJson(stdout: string, what: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`openshell ${what}: output is not JSON`);
  }
}

/** A list response: `{sandboxes: [...], next_page_token}` per the docs, or a bare array. */
function page(stdout: string, key: string, what: string): { items: Json[]; next: string | null } {
  const parsed = parseJson(stdout, what);
  const items = Array.isArray(parsed) ? parsed : isObject(parsed) && Array.isArray(parsed[key]) ? parsed[key] : null;
  if (!items) throw new Error(`openshell ${what}: no "${key}" list in the output`);
  const token = isObject(parsed) ? (parsed.next_page_token ?? parsed.nextPageToken) : null;
  return { items: items.filter(isObject), next: typeof token === "string" && token ? token : null };
}

function nameOf(item: Json): string | null {
  const name = item.name ?? (isObject(item.metadata) ? item.metadata.name : undefined);
  return typeof name === "string" && name ? name : null;
}

export function parseSandbox(item: Json): SandboxInfo | null {
  const name = nameOf(item);
  if (!name) return null;
  const status = isObject(item.status) ? item.status : {};
  return { name, phase: parsePhase(item.phase ?? status.phase ?? item.state) };
}

const MAX_PAGES = 50;

export class OpenShellCli implements SandboxDriver {
  constructor(
    private readonly exec: Exec,
    private readonly timeouts = { quickMs: 60_000, lifecycleMs: 600_000 },
  ) {}

  private async all(baseArgs: string[], key: string, what: string): Promise<Json[]> {
    const out: Json[] = [];
    let token: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const args: string[] = token ? [...baseArgs, "--page-token", token] : baseArgs;
      const { items, next } = page((await this.exec(args, { timeoutMs: this.timeouts.quickMs })).stdout, key, what);
      out.push(...items);
      if (!next) return out;
      token = next;
    }
    throw new Error(`openshell ${what}: more than ${MAX_PAGES} pages`);
  }

  async list(labels: Record<string, string>): Promise<SandboxInfo[]> {
    const selector = Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(",");
    const items = await this.all(["sandbox", "list", "--selector", selector, "-o", "json"], "sandboxes", "sandbox list");
    return items.map(parseSandbox).filter((s): s is SandboxInfo => s !== null);
  }

  async create(spec: SandboxSpec): Promise<void> {
    const args = ["sandbox", "create", "--name", spec.name];
    if (spec.image) args.push("--from", spec.image);
    args.push("--detach", "--expose", String(spec.exposePort));
    for (const [k, v] of Object.entries(spec.labels)) args.push("--label", `${k}=${v}`);
    for (const p of spec.providers) args.push("--provider", p);
    // Plain values only (the API key is inbound auth to this user's own agent);
    // credentials come from providers, which the gateway injects (D-28).
    for (const [k, v] of Object.entries(spec.env)) args.push("--env", `${k}=${v}`);
    if (spec.cpu) args.push("--cpu", spec.cpu);
    if (spec.memory) args.push("--memory", spec.memory);
    args.push("--no-auto-providers", "--no-credential-warnings", "-o", "json", "--", ...spec.command);
    await this.exec(args, { timeoutMs: this.timeouts.lifecycleMs });
  }

  async start(name: string): Promise<void> {
    await this.exec(["sandbox", "start", name], { timeoutMs: this.timeouts.lifecycleMs });
  }

  async stop(name: string): Promise<void> {
    await this.exec(["sandbox", "stop", name], { timeoutMs: this.timeouts.lifecycleMs });
  }

  async delete(name: string): Promise<void> {
    await this.exec(["sandbox", "delete", name], { timeoutMs: this.timeouts.quickMs });
  }

  async serviceUrl(name: string, port: number): Promise<string> {
    const parsed = parseJson((await this.exec(["service", "get", name, "-o", "json"], { timeoutMs: this.timeouts.quickMs })).stdout, "service get");
    const record = isObject(parsed) && isObject(parsed.service) ? parsed.service : parsed;
    if (!isObject(record) || typeof record.url !== "string" || !/^https?:\/\//.test(record.url)) {
      throw new Error(`openshell service get: no URL for ${name}`);
    }
    const target = record.target_port ?? record.targetPort;
    if (target !== undefined && Number(target) !== port) throw new Error(`openshell service get: ${name} exposes ${target}, not ${port}`);
    return record.url;
  }

  async upsertProvider(name: string, type: string, credentials: Record<string, string>): Promise<void> {
    const keys = Object.keys(credentials);
    const byName = keys.flatMap((k) => ["--credential", k]);
    const options = { env: credentials, timeoutMs: this.timeouts.quickMs };
    try {
      await this.exec(["provider", "update", name, ...byName], options);
    } catch (updateError) {
      try {
        await this.exec(["provider", "create", "--name", name, "--type", type, ...byName], options);
      } catch (createError) {
        throw new Error(`provider ${name}: update failed (${(updateError as Error).message}), create failed (${(createError as Error).message})`);
      }
    }
  }

  async listProviders(): Promise<string[]> {
    const items = await this.all(["provider", "list", "-o", "json"], "providers", "provider list");
    return items.map(nameOf).filter((n): n is string => n !== null);
  }

  async deleteProvider(name: string): Promise<void> {
    await this.exec(["provider", "delete", name], { timeoutMs: this.timeouts.quickMs });
  }
}
