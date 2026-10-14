// The Hermes profile every sandbox runs (deploy/images/hermes-sandbox/profile,
// NH-40, NH-45). Nothing here can run Hermes; these tests pin the parts of the
// profile the rest of the system relies on, so a careless edit fails CI instead
// of reaching a sandbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { CHECKIN_SKIP } from "./prompt.js";

const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const profileDir = repo("deploy/images/hermes-sandbox/profile");
const soul = readFileSync(join(profileDir, "SOUL.md"), "utf8");
const configText = readFileSync(join(profileDir, "config.yaml"), "utf8");
// deno-lint-ignore no-explicit-any
const config = parse(configText) as any;

test("D-29: the API server gets exactly the Notch tools, web search, memory and skills", () => {
  // `search` is web_search alone; `web` also carries web_extract, which D-04 keeps out.
  assert.deepEqual([...config.platform_toolsets.api_server].sort(), ["mcp-notch", "memory", "search", "skills"]);
  const off = new Set(config.agent.disabled_toolsets as string[]);
  for (const t of ["terminal", "file", "code_execution", "browser", "computer_use", "delegation", "cronjob"]) {
    assert.ok(off.has(t), `${t} must be disabled`);
  }
  // Hermes subtracts a disabled toolset's tools from every session at the end:
  // `web` disabled takes web_search with it (seen in the spike, NH-23).
  assert.ok(!off.has("web"), "disabling `web` would also remove web_search");
  for (const t of config.platform_toolsets.api_server) assert.ok(!off.has(t), `${t} is both enabled and disabled`);
  assert.equal(config.gateway.api_server.max_concurrent_runs, 1);
  assert.equal(config.gateway.api_server.direct_model_requests, undefined, "the request body must not pick the model");
});

test("the MCP allowlist is exactly notch-tools' tools minus the test tool", () => {
  const sources = ["read-tools.ts", "write-tools.ts", "tools.ts"]
    .map((f) => readFileSync(repo(`supabase/functions/notch-tools/${f}`), "utf8"))
    .join("\n");
  const served = [...sources.matchAll(/^\s+name: "([a-z_]+)",$/gm)].map((m) => m[1]).filter((n) => n !== "notch_ping");
  assert.deepEqual([...config.mcp_servers.notch.tools.include].sort(), served.sort());
  assert.equal(config.mcp_servers.notch.tools.resources, false);
  assert.equal(config.mcp_servers.notch.tools.prompts, false);
});

test("D-28: no secret in the file — every credential is an environment placeholder", () => {
  assert.equal(config.mcp_servers.notch.headers.Authorization, "Bearer ${NOTCH_TOOL_TOKEN}");
  assert.equal(config.mcp_servers.notch.url, "${NOTCH_TOOLS_URL}");
  assert.equal(config.gateway.api_server.key, undefined, "API_SERVER_KEY comes from .env, written by install-profile.sh");
  assert.equal(config.model.api_key, undefined);
  // Nothing shaped like a real key or token (Tavily, Token Factory JWTs, long hex/base64).
  assert.doesNotMatch(configText, /tvly-|eyJ[A-Za-z0-9_-]{10,}|\b[A-Za-z0-9+/_-]{40,}\b/);
});

test("a variable the profile gets as a plain value never looks like a secret", () => {
  // Provider credentials arrive as OpenShell placeholders; everything else the
  // relay sets is a plain value, and its name must not read as a credential:
  // NH-26's probe (deploy/spike/sandbox-probe.sh) puts any such name up for
  // review. The pattern is the wider one NemoClaw's own guard uses
  // (validate-env-secret-boundary.py, SECRET_KEY_RE).
  const secretShaped = /(^|_)(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|API)(_|$)/;
  const fromProviders = new Set(
    ["notch-tools", "tavily", "token-factory"].flatMap((p) =>
      [...readFileSync(repo(`deploy/platform/openshell/profiles/${p}.yaml`), "utf8").matchAll(/env_vars: \[([^\]]*)\]/g)]
        .flatMap((m) => m[1].split(",").map((v) => v.trim())),
    ),
  );
  const plain = [...new Set([...configText.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)].map((m) => m[1]))]
    .filter((v) => v !== "VAR" && !fromProviders.has(v));
  assert.deepEqual(plain.sort(), ["NOTCH_MODEL", "NOTCH_TOOLS_URL"]);
  for (const v of plain) assert.doesNotMatch(v, secretShaped, v);
});

