// The sandbox policy's network rules against the provider profiles
// (deploy/platform/openshell, NH-22, NH-32). Under a global policy OpenShell
// doesn't compose a provider's rules into a sandbox's policy, so the policy
// repeats them — and these tests keep the copy from drifting or widening.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const dir = fileURLToPath(new URL("../../../deploy/platform/openshell/", import.meta.url));
const policyText = readFileSync(join(dir, "sandbox-policy.yaml"), "utf8");
// deno-lint-ignore no-explicit-any
const policy = parse(policyText) as any;
// deno-lint-ignore no-explicit-any
const profiles: any[] = readdirSync(join(dir, "profiles"))
  .filter((f) => f.endsWith(".yaml"))
  .sort()
  .map((f) => parse(readFileSync(join(dir, "profiles", f), "utf8")));
const ruleName = (profileId: string) => profileId.replace(/-/g, "_");

test("the policy's network rules are the provider profiles' endpoints: none missing, none extra", () => {
  assert.deepEqual(profiles.map((p) => p.id), ["notch-tools", "tavily", "token-factory"]);
  assert.deepEqual(Object.keys(policy.network_policies).sort(), profiles.map((p) => ruleName(p.id)).sort());
});

test("each rule repeats its profile: the same hosts, ports, paths, methods and binary", () => {
  for (const profile of profiles) {
    const rule = policy.network_policies[ruleName(profile.id)];
    assert.equal(rule.name, ruleName(profile.id));
    // Field for field, so a method or a path added on one side only fails here.
    assert.deepEqual(rule.endpoints, profile.endpoints, `${profile.id}: endpoints`);
    assert.deepEqual(rule.binaries, profile.binaries.map((path: string) => ({ path })), `${profile.id}: binaries`);
    assert.deepEqual(Object.keys(rule).sort(), ["binaries", "endpoints", "name"], `${profile.id}: nothing else in the rule`);
  }
});

test("no rule is wider than a method on an exact path, over TLS, enforced, for Hermes' interpreter alone", () => {
  // deno-lint-ignore no-explicit-any
  for (const [name, rule] of Object.entries<any>(policy.network_policies)) {
    assert.deepEqual(rule.binaries, [{ path: "@HERMES_BINARY@" }], name);
    for (const endpoint of rule.endpoints) {
      assert.equal(endpoint.port, 443, name);
      assert.equal(endpoint.protocol, "rest", name);
      assert.equal(endpoint.enforcement, "enforce", name);
      assert.equal(endpoint.access, undefined, `${name}: rules, not blanket access`);
      assert.doesNotMatch(String(endpoint.host), /\*/, `${name}: one host`);
      assert.ok(endpoint.rules.length > 0, name);
      for (const r of endpoint.rules) {
        assert.deepEqual(Object.keys(r), ["allow"], name);
        assert.match(r.allow.method, /^(GET|POST)$/, name);
        assert.match(r.allow.path, /^\/[A-Za-z0-9/_-]+$/, `${name}: an exact path, no wildcard`);
      }
    }
  }
  // D-04: search only — no extract endpoint for the agent to have a URL fetched.
  assert.deepEqual(policy.network_policies.tavily.endpoints[0].rules, [{ allow: { method: "POST", path: "/search" } }]);
  assert.deepEqual(policy.network_policies.token_factory.endpoints[0].rules, [
    { allow: { method: "POST", path: "/v1/chat/completions" } },
    { allow: { method: "GET", path: "/v1/models" } },
  ]);
});

test("the policy takes the profiles' two placeholders and no environment's own values", () => {
  const body = policyText.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");
  assert.deepEqual([...new Set(body.match(/@[A-Z_]+@/g))].sort(), ["@HERMES_BINARY@", "@SUPABASE_HOST@"]);
  assert.equal(policy.network_policies.notch_tools.endpoints[0].host, "@SUPABASE_HOST@");
  assert.doesNotMatch(body, /supabase\.co/);
});

test("the filesystem part stays OpenShell's default plus the two image directories", () => {
  assert.deepEqual(policy.filesystem_policy.read_only, ["/bin", "/usr", "/lib", "/proc", "/dev/urandom", "/etc", "/var/log", "/opt/notch", "/opt/hermes"]);
  assert.deepEqual(policy.filesystem_policy.read_write, ["/tmp", "/dev/null"]);
  assert.equal(policy.filesystem_policy.include_workdir, true);
});
