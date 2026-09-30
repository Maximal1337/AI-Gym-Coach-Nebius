import { test } from "node:test";
import assert from "node:assert/strict";
import type { JobContext, RecordAgentStatus } from "./outbox.js";
import {
  type AgentStore, DEFER_SECONDS, EVICT_GRACE_MS, type ManagerConfig, MANAGED_BY, sandboxApiKey, SandboxError,
  type SandboxInfo, SandboxManager, sandboxName, type SandboxPhase, type SandboxSpec, sha256hex, toolsProviderName,
} from "./sandbox-manager.js";

const MIN = 60_000;

class FakeDriver {
  sandboxes = new Map<string, { phase: SandboxPhase; spec?: SandboxSpec }>();
  providers = new Map<string, { type: string; credentials: Record<string, string> }>();
  calls: string[] = [];

  list(labels: Record<string, string>): Promise<SandboxInfo[]> {
    assert.deepEqual(labels, { "notch.app/env": "prod", "notch.app/managed-by": MANAGED_BY });
    return Promise.resolve([...this.sandboxes].map(([name, s]) => ({ name, phase: s.phase })));
  }
  create(spec: SandboxSpec) {
    this.calls.push(`create ${spec.name}`);
    assert.ok(!this.sandboxes.has(spec.name), "never a second sandbox with the same name");
    for (const p of spec.providers) assert.ok(p.startsWith("shared-") || this.providers.has(p), `provider ${p} exists first`);
    this.sandboxes.set(spec.name, { phase: "ready", spec });
    return Promise.resolve();
  }
  start(name: string) {
    this.calls.push(`start ${name}`);
    this.sandboxes.get(name)!.phase = "ready";
    return Promise.resolve();
  }
  stop(name: string) {
    this.calls.push(`stop ${name}`);
    this.sandboxes.get(name)!.phase = "stopped";
    return Promise.resolve();
  }
  delete(name: string) {
    this.calls.push(`delete ${name}`);
    this.sandboxes.delete(name);
    return Promise.resolve();
  }
  serviceUrl(name: string, port: number) {
    assert.equal(port, 8642);
    return Promise.resolve(`https://${name}--hermes.gateway.test/`);
  }
  upsertProvider(name: string, type: string, credentials: Record<string, string>) {
    this.calls.push(`provider ${name}`);
    this.providers.set(name, { type, credentials });
    return Promise.resolve();
  }
  listProviders() {
    return Promise.resolve([...this.providers.keys(), "shared-token-factory"]);
  }
  deleteProvider(name: string) {
    this.calls.push(`delete-provider ${name}`);
    if ([...this.sandboxes.values()].some((s) => s.spec?.providers.includes(name))) {
      return Promise.reject(new Error("provider is attached"));
    }
    this.providers.delete(name);
    return Promise.resolve();
  }
}

class FakeStore implements AgentStore {
  rows = new Map<string, { sandbox_name: string; hash: string }>();
  gone = new Set<string>();
  record(userId: string, sandboxName: string, tokenHash: string): Promise<RecordAgentStatus> {
    if (this.gone.has(userId)) return Promise.resolve("user_gone");
    this.rows.set(userId, { sandbox_name: sandboxName, hash: tokenHash });
    return Promise.resolve("recorded");
  }
  list() {
    return Promise.resolve([...this.rows].map(([user_id, r]) => ({ user_id, sandbox_name: r.sandbox_name })));
  }
}

const CONFIG: ManagerConfig = {
  env: "prod",
  image: "ghcr.io/maximal1337/notch-hermes-sandbox:sha-1",
  command: ["sh", "-c", "install-profile.sh && exec hermes gateway"],
  maxRunning: 2,
  idleStopMs: 10 * MIN,
  apiKeySecret: "k".repeat(40),
  sandboxEnv: { HERMES_HOME: "/sandbox/.hermes", TOKEN_FACTORY_MODEL: "nvidia/nemotron", NOTCH_TOOLS_URL: "https://ref.supabase.co/functions/v1/notch-tools" },
  sharedProviders: ["shared-token-factory", "shared-tavily"],
  toolsProviderType: "notch-tools",
  hermesPort: 8642,
};

function setup(config: Partial<ManagerConfig> = {}) {
  const driver = new FakeDriver();
  const store = new FakeStore();
  const clock = { t: 1_000_000 };
  const events: string[] = [];
  const manager = new SandboxManager(driver, store, { ...CONFIG, ...config }, () => clock.t, (e) => events.push(e));
  // The job context carries the mapping as Supabase last saw it.
  const job = (user: string): JobContext => {
    const row = store.rows.get(user);
    return {
      id: 1, lease_token: "l", leased_until: "", history: [], facts: [], message: null, user: null,
      job: { id: 1, kind: "chat", environment: "prod", user_id: user, attempts: 1 },
      agent: row ? { sandbox_name: row.sandbox_name, provisioned: true } : null,
    };
  };
  return { driver, store, clock, events, manager, job };
}