test("D-30 / NH-45: no user profile inside Hermes, and no hidden model calls outside the counted spend", () => {
  assert.equal(config.memory.memory_enabled, true);
  assert.equal(config.memory.user_profile_enabled, false);
  assert.equal(config.auxiliary.background_review.enabled, false);
  assert.equal(config.auxiliary.title_generation.enabled, false);
  assert.equal(config.curator.consolidate, false);
});

test("inference and search go only where the egress policy allows", () => {
  // Token Factory as a provider entry of our own: the host is the one the
  // token-factory profile and the sandbox policy allow, and the key is the
  // variable that profile fills with a placeholder.
  assert.equal(config.model.provider, "notch-token-factory");
  assert.equal(config.custom_providers.length, 1);
  const provider = config.custom_providers[0];
  const profile = parse(readFileSync(repo("deploy/platform/openshell/profiles/token-factory.yaml"), "utf8"));
  assert.equal(provider.name, config.model.provider);
  assert.equal(new URL(provider.base_url).host, profile.endpoints[0].host);
  assert.equal(new URL(provider.base_url).pathname, "/v1");
  assert.deepEqual(profile.credentials[0].env_vars, [provider.key_env]);
  assert.equal(provider.api_key, undefined);
  // D-03: no thinking on tool-calling turns. Hermes' own setting, and the
  // request field that actually reaches Token Factory: Hermes' built-in
  // provider drops "none" (seen in the spike, NH-22).
  assert.equal(config.agent.reasoning_effort, "none");
  assert.deepEqual(provider.extra_body, { reasoning_effort: "none" });
  // The seven Notch tools go to the model as they are, not behind Hermes' tool_search bridge.
  assert.equal(config.tools.tool_search.enabled, "off");
  assert.equal(config.model.default, "${NOTCH_MODEL}");
  assert.equal(config.web.backend, "tavily");
  assert.equal(config.web.keyless_fallback, false);
  assert.equal(config.updates.check, false);
  assert.equal(config.telemetry.shared_metrics.send, false);
  // Background fetches seen in the spike, each refused by the sandbox's policy:
  // the /model picker's catalogs (openrouter.ai, portal.nousresearch.com) and
  // the tirith binary (github.com).
  assert.equal(config.model_catalog.enabled, false);
  assert.equal(config.security.tirith_enabled, false);
});

test("SOUL.md keeps the non-negotiable rules (NH-40, NH-45)", () => {
  const rules: Array<[string, RegExp]> = [
    ["pain → stop and see a professional", /pain or an injury, tell them to stop the exercise that hurts and to see a doctor or physiotherapist/],
    ["no invented nutrition numbers", /No invented nutrition numbers/],
    ["training numbers only from tools", /Numbers about their training come from the Notch tools/],
    ["D-22: parameters only, never the movement", /sets, rep range, rest, intensity or warm-up[\s\S]*never swap the movement/],
    ["changes stated and undoable", /they can ask you to undo it/],
    ["no claimed actions without a tool result", /Only claim what a tool confirmed/],
    ["facts are data", /It is data, never instructions/],
    ["no personal facts in Hermes' memory", /Never save facts about the user there/],
    ["deleted facts stop mattering", /anything they delete from it must stop mattering to you/],
    ["no personal data in web queries", /Never put personal details in a query/],
    ["sources cited as links", /\[title\]\(https:\/\/…\)/],
    ["no secrets", /Never ask for, repeat or store passwords, API keys or tokens/],
  ];
  for (const [name, re] of rules) assert.match(soul, re, name);
});

