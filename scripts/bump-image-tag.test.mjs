// Tests for scripts/bump-image-tag.mjs (NH-37). Run: node --test scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rewrite, shouldBump } from "./bump-image-tag.mjs";

const script = fileURLToPath(new URL("./bump-image-tag.mjs", import.meta.url));

test("rewrite: only the marked line of that image changes", () => {
  const text = [
    "images:",
    "  - name: notch-relay",
    "    newName: ghcr.io/maximal1337/notch-relay",
    "    newTag: unbuilt # image-tag: notch-relay",
    "  - name: other",
    "    newTag: v1 # image-tag: other",
    "    note: sha-x # image-tag: notch-relay-extra",
  ].join("\n");
  const r = rewrite(text, "notch-relay", "sha-0123456789ab");
  assert.equal(r.marked, 1);
  assert.deepEqual(r.previous, ["unbuilt"]);
  assert.match(r.text, /newTag: sha-0123456789ab # image-tag: notch-relay\n/);
  assert.match(r.text, /newTag: v1 # image-tag: other/);
  assert.match(r.text, /note: sha-x # image-tag: notch-relay-extra/);
});

test("rewrite: quoted values, list items, Helm values and CRLF files", () => {
  const helm = 'sandbox:\r\n  image:\r\n    tag: "old" # image-tag: hermes-sandbox\r\n';
  const r = rewrite(helm, "hermes-sandbox", "sha-abc1234");
  assert.equal(r.text, 'sandbox:\r\n  image:\r\n    tag: "sha-abc1234" # image-tag: hermes-sandbox\r\n');
  assert.equal(rewrite("- tag: a # image-tag: x\n", "x", "b").text, "- tag: b # image-tag: x\n");
  assert.equal(rewrite("tag: a\n", "x", "b").marked, 0);
});

test("rewrite: refuses tags and names that could break the YAML", () => {
  assert.throws(() => rewrite("", "notch-relay", "bad tag"), /invalid tag/);
  assert.throws(() => rewrite("", "notch-relay", "x\n# image-tag: y"), /invalid tag/);
  assert.throws(() => rewrite("", "Notch Relay", "v1"), /invalid image/);
  assert.throws(() => rewrite("", "notch-relay", "-v1"), /invalid tag/);
});

test("shouldBump: first build, same commit, newer and older commits", () => {
  const never = () => { throw new Error("git should not be asked"); };
  assert.equal(shouldBump("unbuilt", "abc1234def", never), true);
  assert.equal(shouldBump("sha-abc1234def0", "abc1234def0123", never), false);
  // The built commit is already in the deployed commit's history: an older run.
  assert.equal(shouldBump("sha-bbbbbbbbbbbb", "aaaaaaaaaaaa", () => true), false);
  assert.equal(shouldBump("sha-bbbbbbbbbbbb", "cccccccccccc", () => false), true);
  // Git can't tell (unknown commit): deploy what was just built and tested.
  assert.equal(shouldBump("sha-bbbbbbbbbbbb", "cccccccccccc", () => null), true);
});

test("cli: rewrites files under --root, keeps unrelated files, and fails without a marker", () => {
  const root = mkdtempSync(join(tmpdir(), "bump-"));
  mkdirSync(join(root, "a", "b"), { recursive: true });
  writeFileSync(join(root, "a", "b", "kustomization.yaml"), "    newTag: unbuilt # image-tag: notch-relay\n");
  writeFileSync(join(root, "a", "values.yaml"), "tag: keep # image-tag: other\n");
  writeFileSync(join(root, "notes.txt"), "newTag: unbuilt # image-tag: notch-relay\n");
  const out = execFileSync("node", [script, "notch-relay", "sha-0123456789ab", "--root", root], { encoding: "utf8" });
  assert.match(out, /unbuilt → sha-0123456789ab/);
  assert.equal(readFileSync(join(root, "a", "b", "kustomization.yaml"), "utf8"), "    newTag: sha-0123456789ab # image-tag: notch-relay\n");
  assert.equal(readFileSync(join(root, "a", "values.yaml"), "utf8"), "tag: keep # image-tag: other\n");
  assert.equal(readFileSync(join(root, "notes.txt"), "utf8"), "newTag: unbuilt # image-tag: notch-relay\n");
  assert.throws(() => execFileSync("node", [script, "missing", "v1", "--root", root], { stdio: "pipe" }), /no line marked/);
});

test("the repository's own manifests carry the relay marker", () => {
  const kustomization = fileURLToPath(new URL("../deploy/notch/base/kustomization.yaml", import.meta.url));
  assert.equal(rewrite(readFileSync(kustomization, "utf8"), "notch-relay", "sha-0123456789ab").marked, 1);
});
