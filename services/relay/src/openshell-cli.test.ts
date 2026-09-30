import { test } from "node:test";
import assert from "node:assert/strict";
import { type Exec, OpenShellCli, parsePhase, parseSandbox } from "./openshell-cli.js";

type Call = { args: string[]; env?: Record<string, string> };

function fakeExec(respond: (args: string[]) => string | Error = () => "{}") {
  const calls: Call[] = [];
  const exec: Exec = (args, options) => {
    calls.push({ args, env: options?.env });
    const out = respond(args);
    return out instanceof Error ? Promise.reject(out) : Promise.resolve({ stdout: out, stderr: "" });
  };
  return { exec, calls };
}

test("phases: display names, protobuf enum names, anything else is unknown", () => {
  assert.equal(parsePhase("Ready"), "ready");
  assert.equal(parsePhase("SANDBOX_PHASE_STOPPED"), "stopped");
  assert.equal(parsePhase("provisioning"), "provisioning");
  assert.equal(parsePhase("Exploded"), "unknown");
  assert.equal(parsePhase(undefined), "unknown");
  assert.deepEqual(parseSandbox({ metadata: { name: "a" }, status: { phase: "Ready" } }), { name: "a", phase: "ready" });
  assert.equal(parseSandbox({ phase: "Ready" }), null);
});

test("list: filters by label, follows pages, reads the documented envelope", async () => {
  const { exec, calls } = fakeExec((args) =>
    args.includes("--page-token")
      ? JSON.stringify({ sandboxes: [{ name: "notch-prod-b", phase: "Stopped" }], next_page_token: "" })
      : JSON.stringify({ sandboxes: [{ name: "notch-prod-a", phase: "Ready" }], next_page_token: "p2" })
  );
  const list = await new OpenShellCli(exec).list({ "notch.app/env": "prod", "notch.app/managed-by": "notch-relay" });
  assert.deepEqual(list, [{ name: "notch-prod-a", phase: "ready" }, { name: "notch-prod-b", phase: "stopped" }]);
  assert.deepEqual(calls[0].args, ["sandbox", "list", "--selector", "notch.app/env=prod,notch.app/managed-by=notch-relay", "-o", "json"]);
  assert.deepEqual(calls[1].args.slice(-2), ["--page-token", "p2"]);
});

test("list: output that isn't the expected JSON is an error, not an empty list", async () => {
  for (const out of ["not json", JSON.stringify({ items: [] })]) {
    const { exec } = fakeExec(() => out);
    await assert.rejects(() => new OpenShellCli(exec).list({}));
  }
});

test("create: image, detached, the Hermes port exposed, labels, providers, plain env, then the command", async () => {
  const { exec, calls } = fakeExec();
  await new OpenShellCli(exec).create({
    name: "notch-prod-abc",
    image: "ghcr.io/x/hermes:sha-1",
    command: ["sh", "-c", "start"],
    env: { HERMES_HOME: "/sandbox/.hermes", API_SERVER_KEY: "k" },
    labels: { "notch.app/env": "prod" },
    providers: ["tf", "notch-prod-abc-tools"],
    exposePort: 8642,
    memory: "1Gi",
  });
  assert.deepEqual(calls[0].args, [
    "sandbox", "create", "--name", "notch-prod-abc", "--from", "ghcr.io/x/hermes:sha-1", "--detach", "--expose", "8642",
    "--label", "notch.app/env=prod",
    "--provider", "tf", "--provider", "notch-prod-abc-tools",
    "--env", "HERMES_HOME=/sandbox/.hermes", "--env", "API_SERVER_KEY=k",
    "--memory", "1Gi",
    "--no-auto-providers", "--no-credential-warnings", "-o", "json", "--", "sh", "-c", "start",
  ]);
});

test("create without an image uses the gateway's default sandbox image", async () => {
  const { exec, calls } = fakeExec();
  await new OpenShellCli(exec).create({ name: "s", command: ["x"], env: {}, labels: {}, providers: [], exposePort: 8642 });
  assert.ok(!calls[0].args.includes("--from"));
});

test("provider: the credential goes by name, its value only through the child's environment", async () => {
  const { exec, calls } = fakeExec();
  await new OpenShellCli(exec).upsertProvider("notch-prod-abc-tools", "notch-tools", { NOTCH_TOOL_TOKEN: "secret-token" });
  assert.deepEqual(calls[0].args, ["provider", "update", "notch-prod-abc-tools", "--credential", "NOTCH_TOOL_TOKEN"]);
  assert.deepEqual(calls[0].env, { NOTCH_TOOL_TOKEN: "secret-token" });
  assert.ok(calls.every((c) => !c.args.join(" ").includes("secret-token")));
});

test("provider: created when an update finds none; both failing is an error naming both", async () => {
  const created = fakeExec((args) => (args[1] === "update" ? new Error("not found") : "{}"));
  await new OpenShellCli(created.exec).upsertProvider("p", "notch-tools", { NOTCH_TOOL_TOKEN: "t" });
  assert.deepEqual(created.calls[1].args, ["provider", "create", "--name", "p", "--type", "notch-tools", "--credential", "NOTCH_TOOL_TOKEN"]);
  assert.deepEqual(created.calls[1].env, { NOTCH_TOOL_TOKEN: "t" });

  const broken = fakeExec(() => new Error("gateway down"));
  await assert.rejects(() => new OpenShellCli(broken.exec).upsertProvider("p", "notch-tools", { NOTCH_TOOL_TOKEN: "t" }), /update failed .* create failed/);
});

test("service URL: read from `service get`, checked against the port", async () => {
  const ok = fakeExec(() => JSON.stringify({ workspace: "default", sandbox: "s", service: "", target_port: 8642, url: "https://s.gw.example/" }));
  assert.equal(await new OpenShellCli(ok.exec).serviceUrl("s", 8642), "https://s.gw.example/");
  assert.deepEqual(ok.calls[0].args, ["service", "get", "s", "-o", "json"]);

  const wrongPort = fakeExec(() => JSON.stringify({ target_port: 9000, url: "https://s.gw.example/" }));
  await assert.rejects(() => new OpenShellCli(wrongPort.exec).serviceUrl("s", 8642), /exposes 9000/);
  const noUrl = fakeExec(() => JSON.stringify({ service: { url: "javascript:x" } }));
  await assert.rejects(() => new OpenShellCli(noUrl.exec).serviceUrl("s", 8642), /no URL/);
});

test("lifecycle and providers: the documented commands", async () => {
  const { exec, calls } = fakeExec((args) => (args[1] === "list" ? JSON.stringify({ providers: [{ name: "a" }, { id: "x" }] }) : "{}"));
  const cli = new OpenShellCli(exec);
  await cli.start("s");
  await cli.stop("s");
  await cli.delete("s");
  await cli.deleteProvider("p");
  assert.deepEqual(await cli.listProviders(), ["a"]);
  assert.deepEqual(calls.map((c) => c.args.join(" ")), [
    "sandbox start s", "sandbox stop s", "sandbox delete s", "provider delete p", "provider list -o json",
  ]);
});
