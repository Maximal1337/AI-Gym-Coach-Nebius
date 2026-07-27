import { createServer, type IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { agentDisabled } from "./config.js";
import { runCoachingTurn } from "./graph.js";
import { runConversationTurn } from "./converse.js";
import { turnInputSchema, conversationTurnInputSchema } from "./schema.js";
import { parsePlanText, parseSummaryText } from "./parse.js";

const parsePlanInput = z.object({ text: z.string().min(10).max(20000) });
const parseSummaryInput = z.object({
  text: z.string().min(10).max(20000),
  knownExercises: z.array(z.string().max(200)).max(100).default([]),
});

const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY_BYTES = 64 * 1024;

type Json = (status: number, body: unknown) => void;

function secretMatches(header: string | string[] | undefined): boolean {
  const secret = process.env.AGENT_SHARED_SECRET;
  // Fail closed: an undeployed/misconfigured secret means nobody gets in,
  // not everybody. Local dev opts out explicitly, never by accident.
  if (!secret) return process.env.AGENT_DEV_NO_AUTH === "1";
  if (typeof header !== "string") return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Every POST route shares this gate: kill switch, then the service-to-service secret. */
function checkAuth(req: IncomingMessage, json: Json): boolean {
  if (agentDisabled()) {
    json(503, { error: "agent_disabled" });
    return false;
  }
  if (!secretMatches(req.headers["x-agent-secret"])) {
    json(401, { error: "unauthorized" });
    return false;
  }
  return true;
}

/** Reads the body up to MAX_BODY_BYTES; null means the cap was exceeded. */
async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Minimal HTTP surface for the agent service.
 * Only Supabase Edge Functions call this (service-to-service secret);
 * end users never reach it directly.
 */
const server = createServer(async (req, res) => {
  const json: Json = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET" && req.url === "/healthz") {
    json(200, { ok: true, disabled: agentDisabled() });
    return;
  }

  if (req.method === "POST" && req.url === "/turn") {
    if (!checkAuth(req, json)) return;
    try {
      const body = await readBody(req);
      if (!body) {
        json(413, { error: "body_too_large" });
        return;
      }
      const parsed = turnInputSchema.safeParse(JSON.parse(body.toString()));
      if (!parsed.success) {
        json(400, { error: "invalid_input" });
        return;
      }
      json(200, await runCoachingTurn(parsed.data));
    } catch {
      json(400, { error: "bad_request" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/converse") {
    if (!checkAuth(req, json)) return;
    try {
      const body = await readBody(req);
      if (!body) {
        json(413, { error: "body_too_large" });
        return;
      }
      const parsed = conversationTurnInputSchema.safeParse(JSON.parse(body.toString()));
      if (!parsed.success) {
        json(400, { error: "invalid_input" });
        return;
      }
      json(200, await runConversationTurn(parsed.data));
    } catch {
      json(400, { error: "bad_request" });
    }
    return;
  }

  if (req.method === "POST" && (req.url === "/parse-plan" || req.url === "/parse-summary")) {
    if (!checkAuth(req, json)) return;
    try {
      const rawBody = await readBody(req);
      if (!rawBody) {
        json(413, { error: "body_too_large" });
        return;
      }
      const body = JSON.parse(rawBody.toString());
      if (req.url === "/parse-plan") {
        const parsed = parsePlanInput.safeParse(body);
        if (!parsed.success) {
          json(400, { error: "invalid_input" });
          return;
        }
        const result = await parsePlanText(parsed.data.text);
        if (!result) {
          json(503, { error: "llm_not_configured" });
          return;
        }
        json(200, result);
      } else {
        const parsed = parseSummaryInput.safeParse(body);
        if (!parsed.success) {
          json(400, { error: "invalid_input" });
          return;
        }
        const result = await parseSummaryText(parsed.data.text, parsed.data.knownExercises);
        if (!result) {
          json(503, { error: "llm_not_configured" });
          return;
        }
        json(200, result);
      }
    } catch (e) {
      console.error("parse failed:", (e as Error)?.message);
      json(422, { error: "unparseable" });
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`agent service listening on :${PORT}`);
});
