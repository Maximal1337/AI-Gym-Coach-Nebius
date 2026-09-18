// Type-checks every Supabase Edge Function with Deno against a recorded
// baseline (NH-08). The functions use the untyped Supabase client, so
// `deno check` reports pre-existing errors (see the verify skill); CI fails
// only when a function gains errors relative to the baseline, so new type
// errors can't slip in while the old ones get paid down.
//
// Usage (requires deno on PATH):
//   node scripts/check-edge-functions.mjs            compare with the baseline
//   node scripts/check-edge-functions.mjs --update   rewrite the baseline
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const functionsDir = join(root, "supabase", "functions");
const baselinePath = join(root, "scripts", "deno-check-baseline.json");
const update = process.argv.includes("--update");

// Every shared module is checked on its own too, so one no function imports
// yet (e.g. a helper written ahead of its first caller) is still covered.
const targets = [
  ...readdirSync(join(functionsDir, "_shared"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `_shared/${f}`),
  ...readdirSync(functionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(functionsDir, d.name, "index.ts")))
    .map((d) => `${d.name}/index.ts`),
].sort();

function check(target) {
  const res = spawnSync("deno", ["check", "--no-config", join(functionsDir, target)], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DENO_NO_PACKAGE_JSON: "1", NO_COLOR: "1" },
  });
  if (res.error) throw res.error;
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  if (res.status === 0) return { count: 0, output };
  const found = Number(output.match(/Found (\d+) errors?/)?.[1] ?? 0);
  const listed = output.match(/^\s*(?:error: )?TS\d+ \[ERROR\]/gm)?.length ?? 0;
  // A failing run with no recognizable type errors (e.g. a module that failed
  // to resolve) still counts as one error, so it can never pass silently.
  return { count: found || listed || 1, output };
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
const results = {};
const regressions = [];

for (const target of targets) {
  const { count, output } = check(target);
  results[target] = count;
  if (update) {
    console.log(`${target}: ${count}`);
    continue;
  }
  const allowed = baseline[target] ?? 0;
  if (count > allowed) {
    regressions.push(target);
    console.error(`FAIL ${target}: ${count} error(s), baseline ${allowed}\n${output}`);
  } else if (count < allowed) {
    console.log(`ok   ${target}: ${count} (baseline ${allowed}) — improved; run with --update to lock it in`);
  } else {
    console.log(`ok   ${target}: ${count}`);
  }
}

if (update) {
  writeFileSync(baselinePath, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`Baseline written to ${baselinePath}`);
} else if (regressions.length) {
  console.error(
    `\n${regressions.length} function(s) gained type errors. Fix them, or — for a new function or an ` +
      `intentional change — review the errors and run: node scripts/check-edge-functions.mjs --update`,
  );
  process.exit(1);
}
