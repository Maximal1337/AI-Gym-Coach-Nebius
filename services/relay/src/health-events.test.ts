// The relay's error events and the VPS health check (deploy/ops/health.sh,
// NH-35), which counts them in the relay's logs and alerts when they pile up.
// The two lists live in different languages; this keeps them in step, so an
// error event the relay starts logging can't go unnoticed by the alert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const src = repo("services/relay/src");

// What the relay's pod runs; bench.ts and agent-probe.ts are tools run by hand.
const relayFiles = readdirSync(src).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "bench.ts" && f !== "agent-probe.ts");

/** Every event name the relay logs: the string literals in a log call's first argument. */
function loggedEvents(): Set<string> {
  const events = new Set<string>();
  for (const f of relayFiles) {
    const code = readFileSync(`${src}/${f}`, "utf8");
    for (const call of code.matchAll(/\blog\(([^{]*?),\s*\{/g)) {
      for (const name of call[1].matchAll(/"([a-z_]+)"/g)) events.add(name[1]);
    }
  }
  return events;
}

/** The events health.sh counts as relay errors. */
function healthEvents(): Set<string> {
  const script = readFileSync(repo("deploy/ops/health.sh"), "utf8");
  const list = script.match(/select\(\.event \| IN\(([^)]*)\)\)/);
  assert.ok(list, "health.sh's relay error filter not found");
  return new Set([...list[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
}

const isError = (event: string) => event === "fatal" || /_(failed|error|refused)$/.test(event);

test("health.sh counts every error event the relay logs", () => {
  const logged = loggedEvents();
  assert.ok(logged.has("turn_failed") && logged.has("batch"), `found too few events: ${[...logged].join(", ")}`);
  const counted = healthEvents();
  const missing = [...logged].filter((e) => isError(e) && !counted.has(e));
  assert.deepEqual(missing, [], "add these to the relay error filter in deploy/ops/health.sh");
});

test("health.sh counts only events the relay still logs", () => {
  const logged = loggedEvents();
  const stale = [...healthEvents()].filter((e) => !logged.has(e));
  assert.deepEqual(stale, [], "renamed or removed in services/relay/src");
});

test("health.sh's spend-ceiling check reads an event the relay still logs", () => {
  const script = readFileSync(repo("deploy/ops/health.sh"), "utf8");
  const watched = [...script.matchAll(/select\(\.event == "([a-z_]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(watched, ["paused"]);
  assert.ok(loggedEvents().has("paused"), "the relay no longer logs paused; health.sh's spend-ceiling check would never fire");
});