test("names: deterministic, per environment, valid for assistant_agents, no user id in them", () => {
  const a = sandboxName("prod", "3f1c2a5e-0b7d-4c1e-9a2b-1c2d3e4f5a6b");
  assert.equal(a, sandboxName("prod", "3f1c2a5e-0b7d-4c1e-9a2b-1c2d3e4f5a6b"));
  assert.notEqual(a, sandboxName("dev", "3f1c2a5e-0b7d-4c1e-9a2b-1c2d3e4f5a6b"));
  assert.match(a, /^notch-prod-[0-9a-f]{20}$/);
  assert.match(a, /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/); // the SQL check on sandbox_name
  assert.ok(!a.includes("3f1c2a5e"));
  assert.equal(sandboxApiKey("s".repeat(32), a), sandboxApiKey("s".repeat(32), a));
  assert.notEqual(sandboxApiKey("s".repeat(32), a), sandboxApiKey("s".repeat(32), sandboxName("prod", "other")));
});

test("first message: token recorded as a digest, provider holds the token, sandbox created with it", async () => {
  const { driver, store, manager, job } = setup();
  const lease = await manager.acquire(job("u1"));
  assert.ok("endpoint" in lease);
  const name = sandboxName("prod", "u1");
  const token = driver.providers.get(toolsProviderName(name))!.credentials.NOTCH_TOOL_TOKEN;
  assert.equal(store.rows.get("u1")!.hash, sha256hex(token), "Supabase gets the digest of the installed token");
  assert.match(token, /^[A-Za-z0-9_-]{43}$/, "32 random bytes");
  assert.deepEqual(driver.calls, [`provider ${name}-tools`, `create ${name}`], "mapping and provider before the sandbox");
  const spec = driver.sandboxes.get(name)!.spec!;
  assert.deepEqual(spec.providers, ["shared-token-factory", "shared-tavily", `${name}-tools`]);
  assert.equal(spec.env.API_SERVER_KEY, sandboxApiKey(CONFIG.apiKeySecret, name));
  assert.ok(!JSON.stringify(spec).includes(token), "the tool token isn't in the sandbox's plain environment");
  assert.equal(spec.exposePort, 8642);
  assert.deepEqual(lease.endpoint, { baseUrl: `https://${name}--hermes.gateway.test`, apiKey: sandboxApiKey(CONFIG.apiKeySecret, name) });
  lease.release();
});

test("idempotent: the next message reuses the sandbox and the token", async () => {
  const { driver, store, manager, job } = setup();
  (await manager.acquire(job("u1")) as { release: () => void }).release();
  const hash = store.rows.get("u1")!.hash;
  driver.calls = [];
  const lease = await manager.acquire(job("u1"));
  assert.ok("endpoint" in lease);
  assert.deepEqual(driver.calls, []);
  assert.equal(store.rows.get("u1")!.hash, hash);
});

test("a retry after a failed create mints a fresh token and creates the sandbox once", async () => {
  const { driver, store, manager, job } = setup();
  await store.record("u1", sandboxName("prod", "u1"), "f".repeat(64)); // recorded, then the create failed
  const lease = await manager.acquire(job("u1"));
  assert.ok("endpoint" in lease);
  assert.notEqual(store.rows.get("u1")!.hash, "f".repeat(64));
  assert.equal(driver.calls.filter((c) => c.startsWith("create")).length, 1);
});

test("a stopped sandbox is started, keeping its token and volume", async () => {
  const { driver, store, manager, job } = setup();
  (await manager.acquire(job("u1")) as { release: () => void }).release();
  const name = sandboxName("prod", "u1");
  driver.sandboxes.get(name)!.phase = "stopped";
  const hash = store.rows.get("u1")!.hash;
  driver.calls = [];
  assert.ok("endpoint" in (await manager.acquire(job("u1"))));
  assert.deepEqual(driver.calls, [`start ${name}`]);
  assert.equal(store.rows.get("u1")!.hash, hash);
});

test("a running sandbox without its mapping gets a new token and a restart to pick it up", async () => {
  const { driver, store, manager, job } = setup();
  (await manager.acquire(job("u1")) as { release: () => void }).release();
  store.rows.delete("u1"); // e.g. the row was reset by hand
  const name = sandboxName("prod", "u1");
  driver.calls = [];
  assert.ok("endpoint" in (await manager.acquire(job("u1"))));
  assert.deepEqual(driver.calls, [`provider ${name}-tools`, `stop ${name}`, `start ${name}`]);
  assert.ok(store.rows.has("u1"));
});

test("a sandbox mid-transition makes the job wait instead of stacking operations", async () => {
  for (const phase of ["provisioning", "starting", "stopping", "deleting", "unknown"] as const) {
    const { driver, manager, job } = setup();
    driver.sandboxes.set(sandboxName("prod", "u1"), { phase });
    assert.deepEqual(await manager.acquire(job("u1")), { defer: DEFER_SECONDS.busy, reason: `sandbox_${phase}` });
    assert.deepEqual(driver.calls, []);
  }
});

