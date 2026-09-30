/**
 * NH-25's measurements, run inside a relay pod, which reaches the sandboxes
 * and carries the openshell CLI:
 *
 *   kubectl -n notch-dev exec deploy/notch-relay -- node --import tsx src/bench.ts <mode> <target> [options]
 *
 * Modes:
 *   turns        a scripted conversation of 9 messages and a check-in: latency
 *                p50/p95, tokens and cost per turn and per 10 turns
 *   cold-start   stop the sandbox, start it, and time it until it's ready and
 *                until its first reply (--runs, default 3)
 *   soak         one turn every --every seconds (60) for --minutes (180), one
 *                line per turn; sample the sandbox's memory on the host meanwhile
 *                (the NH-25 note in the plan)
 *
 * Target, one of:
 *   --sandbox <name>   URL from `openshell service get`; key from BENCH_API_KEY,
 *                      else derived from SANDBOX_KEY_SECRET like the relay does
 *   --user <id>        that user's sandbox as the relay names it
 *                      (notch-<RELAY_ENV>-…), or their RELAY_STATIC_SANDBOXES entry
 *   --base-url <url>   any Hermes API server, key in BENCH_API_KEY (not for cold-start)
 *
 * The messages use the relay's own prompt (the context block, facts, history),
 * so the token counts are a real turn's. Write tools run for real: use a team
 * test account in dev — the script changes one exercise and undoes it.
 * Prices in USD per 1M tokens default to Nemotron 3 Super's (plan §7):
 * --price-in 0.30 --price-out 0.90.
 *
 * Prints Markdown for NH-25 with the O-04 thresholds checked: p95 ≤ 15 s,
 * cold start ≤ 60 s, ≤ $0.05 per 10 turns. On a sandbox the relay manages, set
 * SANDBOX_IDLE_MINUTES above the run's length first, or its idle sweep stops
 * the sandbox mid-run.
 */
import { pathToFileURL } from "node:url";
import { chat as hermesChat, type ChatResult, type SandboxEndpoint } from "./hermes.js";
import { OpenShellCli, execOpenShell } from "./openshell-cli.js";
import type { JobContext } from "./outbox.js";
import { buildMessages } from "./prompt.js";
import { sandboxApiKey, sandboxName } from "./sandbox-manager.js";
import { staticSandboxes } from "./sandboxes.js";

export const THRESHOLDS = { p95Ms: 15_000, coldStartMs: 60_000, usdPer10Turns: 0.05 };
const HERMES_PORT = 8642;
const TURN_TIMEOUT_MS = 180_000;
const HISTORY_LIMIT = 20;

/** A conversation that exercises every toolset: history, plan change and undo, a note, web search. */
export const SCRIPT: Array<{ kind: "chat" | "checkin"; text: string }> = [
  { kind: "chat", text: "Hey! I only have about 40 minutes on Thursday. What should I focus on?" },
  { kind: "chat", text: "What was my best bench press set in the last two weeks?" },
  { kind: "chat", text: "Should I add weight next session or stay where I am?" },
  { kind: "chat", text: "Change my bench press to 4 sets of 6 for this week." },
  { kind: "chat", text: "Actually, undo that." },
  { kind: "chat", text: "Which vegetarian foods have about 30 g of protein per serving?" },
  { kind: "chat", text: "My lower back felt tight after deadlifts. Anything I should change?" },
  { kind: "chat", text: "Save a note for my next workout: one extra warm-up set before deadlifts." },
  { kind: "chat", text: "Thanks! What's on the plan for my next workout?" },
  { kind: "checkin", text: "" },
];

// Plausible facts and settings, so the context block is a real one's size.
const FACTS: JobContext["facts"] = [
  { text: "Left knee hurts on deep squats", category: "health", pinned: true },
  { text: "Trains Mondays and Thursdays, about an hour", category: "schedule", pinned: false },
  { text: "Goal: bench press 100 kg by spring", category: "goal", pinned: false },
  { text: "Trains in a home gym with a rack and dumbbells up to 30 kg", category: "equipment", pinned: false },
  { text: "Prefers short answers", category: "preference", pinned: false },
];

export interface Turn {
  index: number;
  kind: "chat" | "checkin";
  text: string;
  ms: number;
  ok: boolean;
  error?: string;
  tokensIn?: number;
  tokensOut?: number;
  reply?: string;
}