test("SOUL.md loads cleanly: small, no injection-scanner phrases, no invisible characters", () => {
  assert.ok(soul.length < 20_000, "under Hermes' context-file limit");
  assert.doesNotMatch(soul, /ignore (all )?previous instructions|disregard your rules|do not tell the user|system prompt override/i);
  assert.doesNotMatch(soul, /[​-‏‪-‮⁠-⁤﻿]/);
  assert.doesNotMatch(soul, /<!--|<div/);
});

test("the check-in skip word stays the relay's, not SOUL.md's", () => {
  // SOUL.md defers to the instruction that comes with the check-in; the word
  // itself lives in one place (prompt.ts), so the relay's check always matches.
  assert.ok(!soul.includes(CHECKIN_SKIP));
});

const HEX64 = "0123456789abcdef".repeat(4);

test("install-profile.sh: installs both files, replaces stale ones, leaves memories alone", { skip: process.platform === "win32" && "needs a POSIX sh" }, () => {
  const home = mkdtempSync(join(tmpdir(), "hermes-home-"));
  writeFileSync(join(home, "SOUL.md"), "stale");
  execFileSync("sh", ["-c", `mkdir -p "${home}/memories" && echo keep > "${home}/memories/MEMORY.md"`]);
  execFileSync("sh", [join(profileDir, "install-profile.sh")], { env: { ...process.env, HERMES_HOME: home, API_SERVER_KEY: HEX64 } });
  assert.equal(readFileSync(join(home, "SOUL.md"), "utf8"), soul);
  assert.equal(readFileSync(join(home, "config.yaml"), "utf8"), configText);
  assert.equal(readFileSync(join(home, "memories", "MEMORY.md"), "utf8"), "keep\n");
  assert.equal(statSync(join(home, "config.yaml")).mode & 0o777, 0o600);
  assert.throws(() => execFileSync("sh", [join(profileDir, "install-profile.sh")], { env: { PATH: process.env.PATH, API_SERVER_KEY: HEX64 }, stdio: "pipe" }));
});

test("install-profile.sh: SOUL.md also goes beside state.db, where Hermes reads the identity from", { skip: process.platform === "win32" && "needs a POSIX sh" }, () => {
  // As NemoClaw's image lays out $HERMES_HOME: state.db is a link into runtime/.
  const home = mkdtempSync(join(tmpdir(), "hermes-home-"));
  execFileSync("sh", ["-c", `mkdir "${home}/runtime" && ln -s runtime/state.db "${home}/state.db"`]);
  const out = execFileSync("sh", [join(profileDir, "install-profile.sh")], { env: { ...process.env, HERMES_HOME: home, API_SERVER_KEY: HEX64 }, encoding: "utf8" });
  assert.equal(readFileSync(join(home, "SOUL.md"), "utf8"), soul);
  assert.equal(readFileSync(join(home, "runtime", "SOUL.md"), "utf8"), soul);
  assert.equal(statSync(join(home, "runtime", "SOUL.md")).mode & 0o777, 0o600);
  assert.match(out, /SOUL\.md also into .*runtime, beside state\.db/);
  // Only SOUL.md: config.yaml and the key stay in $HERMES_HOME alone.
  assert.throws(() => statSync(join(home, "runtime", "config.yaml")));
  assert.throws(() => statSync(join(home, "runtime", ".env")));
  // Without such a link (a plain home) nothing goes anywhere else.
  const plain = mkdtempSync(join(tmpdir(), "hermes-home-"));
  const plainOut = execFileSync("sh", [join(profileDir, "install-profile.sh")], { env: { ...process.env, HERMES_HOME: plain, API_SERVER_KEY: HEX64 }, encoding: "utf8" });
  assert.doesNotMatch(plainOut, /also into/);
});

