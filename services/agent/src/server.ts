import * as Sentry from "@sentry/node";

// GYM-14: crash/error reporting. Initialized before any other local import
// so a throw during module load elsewhere still has Sentry available. An
// unset SENTRY_DSN leaves the SDK disabled (documented behavior) rather
// than throwing, so local dev without it configured still runs fine.
// No tracing, no auto-instrumentation: this is a raw node:http server (no
// framework Sentry auto-instruments anyway), and the OpenTelemetry-based
// default integrations are heavy enough for tsx to JIT-transpile on boot
// that they stalled startup on the 256mb Fly machine. captureException
// works fine with zero integrations — this is manual capture only.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? "production",
  tracesSampleRate: 0,
  defaultIntegrations: false,
});

import { createServer, type IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { agentDisabled } from "./config.js";
import { runCoachingTurn } from "./graph.js";
import { runConversationTurn, runConfirmTurn } from "./converse.js";
import {
  turnInputSchema, conversationTurnInputSchema, confirmTurnInputSchema, equipmentTypeSchema,
  parsePlanInputSchema,
} from "./schema.js";
import { parsePlanText, parseSummaryText } from "./parse.js";
import { parseStudioWorkout } from "./parseStudio.js";
import { generatePlanInputSchema, generateWorkoutPlan } from "./generate.js";
import { generateStudioInputSchema, generateStudioWorkout } from "./generateStudio.js";

// Safety net for anything that slips past every route's own try/catch below.
process.on("uncaughtException", (err) => Sentry.captureException(err));
process.on("unhandledRejection", (err) => Sentry.captureException(err));

const parseSummaryInput = z.object({
  text: z.string().min(10).max(20000),
  knownExercises: z.array(z.string().max(200)).max(100).default([]),
});
const generateStudioRequestSchema = z.object({
  intake: generateStudioInputSchema,
});
const generatePlanRequestSchema = z.object({
  intake: generatePlanInputSchema,
  commonExercises: z
    .array(
      z.object({
        name: z.string(),
        muscleGroup: z.string(),
        movementPattern: z.enum(["push", "pull", "squat", "hinge", "lunge", "core", "isolation"]),
        equipmentType: equipmentTypeSchema,
        isCompound: z.boolean(),
      }),
    )
    .max(300),
});

const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY_BYTES = 64 * 1024;
// A base64-encoded PDF is ~33% bigger than the file itself; this covers a
// generously-sized real workout-plan PDF (the client also caps the raw
// file at 8MB before ever uploading it) with headroom for JSON overhead.
// Also covers a photographed plan (guidelines/photograph-plan.html) — up
// to 3 compressed page photos, kept well under this same cap deliberately
// (Supabase Edge Functions have their own, tighter request-size ceiling
// upstream of this service, and this machine's own memory budget is 256MB).
const MAX_PDF_BODY_BYTES = 12 * 1024 * 1024;

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

/** Reads the body up to maxBytes (default MAX_BODY_BYTES); null means the cap was exceeded. */
async function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) return null;
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
    } catch (e) {
      Sentry.captureException(e);
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
    } catch (e) {
      Sentry.captureException(e);
      json(400, { error: "bad_request" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/confirm-turn") {
    if (!checkAuth(req, json)) return;
    try {
      const body = await readBody(req);
      if (!body) {
        json(413, { error: "body_too_large" });
        return;
      }
      const parsed = confirmTurnInputSchema.safeParse(JSON.parse(body.toString()));
      if (!parsed.success) {
        json(400, { error: "invalid_input" });
        return;
      }
      json(200, await runConfirmTurn(parsed.data));
    } catch (e) {
      Sentry.captureException(e);
      json(400, { error: "bad_request" });
    }
    return;
  }

  if (req.method === "POST" && (req.url === "/parse-plan" || req.url === "/parse-summary")) {
    if (!checkAuth(req, json)) return;
    try {
      const rawBody = await readBody(req, req.url === "/parse-plan" ? MAX_PDF_BODY_BYTES : MAX_BODY_BYTES);
      if (!rawBody) {
        json(413, { error: "body_too_large" });
        return;
      }
      const body = JSON.parse(rawBody.toString());
      if (req.url === "/parse-plan") {
        const parsed = parsePlanInputSchema.safeParse(body);
        if (!parsed.success) {
          json(400, { error: "invalid_input" });
          return;
        }
        const result = await parsePlanText(parsed.data);
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
      Sentry.captureException(e);
      json(422, { error: "unparseable" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/parse-studio") {
    if (!checkAuth(req, json)) return;
    try {
      const rawBody = await readBody(req, MAX_PDF_BODY_BYTES);
      if (!rawBody) {
        json(413, { error: "body_too_large" });
        return;
      }
      const rawJson = JSON.parse(rawBody.toString());
      const parsed = parsePlanInputSchema.safeParse(rawJson);
      if (!parsed.success) {
        json(400, { error: "invalid_input" });
        return;
      }
      // "Did I get something wrong?" re-parse: the trainee's own words about
      // what a previous read got wrong, sent alongside the SAME source.
      // Not part of parsePlanInputSchema (shared with gym's /parse-plan,
      // which has no equivalent), so pulled off the raw body directly.
      const correctionNote = typeof rawJson.correctionNote === "string" && rawJson.correctionNote.length <= 500
        ? rawJson.correctionNote
        : undefined;
      const result = await parseStudioWorkout(parsed.data, correctionNote);
      if (!result) {
        json(503, { error: "llm_not_configured" });
        return;
      }
      json(200, result);
    } catch (e) {
      console.error("parse-studio failed:", (e as Error)?.message);
      Sentry.captureException(e);
      json(422, { error: "unparseable" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/generate-plan") {
    if (!checkAuth(req, json)) return;
    try {
      const body = await readBody(req);
      if (!body) {
        json(413, { error: "body_too_large" });
        return;
      }
      const parsed = generatePlanRequestSchema.safeParse(JSON.parse(body.toString()));
      if (!parsed.success) {
        json(400, { error: "invalid_input" });
        return;
      }
      const result = await generateWorkoutPlan(parsed.data.intake, parsed.data.commonExercises);
      if (!result) {
        json(503, { error: "llm_not_configured" });
        return;
      }
      json(200, result);
    } catch (e) {
      console.error("generate-plan failed:", (e as Error)?.message);
      Sentry.captureException(e);
      json(422, { error: "ungeneratable" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/generate-studio") {
    if (!checkAuth(req, json)) return;
    try {
      const body = await readBody(req);
      if (!body) {
        json(413, { error: "body_too_large" });
        return;
      }
      const parsed = generateStudioRequestSchema.safeParse(JSON.parse(body.toString()));
      if (!parsed.success) {
        json(400, { error: "invalid_input" });
        return;
      }
      const result = await generateStudioWorkout(parsed.data.intake);
      if (!result) {
        json(503, { error: "llm_not_configured" });
        return;
      }
      json(200, result);
    } catch (e) {
      console.error("generate-studio failed:", (e as Error)?.message);
      Sentry.captureException(e);
      json(422, { error: "ungeneratable" });
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`agent service listening on :${PORT}`);
});
