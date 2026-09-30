import type { SandboxEndpoint } from "./hermes.js";
import type { JobContext } from "./outbox.js";
import type { SandboxLease } from "./sandbox-manager.js";

/**
 * Where each user's sandbox is reached. Until the sandbox manager (NH-55)
 * provisions and tracks sandboxes, the spike and dev use a static map from
 * RELAY_STATIC_SANDBOXES: {"<user id>": {"baseUrl": "...", "apiKey": "..."}}.
 * A user missing from the map has no sandbox — their job waits in the queue.
 */
export function staticSandboxes(raw: string | undefined): Map<string, SandboxEndpoint> {
  if (!raw?.trim()) return new Map();
  const parsed = JSON.parse(raw) as Record<string, SandboxEndpoint>;
  return new Map(Object.entries(parsed).filter(([, e]) => typeof e?.baseUrl === "string" && typeof e?.apiKey === "string"));
}

/** The spike's stand-in for the sandbox manager: a mapped user runs, anyone else waits. */
export function staticAcquire(sandboxes: Map<string, SandboxEndpoint>): (job: JobContext) => Promise<SandboxLease> {
  return (job) => {
    const endpoint = sandboxes.get(job.job.user_id);
    return Promise.resolve(endpoint ? { endpoint, release: () => {} } : { defer: 60, reason: "no_sandbox" });
  };
}