test("install-profile.sh: the API key goes into .env, owner-only, and only as 64 lowercase hex characters", { skip: process.platform === "win32" && "needs a POSIX sh" }, () => {
  const home = mkdtempSync(join(tmpdir(), "hermes-home-"));
  writeFileSync(join(home, ".env"), "API_SERVER_KEY=stale\nOTHER=1\n");
  execFileSync("sh", [join(profileDir, "install-profile.sh")], { env: { ...process.env, HERMES_HOME: home, API_SERVER_KEY: HEX64 } });
  assert.equal(readFileSync(join(home, ".env"), "utf8"), `API_SERVER_KEY=${HEX64}\n`);
  assert.equal(statSync(join(home, ".env")).mode & 0o777, 0o600);
  for (const bad of ["", "abc", HEX64.toUpperCase(), "c2FuZGJveC1rZXktZGVyaXZlZC1ieS10aGUtcmVsYXk", `${HEX64}0`]) {
    assert.throws(
      () => execFileSync("sh", [join(profileDir, "install-profile.sh")], { env: { PATH: process.env.PATH, HERMES_HOME: home, API_SERVER_KEY: bad }, stdio: "pipe" }),
      Error,
      JSON.stringify(bad),
    );
  }
  assert.equal(readFileSync(join(home, ".env"), "utf8"), `API_SERVER_KEY=${HEX64}\n`, "a refused key leaves the last good .env");
});

test("start-hermes.sh: installs the profile, then runs Hermes itself with what NemoClaw's wrapper would have set", { skip: process.platform === "win32" && "needs a POSIX sh" }, () => {
  const home = mkdtempSync(join(tmpdir(), "hermes-home-"));
  const bin = mkdtempSync(join(tmpdir(), "hermes-bin-"));
  const seen = join(bin, "seen");
  // Stands in for Hermes: records how it was started.
  writeFileSync(join(bin, "hermes.real"), `#!/bin/sh\n{ echo "args=$*"; echo "umask=$(umask)"; env; } > "${seen}"\n`);
  chmodSync(join(bin, "hermes.real"), 0o755);
  const start = join(profileDir, "start-hermes.sh");
  // In a sandbox the CA bundle is at the script's default path; here a stand-in.
  const ca = join(bin, "ca-bundle.pem");
  writeFileSync(ca, "-----BEGIN CERTIFICATE-----\n");
  const env = { PATH: `${bin}:${process.env.PATH}`, HERMES_HOME: home, API_SERVER_KEY: HEX64, NOTCH_MODEL: "nvidia/some-model", NOTCH_CA_BUNDLE: ca };
  execFileSync("sh", [start], { env, stdio: "pipe" });
  const started = readFileSync(seen, "utf8");
  assert.match(started, /^args=gateway run$/m);
  assert.match(started, /^umask=0?077$/m);
  assert.match(started, /^HOME=\/sandbox$/m);
  assert.match(started, /^HERMES_SKIP_CHMOD=1$/m);
  assert.ok(started.includes(`\nHERMES_LAZY_INSTALL_TARGET=${home}/lazy-packages\n`));
  assert.match(started, /^NOTCH_MODEL=nvidia\/some-model$/m);
  // Hermes reads the key from .env; its own environment holds no copy (NH-26).
  assert.doesNotMatch(started, /API_SERVER_KEY/);
  assert.equal(readFileSync(join(home, ".env"), "utf8"), `API_SERVER_KEY=${HEX64}\n`);
  assert.equal(readFileSync(join(home, "config.yaml"), "utf8"), configText);
  // No profile, no Hermes: a start without HERMES_HOME or without a usable key stops before it.
  writeFileSync(seen, "");
  assert.throws(() => execFileSync("sh", [start], { env: { PATH: env.PATH, API_SERVER_KEY: HEX64 }, stdio: "pipe" }));
  assert.throws(() => execFileSync("sh", [start], { env: { ...env, API_SERVER_KEY: "short" }, stdio: "pipe" }));
  // Nor without a CA bundle: Hermes would start and then fail every turn.
  for (const missing of [join(bin, "no-such-bundle.pem"), "/etc/openshell-tls/ca-bundle.pem"]) {
    const refused = spawnSync("sh", [start], { env: { ...env, NOTCH_CA_BUNDLE: missing }, encoding: "utf8" });
    assert.equal(refused.status, 1, missing);
    assert.match(refused.stderr, /^start-hermes: no CA bundle at /, missing);
  }
  assert.equal(readFileSync(seen, "utf8"), "");
  assert.match(readFileSync(start, "utf8"), /^ca="\$\{NOTCH_CA_BUNDLE:-\/etc\/openshell-tls\/ca-bundle\.pem\}"$/m);
});

