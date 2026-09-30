import { chmod, copyFile, mkdir, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import https from "node:https";
import { join } from "node:path";
import type { Exec } from "./openshell-cli.js";

/**
 * How the relay reaches its environment's OpenShell gateway (NH-29).
 *
 * On Kubernetes the gateway serves TLS and requires a client certificate: the
 * chart's `openshell-client-tls` bundle, mounted read-only into the relay.
 * User calls carry no OIDC token (`server.auth.allowUnauthenticatedUsers`,
 * deploy/platform/openshell/values.yaml): only pods in the environment's own
 * namespace can reach the gateway (NetworkPolicy), and nothing outside the
 * VPS can (D-27).
 *
 * Two uses:
 * - the openshell CLI: registerGateway() puts the bundle where the CLI looks
 *   for it and registers the gateway once, at startup;
 * - a sandbox's exposed Hermes port: `openshell service get` returns an HTTPS
 *   URL on a service hostname (`<sandbox>.openshell.localhost`, covered by the
 *   gateway certificate's `*.openshell.localhost`) that cluster DNS doesn't
 *   know. gatewayFetch() connects to the gateway's own address instead, keeps
 *   the service hostname for SNI and Host — the gateway routes on it — and
 *   presents the client certificate.
 *
 * The URL format and the CLI's `gateway add --local` behaviour are the spike's
 * to confirm; this is the shape the docs and the chart describe.
 */

export interface GatewayRoute {
  /** The gateway's in-cluster address, e.g. openshell.notch-dev.svc. */
  host: string;
  port: number;
  ca: string;
  cert: string;
  key: string;
}

export interface GatewayConfig {
  /** The CLI's name for the gateway (OPENSHELL_GATEWAY). */
  name: string;
  /** e.g. https://openshell.notch-dev.svc:8080 */
  endpoint: string;
  /** Where the client bundle is mounted: ca.crt, tls.crt, tls.key. */
  tlsDir: string;
  route: GatewayRoute;
}

const BUNDLE = ["ca.crt", "tls.crt", "tls.key"] as const;

/**
 * OPENSHELL_GATEWAY_ENDPOINT, OPENSHELL_TLS_DIR (/etc/openshell-tls) and
 * OPENSHELL_GATEWAY_NAME (notch). Unset endpoint: no gateway (static sandboxes
 * reached over plain HTTP).
 */
export function gatewayConfigFromEnv(env: NodeJS.ProcessEnv, read: (path: string) => string = (p) => readFileSync(p, "utf8")): GatewayConfig | undefined {
  const endpoint = env.OPENSHELL_GATEWAY_ENDPOINT?.trim().replace(/\/+$/, "");
  if (!endpoint) return undefined;
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new Error("OPENSHELL_GATEWAY_ENDPOINT must be an https URL");
  const tlsDir = env.OPENSHELL_TLS_DIR?.trim() || "/etc/openshell-tls";
  const files: Record<string, string> = {};
  for (const f of BUNDLE) {
    try {
      files[f] = read(join(tlsDir, f));
    } catch {
      throw new Error(`the gateway's client bundle is incomplete: no ${join(tlsDir, f)} (is the openshell-client-tls Secret mounted?)`);
    }
  }
  return {
    name: env.OPENSHELL_GATEWAY_NAME?.trim() || "notch",
    endpoint,
    tlsDir,
    route: { host: url.hostname, port: Number(url.port || 443), ca: files["ca.crt"], cert: files["tls.crt"], key: files["tls.key"] },
  };
}

/**
 * Puts the client bundle where the CLI reads it
 * (<configDir>/gateways/<name>/mtls/) and registers the gateway the first
 * time. The caller sets OPENSHELL_GATEWAY=<name> so every command uses it.
 * Returns the first line of `openshell status`, for the log.
 */
export async function registerGateway(config: GatewayConfig, configDir: string, exec: Exec): Promise<string> {
  const dir = join(configDir, "gateways", config.name);
  const mtls = join(dir, "mtls");
  await mkdir(mtls, { recursive: true, mode: 0o700 });
  for (const f of BUNDLE) {
    await copyFile(join(config.tlsDir, f), join(mtls, f));
    await chmod(join(mtls, f), 0o600);
  }
  const registered = await stat(join(dir, "metadata.json")).then(
    () => true,
    () => false,
  );
  if (!registered) await exec(["gateway", "add", config.endpoint, "--local", "--name", config.name]);
  // An unreachable gateway isn't a registration failure: it may still be starting.
  const status = await exec(["status"], { env: { OPENSHELL_GATEWAY: config.name } }).catch((e: unknown) => ({
    stdout: `status failed: ${e instanceof Error ? e.message : String(e)}`,
  }));
  return status.stdout.trim().split("\n")[0] ?? "";
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...(headers as Record<string, string>) };
}

/**
 * A fetch that sends HTTPS requests to the gateway's own address, with the
 * URL's hostname as SNI and Host, and the client certificate. Other URLs go
 * to the ordinary fetch.
 */
export function gatewayFetch(route: GatewayRoute, fallback: typeof fetch = globalThis.fetch): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== "https:") return fallback(input, init);
    const body = init?.body == null ? undefined : typeof init.body === "string" ? init.body : Buffer.from(await new Response(init.body).arrayBuffer());
    return new Promise<Response>((resolve, reject) => {
      const req = https.request(
        {
          host: route.host,
          port: route.port,
          servername: url.hostname,
          method: init?.method ?? "GET",
          path: `${url.pathname}${url.search}`,
          headers: { ...headerRecord(init?.headers), host: url.host },
          ca: route.ca,
          cert: route.cert,
          key: route.key,
          signal: init?.signal ?? undefined,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("error", reject);
          res.on("end", () => {
            const headers = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
              if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
            }
            const status = res.statusCode ?? 502;
            resolve(new Response(status === 204 || status === 304 ? null : Buffer.concat(chunks), { status, headers }));
          });
        },
      );
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }) as typeof fetch;
}
