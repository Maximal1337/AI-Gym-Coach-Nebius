// Tests for scripts/image-inputs-changed.mjs (NH-37). Run: node --test scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decide, IMAGE_INPUTS } from "./image-inputs-changed.mjs";

const script = fileURLToPath(new URL("./image-inputs-changed.mjs", import.meta.url));

const fakeGit = (files, ancestor = true) => ({ contains: () => ancestor, changedFiles: () => files });

test("decide: nothing of the image's changed since the deployed commit, so no build", () => {
  const r = decide(["sha-0123456789ab", "sha-0123456789ab"], "fedcba987654", ["services/relay"], fakeGit([]));
  assert.equal(r.changed, false);
  assert.match(r.reason, /no input changed since 0123456789ab/);
});

test("decide: an input changed, or it can't tell — build", () => {
  assert.equal(decide(["sha-0123456789ab"], "fedcba987654", ["services/relay"], fakeGit(["services/relay/src/main.ts"])).changed, true);
  assert.match(decide(["unbuilt"], "fedcba987654", [], fakeGit([])).reason, /names no commit/);
  assert.match(decide([], "fedcba987654", [], fakeGit([])).reason, /no deployed tag/);
  assert.match(decide(["sha-0123456789ab"], "fedcba987654", [], fakeGit([], false)).reason, /isn't in fedcba987654's history/);
  assert.match(decide(["sha-0123456789ab"], "fedcba987654", [], fakeGit([], null)).reason, /isn't in/);
  assert.match(decide(["sha-0123456789ab"], "fedcba987654", [], fakeGit(null)).reason, /couldn't diff/);
  // dev and prod run different commits: either one behind is enough.
  const twoTags = { contains: () => true, changedFiles: (from) => (from === "aaaaaaaaaaaa" ? [] : ["deploy/images/hermes-sandbox/profile/SOUL.md"]) };
  assert.equal(decide(["sha-aaaaaaaaaaaa", "sha-bbbbbbbbbbbb"], "fedcba987654", [], twoTags).changed, true);
});

test("the relay's inputs are what its Dockerfile copies, the sandbox image's its context", () => {
  assert.deepEqual([...IMAGE_INPUTS["notch-relay"]].sort(), [".npmrc", ":(exclude,glob)services/relay/**/*.test.ts", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "services/relay"]);
  assert.deepEqual(IMAGE_INPUTS["notch-hermes-sandbox"], ["deploy/images/hermes-sandbox"]);
});

test("the manifests: CI's markers on the relay and dev's sandbox image; prod's sandbox image moves only by a commit of its own", () => {
  const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
  assert.match(read("deploy/notch/base/kustomization.yaml"), /# image-tag: notch-relay\r?\n/);
  assert.match(read("deploy/platform/openshell/values-dev.yaml"), /tag: \S+ # image-tag: notch-hermes-sandbox\r?\n/);
  assert.match(read("deploy/platform/openshell/values-prod.yaml"), /tag: \S+ # image-tag: notch-hermes-sandbox-prod\r?\n/);
});

test("in a real repository: docs alone build nothing, the image's own files do", () => {
  const dir = mkdtempSync(join(tmpdir(), "inputs-"));
  const run = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  run("init", "-q");
  run("config", "user.email", "t@example.org");
  run("config", "user.name", "t");
  const write = (path, text) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const commit = (msg) => {
    run("add", "-A");
    run("commit", "-q", "-m", msg);
    return run("rev-parse", "HEAD");
  };
  write("services/relay/src/main.ts", "1");
  write("docs/a.md", "1");
  const built = commit("relay");
  write("deploy/notch/base/kustomization.yaml", `    newTag: sha-${built.slice(0, 12)} # image-tag: notch-relay\n`);
  commit("deploy");
  write("docs/a.md", "2");
  const docs = commit("docs");
  const check = (sha) => spawnSync(process.execPath, [script, "notch-relay", sha, "--root", "deploy"], { cwd: dir, encoding: "utf8" });

  const skip = check(docs);
  assert.equal(skip.status, 0, skip.stderr);
  assert.equal(skip.stdout, "changed=false\n");
  assert.match(skip.stderr, /notch-relay: skip/);

  write("services/relay/src/main.test.ts", "1");
  const tests = commit("tests");
  assert.equal(check(tests).stdout, "changed=false\n", "the relay's tests alone build nothing");

  write("services/relay/src/main.ts", "2");
  const code = commit("code");
  const build = check(code);
  assert.equal(build.stdout, "changed=true\n");
  assert.match(build.stderr, /services\/relay\/src\/main\.ts/);

  assert.equal(check("0".repeat(12)).stdout, "changed=true\n", "an unknown commit builds");
  assert.match(spawnSync(process.execPath, [script, "notch-web", code], { cwd: dir, encoding: "utf8" }).stderr, /unknown image/);
});