test("the Dockerfile makes /opt/notch enterable, patches Hermes twice, links the CA bundle, and checks it all as the sandbox user", () => {
  const dockerfile = readFileSync(repo("deploy/images/hermes-sandbox/Dockerfile"), "utf8").replace(/\r\n/g, "\n");
  const at = (re: RegExp) => {
    const i = dockerfile.search(re);
    assert.ok(i >= 0, String(re));
    return i;
  };
  // The directories first, with their own mode: COPY --chmod gives the ones it
  // creates the files' mode, and nobody but root can enter a 0644 directory.
  assert.ok(at(/^RUN install -d -m 0755 \/opt\/notch \/opt\/notch\/hermes-profile /m) < at(/^COPY /m));
  assert.match(dockerfile, /^COPY --chmod=0644 profile\/SOUL\.md profile\/config\.yaml \/opt\/notch\/hermes-profile\/$/m);
  assert.match(dockerfile, /^COPY --chmod=0755 profile\/install-profile\.sh profile\/start-hermes\.sh \/opt\/notch\/hermes-profile\/$/m);
  assert.match(dockerfile, /^COPY --chmod=0755 patch-hermes-api-key\.py patch-hermes-drain-gate\.py \/opt\/notch\/patches\/$/m);
  assert.match(dockerfile, /^RUN \/opt\/hermes\/\.venv\/bin\/python -I \/opt\/notch\/patches\/patch-hermes-api-key\.py \/opt\/hermes\/gateway\/platforms\/api_server\.py$/m);
  assert.match(dockerfile, /^RUN \/opt\/hermes\/\.venv\/bin\/python -I \/opt\/notch\/patches\/patch-hermes-drain-gate\.py \/opt\/hermes\/gateway\/drain_control\.py$/m);
  // certifi's bundle is NemoClaw's link to /etc/openshell-tls/ca-bundle.pem; ours continues it to the
  // Kubernetes supervisor's bundle, which start-hermes.sh then requires to be there.
  assert.match(dockerfile, /^ && ln -s \/run\/openshell-supervisor-ca\/material\/ca-bundle\.crt \/etc\/openshell-tls\/ca-bundle\.pem$/m);
  // The image ends as the base's user, and the last checks run as it.
  assert.ok(at(/^USER sandbox$/m) < at(/^RUN test /m));
  assert.equal(dockerfile.split("\n").filter((line) => line.startsWith("USER ")).at(-1), "USER sandbox");
  const checks = dockerfile.slice(at(/^RUN test /m));
  for (const check of [
    "grep -q 'X-Hermes-Api-Key' /opt/hermes/gateway/platforms/api_server.py",
    "grep -q 'patch-hermes-drain-gate.py' /opt/hermes/gateway/drain_control.py",
    "= /etc/openshell-tls/ca-bundle.pem",
    'test "$(readlink /etc/openshell-tls/ca-bundle.pem)" = /run/openshell-supervisor-ca/material/ca-bundle.crt',
  ]) {
    assert.ok(checks.includes(check), check);
  }
  // The interpreter the profiles and the policy are loaded with (deploy/README.md): a base image
  // with another one must stop the build, not have every request of Hermes refused on the cluster.
  const binary = /'s\|@HERMES_BINARY@\|([^|]+)\|'/.exec(readFileSync(repo("deploy/README.md"), "utf8"))?.[1];
  assert.equal(binary, "/usr/bin/python3.13");
  assert.ok(checks.includes(`test "$(readlink -f /opt/hermes/.venv/bin/python)" = ${binary}`));
});

test("the relay starts a sandbox with the script the image ships", () => {
  const main = readFileSync(repo("services/relay/src/main.ts"), "utf8");
  assert.match(main, /const DEFAULT_SANDBOX_COMMAND = \["\/opt\/notch\/hermes-profile\/start-hermes\.sh"\];/);
  // Never NemoClaw's wrapper: `hermes gateway` refuses every start on a Kubernetes volume.
  assert.doesNotMatch(main, /hermes gateway run/);
  assert.match(readFileSync(join(profileDir, "start-hermes.sh"), "utf8"), /^exec hermes\.real gateway run$/m);
});

