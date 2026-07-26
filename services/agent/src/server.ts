import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { agentDisabled } from "./config.js";
import { runCoachingTurn } from "./graph.js";
import { turnInputSchema } from "./schema.js";

const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY_BYTES = 64 * 1024;

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

/**
 * Minimal HTTP surface for the agent service.
 * Only Supabase Edge Functions call this (service-to-service secret);
 * end users never reach it directly.
 */
const server = createServer(async (req, res) => {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET" && req.url === "/healthz") {
    json(200, { ok: true, disabled: agentDisabled() });
    return;
  }

  if (req.method === "POST" && req.url === "/turn") {
    if (agentDisabled()) {
      json(503, { error: "agent_disabled" });
      return;
    }
    if (!secretMatches(req.headers["x-agent-secret"])) {
      json(401, { error: "unauthorized" });
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY_BYTES) {
          json(413, { error: "body_too_large" });
          return;
        }
        chunks.push(chunk as Buffer);
      }
      const parsed = turnInputSchema.safeParse(
        JSON.parse(Buffer.concat(chunks).toString()),
      );
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

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`agent service listening on :${PORT}`);
});
