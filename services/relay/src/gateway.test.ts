import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import { gatewayConfigFromEnv, gatewayFetch, registerGateway } from "./gateway.js";
import type { Exec } from "./openshell-cli.js";

const hasOpenssl = (() => {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** A CA, a gateway certificate for *.openshell.localhost, and the relay's client certificate. */
function makePki(): Record<"ca" | "serverCert" | "serverKey" | "clientCert" | "clientKey" | "otherCert" | "otherKey", string> {
  const d = mkdtempSync(join(tmpdir(), "gateway-pki-"));
  const p = (f: string) => join(d, f);
  const openssl = (...args: string[]) => execFileSync("openssl", args, { stdio: "pipe" });
  const key = (f: string) => openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", p(`${f}.key`), "-out", p(`${f}.self`), "-days", "1", "-subj", `/CN=${f}`);
  key("ca");
  writeFileSync(p("server.ext"), "subjectAltName=DNS:*.openshell.localhost,DNS:openshell.notch-dev.svc\n");
  writeFileSync(p("client.ext"), "extendedKeyUsage=clientAuth\n");
  for (const [name, ext] of [["server", "server.ext"], ["client", "client.ext"]] as const) {
    openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", p(`${name}.key`), "-out", p(`${name}.csr`), "-subj", `/CN=${name === "client" ? "notch-relay" : "openshell"}`);
    openssl("x509", "-req", "-in", p(`${name}.csr`), "-CA", p("ca.self"), "-CAkey", p("ca.key"), "-CAcreateserial", "-out", p(`${name}.crt`), "-days", "1", "-extfile", p(ext));
  }
  // A client certificate from a CA the gateway doesn't trust.
  key("other");
  const r = (f: string) => readFileSync(p(f), "utf8");
  return { ca: r("ca.self"), serverCert: r("server.crt"), serverKey: r("server.key"), clientCert: r("client.crt"), clientKey: r("client.key"), otherCert: r("other.self"), otherKey: r("other.key") };
}

test("gatewayConfigFromEnv: off without an endpoint; the bundle and the address when set", () => {
  assert.equal(gatewayConfigFromEnv({}), undefined);
  const files: Record<string, string> = { "/tls/ca.crt": "CA", "/tls/tls.crt": "CERT", "/tls/tls.key": "KEY" };
  const read = (path: string) => {
    const v = files[path.replace(/\\/g, "/")];
    if (v === undefined) throw new Error("ENOENT");
    return v;
  };
  const c = gatewayConfigFromEnv({ OPENSHELL_GATEWAY_ENDPOINT: "https://openshell.notch-dev.svc:8080/", OPENSHELL_TLS_DIR: "/tls" }, read)!;
  assert.equal(c.name, "notch");
  assert.equal(c.endpoint, "https://openshell.notch-dev.svc:8080");
  assert.deepEqual(c.route, { host: "openshell.notch-dev.svc", port: 8080, ca: "CA", cert: "CERT", key: "KEY" });
  assert.throws(() => gatewayConfigFromEnv({ OPENSHELL_GATEWAY_ENDPOINT: "http://openshell:8080" }, read), /https/);
  delete files["/tls/tls.key"];
  assert.throws(() => gatewayConfigFromEnv({ OPENSHELL_GATEWAY_ENDPOINT: "https://g:8080", OPENSHELL_TLS_DIR: "/tls" }, read), /tls\.key/);
});

test("registerGateway: bundle copied owner-only, gateway added once, status reported", async () => {
  const tlsDir = mkdtempSync(join(tmpdir(), "tls-"));
  for (const f of ["ca.crt", "tls.crt", "tls.key"]) writeFileSync(join(tlsDir, f), f);
  const configDir = mkdtempSync(join(tmpdir(), "openshell-config-"));
  const calls: Array<{ args: string[]; env?: Record<string, string> }> = [];
  const exec: Exec = async (args, options) => {
    calls.push({ args, env: options?.env });
    if (args[0] === "gateway") writeFileSync(join(configDir, "gateways", "notch", "metadata.json"), "{}");
    return { stdout: "Gateway: notch\nStatus: Connected\n", stderr: "" };
  };
  const config = { name: "notch", endpoint: "https://openshell.notch-dev.svc:8080", tlsDir, route: { host: "h", port: 1, ca: "", cert: "", key: "" } };

  assert.equal(await registerGateway(config, configDir, exec), "Gateway: notch");
  const mtls = join(configDir, "gateways", "notch", "mtls");
  assert.equal(readFileSync(join(mtls, "tls.key"), "utf8"), "tls.key");
  if (process.platform !== "win32") assert.equal(statSync(join(mtls, "tls.key")).mode & 0o777, 0o600);
  assert.deepEqual(calls.map((c) => c.args), [["gateway", "add", "https://openshell.notch-dev.svc:8080", "--local", "--name", "notch"], ["status"]]);
  assert.equal(calls[1].env?.OPENSHELL_GATEWAY, "notch");

  await registerGateway(config, configDir, exec);
  assert.equal(calls.filter((c) => c.args[0] === "gateway").length, 1, "registered once");

  // A gateway that's still starting is reported, not fatal.
  const down: Exec = async (args) => {
    if (args[0] === "status") throw new Error("openshell status failed: connection refused");
    return { stdout: "", stderr: "" };
  };
  assert.equal(await registerGateway(config, configDir, down), "status failed: openshell status failed: connection refused");
});

test("gatewayFetch: to the gateway's address, the service hostname as SNI and Host, with the client certificate", { skip: !hasOpenssl && "needs openssl" }, async (t) => {
  const pki = makePki();
  const seen: Array<{ host?: string; sni?: string | false | null; client?: string | string[]; body: string; path?: string }> = [];
  const server = https.createServer({ key: pki.serverKey, cert: pki.serverCert, ca: pki.ca, requestCert: true, rejectUnauthorized: true }, (req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const socket = req.socket as TLSSocket;
      seen.push({ host: req.headers.host, sni: socket.servername, client: socket.getPeerCertificate().subject?.CN, body, path: req.url });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "hi" } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  const route = { host: "127.0.0.1", port, ca: pki.ca, cert: pki.clientCert, key: pki.clientKey };

  const res = await gatewayFetch(route)("https://notch-dev-abc.openshell.localhost:8080/v1/chat/completions?x=1", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer k" },
    body: JSON.stringify({ q: 1 }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { choices: [{ message: { content: "hi" } }] });
  assert.deepEqual(seen[0], {
    host: "notch-dev-abc.openshell.localhost:8080",
    sni: "notch-dev-abc.openshell.localhost",
    client: "notch-relay",
    body: '{"q":1}',
    path: "/v1/chat/completions?x=1",
  });

  // A certificate the gateway doesn't trust never gets through.
  const stranger = { ...route, cert: pki.otherCert, key: pki.otherKey };
  await assert.rejects(gatewayFetch(stranger)("https://notch-dev-abc.openshell.localhost:8080/v1/models"));
  // And the relay checks the gateway: a hostname its certificate doesn't cover fails.
  await assert.rejects(gatewayFetch(route)("https://sandbox.elsewhere.example:8080/v1/models"), /altnames|Hostname|certificate/i);
});

test("gatewayFetch: plain http goes to the ordinary fetch", async (t) => {
  const server = http.createServer((_req, res) => res.end("plain"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  const res = await gatewayFetch({ host: "unused", port: 1, ca: "", cert: "", key: "" })(`http://127.0.0.1:${port}/`);
  assert.equal(await res.text(), "plain");
});