test("capacity: a third user waits while two sandboxes are busy or just used, then takes the idlest slot", async () => {
  const { driver, clock, manager, job } = setup({ maxRunning: 2 });
  const l1 = await manager.acquire(job("u1"));
  clock.t += 1_000;
  const l2 = await manager.acquire(job("u2"));
  assert.ok("endpoint" in l1 && "endpoint" in l2);

  assert.deepEqual(await manager.acquire(job("u3")), { defer: DEFER_SECONDS.capacity, reason: "capacity" }, "both answering");
  l1.release();
  l2.release();
  assert.deepEqual(await manager.acquire(job("u3")), { defer: DEFER_SECONDS.capacity, reason: "capacity" }, "both used just now");

  clock.t += EVICT_GRACE_MS + 1;
  driver.calls = [];
  const l3 = await manager.acquire(job("u3"));
  assert.ok("endpoint" in l3);
  assert.deepEqual(driver.calls.filter((c) => c.startsWith("stop")), [`stop ${sandboxName("prod", "u1")}`], "the least recently used one");
  assert.equal([...driver.sandboxes.values()].filter((s) => s.phase === "ready").length, 2, "never more than maxRunning");
});

test("capacity: an answering sandbox is never stopped to make room", async () => {
  const { driver, clock, manager, job } = setup({ maxRunning: 1 });
  const l1 = await manager.acquire(job("u1"));
  assert.ok("endpoint" in l1);
  clock.t += 60 * MIN;
  assert.deepEqual(await manager.acquire(job("u2")), { defer: DEFER_SECONDS.capacity, reason: "capacity" });
  assert.equal(driver.sandboxes.get(sandboxName("prod", "u1"))!.phase, "ready");
});

test("capacity decisions don't interleave: two new users at once, one slot", async () => {
  const { driver, manager, job } = setup({ maxRunning: 1 });
  const [a, b] = await Promise.all([manager.acquire(job("u1")), manager.acquire(job("u2"))]);
  assert.ok("endpoint" in a);
  assert.deepEqual(b, { defer: DEFER_SECONDS.capacity, reason: "capacity" });
  assert.equal(driver.sandboxes.size, 1);
});

test("idle: stopped after 10 minutes unused, never while answering", async () => {
  const { driver, clock, manager, job } = setup();
  const l1 = await manager.acquire(job("u1"));
  const l2 = await manager.acquire(job("u2"));
  assert.ok("endpoint" in l1 && "endpoint" in l2);
  l1.release();
  clock.t += 9 * MIN;
  assert.deepEqual(await manager.sweepIdle(), []);
  clock.t += 2 * MIN;
  assert.deepEqual(await manager.sweepIdle(), [sandboxName("prod", "u1")], "u2 is still answering");
  l2.release();
  clock.t += 10 * MIN;
  assert.deepEqual(await manager.sweepIdle(), [sandboxName("prod", "u2")]);
});

test("idle: after a relay restart, running sandboxes get a full idle period from first sight", async () => {
  const { driver, clock, manager } = setup();
  driver.sandboxes.set("notch-prod-seen", { phase: "ready" });
  assert.deepEqual(await manager.sweepIdle(), []);
  clock.t += 10 * MIN;
  assert.deepEqual(await manager.sweepIdle(), ["notch-prod-seen"]);
});

test("orphans (NH-56): a deleted account's sandbox goes, then its provider; mapped ones stay", async () => {
  const { driver, store, manager, job } = setup();
  for (const u of ["u1", "u2"]) (await manager.acquire(job(u)) as { release: () => void }).release();
  const gone = sandboxName("prod", "u2");
  store.rows.delete("u2"); // the account deletion cascaded the row away
  assert.deepEqual(await manager.sweepOrphans(), { deleted: [gone], providersDeleted: [] }, "the provider waits for the sandbox");
  assert.deepEqual(await manager.sweepOrphans(), { deleted: [], providersDeleted: [`${gone}-tools`] });
  assert.ok(driver.sandboxes.has(sandboxName("prod", "u1")) && driver.providers.has(`${sandboxName("prod", "u1")}-tools`));
  assert.ok(driver.providers.size === 1, "the shared provider isn't ours to delete");
});

test("orphans: at most a few per sweep, never one that's answering", async () => {
  const { driver, manager, job } = setup({ maxRunning: 10 });
  const busy = await manager.acquire(job("busy"));
  assert.ok("endpoint" in busy);
  for (let i = 0; i < 5; i++) driver.sandboxes.set(`notch-prod-orphan${i}`, { phase: "stopped" });
  const { store } = { store: (manager as unknown as { store: FakeStore }).store };
  store.rows.clear(); // even the busy user's row vanished
  const first = await manager.sweepOrphans(3);
  assert.equal(first.deleted.length, 3);
  assert.ok(!first.deleted.includes(sandboxName("prod", "busy")));
  assert.ok(driver.sandboxes.has(sandboxName("prod", "busy")));
});

test("an account deleted mid-provisioning: no sandbox, and the job fails cleanly", async () => {
  const { driver, store, manager, job } = setup();
  store.gone.add("u1");
  await assert.rejects(() => manager.acquire(job("u1")), (e: unknown) => e instanceof SandboxError && /user_gone/.test(e.message));
  assert.equal(driver.sandboxes.size, 0);
  assert.equal(driver.providers.size, 0);
});