export interface BenchDeps {
  chat: (endpoint: SandboxEndpoint, job: JobContext, sessionKey: string) => Promise<ChatResult>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export function jobFor(userId: string, kind: "chat" | "checkin", text: string, history: JobContext["history"], at: Date): JobContext {
  return {
    id: 0,
    lease_token: "bench",
    leased_until: at.toISOString(),
    job: { id: 0, kind, environment: "dev", user_id: userId, attempts: 1 },
    message: kind === "chat" ? { id: "bench", text, created_at: at.toISOString() } : null,
    history,
    facts: FACTS,
    user: { language: "en", units: "metric", coach_name: "Coach", tone: "friendly_casual", accountability: "gentle", persona: null },
    agent: null,
  };
}

/** Nearest-rank percentile; undefined for no values. */
export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function costUsd(turn: Pick<Turn, "tokensIn" | "tokensOut">, prices: { in: number; out: number }): number | undefined {
  if (turn.tokensIn === undefined || turn.tokensOut === undefined) return undefined;
  return (turn.tokensIn * prices.in + turn.tokensOut * prices.out) / 1_000_000;
}

async function oneTurn(deps: BenchDeps, endpoint: SandboxEndpoint, userId: string, sessionKey: string, index: number, step: (typeof SCRIPT)[number], history: JobContext["history"]): Promise<Turn> {
  const started = deps.now();
  try {
    const result = await deps.chat(endpoint, jobFor(userId, step.kind, step.text, history, new Date(started)), sessionKey);
    return { index, kind: step.kind, text: step.text, ms: deps.now() - started, ok: true, tokensIn: result.usage?.tokensInput, tokensOut: result.usage?.tokensOutput, reply: result.text };
  } catch (e) {
    return { index, kind: step.kind, text: step.text, ms: deps.now() - started, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The scripted conversation, each chat turn seeing the ones before it as history. */
export async function runTurns(deps: BenchDeps, endpoint: SandboxEndpoint, userId: string, sessionKey: string): Promise<Turn[]> {
  const history: JobContext["history"] = [];
  const turns: Turn[] = [];
  for (const [i, step] of SCRIPT.entries()) {
    const turn = await oneTurn(deps, endpoint, userId, sessionKey, i + 1, step, history.slice(-HISTORY_LIMIT));
    turns.push(turn);
    if (step.kind === "chat") {
      const at = new Date(deps.now()).toISOString();
      history.push({ role: "user", text: step.text, created_at: at });
      if (turn.reply) history.push({ role: "assistant", text: turn.reply, created_at: at });
    }
  }
  return turns;
}

export interface ColdStart {
  run: number;
  stopMs: number;
  readyMs: number;
  firstReplyMs: number;
  ok: boolean;
  error?: string;
}

export interface ColdStartDriver {
  stop(name: string): Promise<void>;
  start(name: string): Promise<void>;
  serviceUrl(name: string, port: number): Promise<string>;
}

/**
 * Stop, then start and time until the CLI reports it ready, then until
 * Hermes answers — its API server comes up after the sandbox does, so a
 * refused connection is retried for up to two minutes.
 */
export async function runColdStart(deps: BenchDeps, driver: ColdStartDriver, name: string, apiKey: string, userId: string, runs: number): Promise<ColdStart[]> {
  const out: ColdStart[] = [];
  for (let run = 1; run <= runs; run++) {
    const t0 = deps.now();
    try {
      await driver.stop(name);
      const t1 = deps.now();
      await driver.start(name);
      const t2 = deps.now();
      const endpoint = { baseUrl: await driver.serviceUrl(name, HERMES_PORT), apiKey };
      let lastError = "";
      let answered = false;
      while (deps.now() - t2 < 120_000) {
        const turn = await oneTurn(deps, endpoint, userId, `bench-cold-${run}`, 1, SCRIPT[0], []);
        if (turn.ok) {
          answered = true;
          break;
        }
        lastError = turn.error ?? "";
        if (!/unreachable/.test(lastError)) break;
        await deps.sleep(2_000);
      }
      const t3 = deps.now();
      out.push({ run, stopMs: t1 - t0, readyMs: t2 - t1, firstReplyMs: t3 - t2, ok: answered, ...(answered ? {} : { error: lastError }) });
    } catch (e) {
      out.push({ run, stopMs: 0, readyMs: 0, firstReplyMs: 0, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

const s = (ms: number | undefined) => (ms === undefined ? "–" : `${(ms / 1000).toFixed(1)} s`);
const mark = (ok: boolean) => (ok ? "✅" : "❌");
const cellText = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 60);

/** The turns' table and summary; a soak's hundreds of turns get the summary only. */
export function renderTurns(turns: Turn[], prices: { in: number; out: number }, label: string, { table = true } = {}): string {
  const okTurns = turns.filter((t) => t.ok);
  const p50 = percentile(okTurns.map((t) => t.ms), 50);
  const p95 = percentile(okTurns.map((t) => t.ms), 95);
  const costs = turns.map((t) => costUsd(t, prices));
  const known = costs.filter((c): c is number => c !== undefined);
  const total = known.reduce((a, c) => a + c, 0);
  // Scaled to 10 turns, from the turns whose usage is known.
  const per10 = known.length ? (total / known.length) * 10 : undefined;
  const rows = turns.map((t, i) => {
    const c = costs[i];
    const tokens = t.tokensIn === undefined ? "?" : `${t.tokensIn} → ${t.tokensOut}`;
    const result = t.ok ? `✅ ${cellText(t.reply ?? "")}` : `❌ ${cellText(t.error ?? "")}`;
    return `| ${t.index} | ${t.kind === "checkin" ? "(daily check-in)" : cellText(t.text)} | ${s(t.ms)} | ${tokens} | ${c === undefined ? "?" : `$${c.toFixed(4)}`} | ${result} |`;
  });
  const lines = [
    `### Hermes turns — ${label}`,
    "",
    ...(table ? ["| # | Message | Latency | Tokens in → out | Cost | Result |", "|---|---|---|---|---|---|", ...rows, ""] : []),
    `- **p50 ${s(p50)}, p95 ${s(p95)}** — p95 ≤ ${THRESHOLDS.p95Ms / 1000} s: ${p95 === undefined ? "❌ no reply" : mark(p95 <= THRESHOLDS.p95Ms)}`,
    `- **Per 10 turns: ${per10 === undefined ? "unknown (no usage reported)" : `$${per10.toFixed(4)}`}** at $${prices.in} / $${prices.out} per 1M tokens — ≤ $${THRESHOLDS.usdPer10Turns}: ${per10 === undefined ? "❌" : mark(per10 <= THRESHOLDS.usdPer10Turns)}`,
    `- **Failed or empty replies: ${turns.length - okTurns.length} of ${turns.length}**`,
  ];
  const missing = turns.filter((t) => t.ok && t.tokensIn === undefined).length;
  if (missing) lines.push(`- ${missing} reply(s) came without usage: Hermes didn't report tokens for them, so the D-34 accounting would fall back to its estimate.`);
  return lines.join("\n");
}

export function renderColdStarts(runs: ColdStart[], label: string): string {
  const worst = Math.max(...runs.filter((r) => r.ok).map((r) => r.readyMs + r.firstReplyMs), 0);
  const allOk = runs.length > 0 && runs.every((r) => r.ok);
  return [
    `### Cold start — ${label}`,
    "",
    "| Run | Stop | Start → ready | Ready → first reply | Start → first reply |",
    "|---|---|---|---|---|",
    ...runs.map((r) =>
      r.ok
        ? `| ${r.run} | ${s(r.stopMs)} | ${s(r.readyMs)} | ${s(r.firstReplyMs)} | **${s(r.readyMs + r.firstReplyMs)}** |`
        : `| ${r.run} | ❌ ${cellText(r.error ?? "")} | | | |`,
    ),
    "",
    `- **Worst ${s(worst)}** — ≤ ${THRESHOLDS.coldStartMs / 1000} s: ${allOk ? mark(worst <= THRESHOLDS.coldStartMs) : "❌ a run failed"}`,
  ].join("\n");
}

export interface Args {
  mode: "turns" | "cold-start" | "soak";
  sandbox?: string;
  user?: string;
  baseUrl?: string;
  runs: number;
  minutes: number;
  every: number;
  prices: { in: number; out: number };
}

export function parseArgs(argv: string[]): Args {
  const [mode, ...rest] = argv;
  if (mode !== "turns" && mode !== "cold-start" && mode !== "soak") throw new Error("usage: bench.ts turns|cold-start|soak --sandbox <name> | --user <id> | --base-url <url> [options]");
  const args: Args = { mode, runs: 3, minutes: 180, every: 60, prices: { in: 0.3, out: 0.9 } };
  const num = (flag: string, v: string | undefined) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} needs a positive number`);
    return n;
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[i + 1];
    i++;
    if (flag === "--sandbox" && value) args.sandbox = value;
    else if (flag === "--user" && value) args.user = value;
    else if (flag === "--base-url" && value) args.baseUrl = value.replace(/\/+$/, "");
    else if (flag === "--runs") args.runs = num(flag, value);
    else if (flag === "--minutes") args.minutes = num(flag, value);
    else if (flag === "--every") args.every = num(flag, value);
    else if (flag === "--price-in") args.prices.in = num(flag, value);
    else if (flag === "--price-out") args.prices.out = num(flag, value);
    else throw new Error(`unknown or incomplete option ${flag}`);
  }
  if ([args.sandbox, args.user, args.baseUrl].filter(Boolean).length !== 1) throw new Error("give exactly one of --sandbox, --user, --base-url");
  if (mode === "cold-start" && args.baseUrl) throw new Error("cold-start needs a sandbox: --sandbox or --user");
  return args;
}

export interface Target {
  /** Set when the sandbox is known by name (cold start needs it). */
  name?: string;
  apiKey: string;
  endpoint: () => Promise<SandboxEndpoint>;
  userId: string;
}

/** Where to send turns, resolved the way the relay itself would. Also used by agent-probe.ts. */
export function resolveTarget(args: Pick<Args, "sandbox" | "user" | "baseUrl">, env: NodeJS.ProcessEnv, serviceUrl: (name: string, port: number) => Promise<string>): Target {
  const userId = args.user ?? "bench";
  if (args.baseUrl) {
    const apiKey = env.BENCH_API_KEY?.trim();
    if (!apiKey) throw new Error("--base-url needs BENCH_API_KEY");
    const endpoint = { baseUrl: args.baseUrl, apiKey };
    return { apiKey, endpoint: async () => endpoint, userId };
  }
  if (args.user && (env.RELAY_SANDBOXES?.trim() || "static") === "static") {
    const endpoint = staticSandboxes(env.RELAY_STATIC_SANDBOXES).get(args.user);
    if (!endpoint) throw new Error(`no RELAY_STATIC_SANDBOXES entry for ${args.user}`);
    return { apiKey: endpoint.apiKey, endpoint: async () => endpoint, userId };
  }
  const relayEnv = env.RELAY_ENV;
  if (args.user && relayEnv !== "dev" && relayEnv !== "prod") throw new Error("--user needs RELAY_ENV dev or prod");
  const name = args.sandbox ?? sandboxName(relayEnv as "dev" | "prod", userId);
  const secret = env.SANDBOX_KEY_SECRET ?? "";
  const apiKey = env.BENCH_API_KEY?.trim() || (secret.length >= 32 ? sandboxApiKey(secret, name) : "");
  if (!apiKey) throw new Error("no key: set BENCH_API_KEY, or SANDBOX_KEY_SECRET for a sandbox the relay created");
  return { name, apiKey, endpoint: async () => ({ baseUrl: await serviceUrl(name, HERMES_PORT), apiKey }), userId };
}

async function cli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const openshell = new OpenShellCli(execOpenShell(process.env.OPENSHELL_BIN || "openshell"));
  const target = resolveTarget(args, process.env, (name, port) => openshell.serviceUrl(name, port));
  const deps: BenchDeps = {
    chat: (endpoint, job, sessionKey) => hermesChat(endpoint, buildMessages(job, new Date()), { sessionKey, timeoutMs: TURN_TIMEOUT_MS }),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
  const label = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC, ${target.name ?? args.baseUrl ?? args.user}`;
  const sessionKey = `bench-${target.userId}`;

  if (args.mode === "turns") {
    console.log(renderTurns(await runTurns(deps, await target.endpoint(), target.userId, sessionKey), args.prices, label));
  } else if (args.mode === "cold-start") {
    console.log(renderColdStarts(await runColdStart(deps, openshell, target.name!, target.apiKey, target.userId, args.runs), label));
  } else {
    const endpoint = await target.endpoint();
    const end = deps.now() + args.minutes * 60_000;
    const turns: Turn[] = [];
    const chats = SCRIPT.filter((step) => step.kind === "chat");
    for (let i = 0; deps.now() < end; i++) {
      const turn = await oneTurn(deps, endpoint, target.userId, sessionKey, i + 1, chats[i % chats.length], []);
      turns.push(turn);
      console.log(`${new Date().toISOString()}\t${turn.index}\t${turn.ok ? "ok" : "FAILED"}\t${turn.ms} ms\t${turn.tokensIn ?? "?"}→${turn.tokensOut ?? "?"}${turn.error ? `\t${turn.error}` : ""}`);
      await deps.sleep(Math.max(0, args.every * 1000 - turn.ms));
    }
    console.log("\n" + renderTurns(turns, args.prices, `soak, ${label}, ${args.minutes} min`, { table: false }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli(process.argv.slice(2)).catch((e) => {
    console.error(`error: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  });
}