// Hermes v0.21.3's key check (gateway/platforms/api_server.py), cut to what the patch reads.
const CHECK_AUTH = `import hmac
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class APIServerAdapter:
    def _check_auth(self, request: "web.Request") -> Optional["web.Response"]:
        profile = _api_request_profile.get()
        expected_key = self._expected_api_key()
        if not expected_key:
            if not (profile and profile != "default"):
                return None
            return self._auth_failed_response()
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
            if hmac.compare_digest(token.encode(), expected_key.encode()):
                return None
        logger.warning("API server rejected invalid API key: %s", self._request_audit_log_suffix(request))
        return self._auth_failed_response()
`;
const python = ["python3", "python"].find((bin) => spawnSync(bin, ["-c", "import sys; sys.exit(sys.version_info < (3, 9))"]).status === 0);

test("patch-hermes-api-key.py: the key is also taken from X-Hermes-Api-Key, and a Hermes it doesn't recognise stops the build", { skip: !python && "needs Python 3.9+" }, () => {
  const file = join(mkdtempSync(join(tmpdir(), "hermes-patch-")), "api_server.py");
  const run = () => spawnSync(python!, ["-I", repo("deploy/images/hermes-sandbox/patch-hermes-api-key.py"), file], { encoding: "utf8" });
  writeFileSync(file, CHECK_AUTH);
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const patched = readFileSync(file, "utf8");
  // After the bearer check and above the refusal: Authorization keeps working,
  // the header is compared in constant time, and neither means 401 as before.
  assert.match(
    patched,
    /compare_digest\(token\.encode\(\), expected_key\.encode\(\)\):\n +return None\n(?: +#.*\n)+ +notch_key = request\.headers\.get\("X-Hermes-Api-Key", ""\)\.strip\(\)\n +if notch_key and hmac\.compare_digest\(notch_key\.encode\(\), expected_key\.encode\(\)\):\n +return None\n +logger\.warning\("API server rejected invalid API key/,
  );
  assert.equal(patched.replace(/(?: +# Notch patch.*\n +#.*\n +notch_key.*\n +if notch_key.*\n +return None\n)/, ""), CHECK_AUTH, "nothing else changed");
  assert.equal(run().status, 0);
  assert.equal(readFileSync(file, "utf8"), patched, "a second run changes nothing");
  const changedUpstream: Array<[string, string]> = [
    ["the refusal reads differently", CHECK_AUTH.replace("API server rejected invalid API key", "API server said no")],
    ["the bearer token is compared differently", CHECK_AUTH.replace("hmac.compare_digest(token.encode(), expected_key.encode())", "token == expected_key")],
    ["the method is gone", CHECK_AUTH.replace("def _check_auth(", "def _authorize(")],
    ["the header is already handled somewhere else", `${CHECK_AUTH}\nHEADER = "X-Hermes-Api-Key"\n`],
  ];
  for (const [what, source] of changedUpstream) {
    writeFileSync(file, source);
    const result = run();
    assert.equal(result.status, 1, what);
    assert.match(result.stderr, /^patch-hermes-api-key: /, what);
    assert.equal(readFileSync(file, "utf8"), source, `${what}: the file is left as it was`);
  }
});

// gateway/drain_control.py of the Hermes in NemoClaw's image (v0.0.130), cut to what the patch reads.
const DRAIN_CONTROL = `from pathlib import Path
from typing import Optional

_NEMOCLAW_CRON_RESTORE_DRAIN_PATH = Path(
    "/sandbox/.nemoclaw/hermes-cron-restore-drain.json"
)


def operator_drain_requested(*, home: Optional[Path] = None) -> bool:
    return False


def nemoclaw_cron_restore_drain_requested() -> bool:
    """Return whether NemoClaw's restart-stable rebuild marker is present.

    Any unsafe metadata or lookup error fails toward keeping dispatch drained.
    """
    import os
    import stat

    state_root = _NEMOCLAW_CRON_RESTORE_DRAIN_PATH.parent
    flags = os.O_RDONLY | os.O_CLOEXEC | os.O_DIRECTORY | os.O_NOFOLLOW
    try:
        state_root_fd = os.open(state_root, flags)
    except OSError:
        return True
    try:
        metadata = os.fstat(state_root_fd)
        if (
            not stat.S_ISDIR(metadata.st_mode)
            or metadata.st_uid != 0
            or metadata.st_gid != 0
            or stat.S_IMODE(metadata.st_mode) & 0o022
        ):
            return True
        try:
            os.stat(_NEMOCLAW_CRON_RESTORE_DRAIN_PATH.name, dir_fd=state_root_fd, follow_symlinks=False)
        except FileNotFoundError:
            return False
        except OSError:
            return True
        return True
    except OSError:
        return True
    finally:
        try:
            os.close(state_root_fd)
        except OSError:
            pass


def drain_requested(*, home: Optional[Path] = None) -> bool:
    """Return whether either operator or NemoClaw drain is active."""
    return (
        nemoclaw_cron_restore_drain_requested()
        or operator_drain_requested(home=home)
    )
`;

test("patch-hermes-drain-gate.py: NemoClaw's cron-restore gate is off, Hermes' own drain marker still counts, and a gate it doesn't recognise stops the build", { skip: !python && "needs Python 3.9+" }, () => {
  const file = join(mkdtempSync(join(tmpdir(), "hermes-patch-")), "drain_control.py");
  const run = () => spawnSync(python!, ["-I", repo("deploy/images/hermes-sandbox/patch-hermes-drain-gate.py"), file], { encoding: "utf8" });
  const draining = () => spawnSync(python!, ["-I", "-c", "import runpy, sys; print(runpy.run_path(sys.argv[1])['drain_requested']())", file], { encoding: "utf8" }).stdout.trim();
  writeFileSync(file, DRAIN_CONTROL);
  // What the cluster showed: with no root-owned /sandbox/.nemoclaw the gate says "drain" for ever.
  if (process.platform !== "win32") assert.equal(draining(), "True");
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const patched = readFileSync(file, "utf8");
  // Right after the docstring, before the function looks at the filesystem.
  assert.match(patched, /fails toward keeping dispatch drained\.\n {4}"""\n {4}# Notch patch \(deploy\/images\/hermes-sandbox\/patch-hermes-drain-gate\.py\).*\n(?: {4}#.*\n)+ {4}return False\n {4}import os\n/);
  assert.equal(patched.replace(/ {4}# Notch patch.*\n(?: {4}#.*\n)+ {4}return False\n/, ""), DRAIN_CONTROL, "nothing else changed");
  assert.equal(draining(), "False");
  assert.equal(run().status, 0);
  assert.equal(readFileSync(file, "utf8"), patched, "a second run changes nothing");
  const changedUpstream: Array<[string, string]> = [
    ["the gate is gone", DRAIN_CONTROL.replace("def nemoclaw_cron_restore_drain_requested(", "def nemoclaw_drain_requested(")],
    ["the gate no longer checks who owns the directory", DRAIN_CONTROL.replace("metadata.st_uid != 0", "metadata.st_uid == 0")],
    ["drain_requested() no longer asks the gate", DRAIN_CONTROL.replace("        nemoclaw_cron_restore_drain_requested()\n        or ", "        ")],
    ["the patch marker is somewhere else already", `${DRAIN_CONTROL}\n# Notch patch (deploy/images/hermes-sandbox/patch-hermes-drain-gate.py)\n`],
  ];
  for (const [what, source] of changedUpstream) {
    writeFileSync(file, source);
    const result = run();
    assert.equal(result.status, 1, what);
    assert.match(result.stderr, /^patch-hermes-drain-gate: /, what);
    assert.equal(readFileSync(file, "utf8"), source, `${what}: the file is left as it was`);
  }
});
