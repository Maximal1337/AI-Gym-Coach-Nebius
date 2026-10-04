import { type JsonSchema, validate } from "../_shared/mcp.ts";
import type { RelayEnvironment } from "../_shared/relay-auth.ts";
import type { TokenUsage } from "../_shared/assistant.ts";

/**
 * assistant-deliver (NH-53): the relay reports a finished job here.
 *
 *   {"job_id":1,"lease_token":"…","model":"…","usage":{…},
 *    "reply":{"text":"…","sources":[{"title":"…","url":"https://…"}],"actions":["<assistant_actions id>"]}}
 *   or {"job_id":…,"lease_token":…,"model":…,"skip":true} for a check-in with nothing to say.
 *
 * The reply is stored and the job finished in one transaction
 * (assistant_complete_job), so a retried delivery returns the stored reply
 * (200, already_delivered) instead of storing it twice or pushing twice.
 * Then the turn's spend is recorded (reported usage, or the conservative
 * fallback — _shared/assistant.ts) and the user gets a push notification.
 * 409 lease_lost: another attempt owns the job now; the relay drops its result.
 */
export interface DeliverDeps {
  verify: (req: Request, body: string) => Promise<RelayEnvironment | null>;
  complete: (
    env: RelayEnvironment,
    jobId: number,
    leaseToken: string,
    doc: Record<string, unknown> | null,
    skip: boolean,
  ) => Promise<{ data: Record<string, unknown> } | { refusal: string }>;
  recordSpend: (env: RelayEnvironment, model: string, usage: Partial<TokenUsage> | undefined) => Promise<unknown>;
  push: (userId: string, title: string, body: string, data: Record<string, unknown>) => Promise<void>;
}

export const DELIVER_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    job_id: { type: "integer", minimum: 1 },
    lease_token: { type: "string", format: "uuid" },
    model: { type: "string", minLength: 1, maxLength: 200 },
    usage: {
      type: "object",
      properties: { tokensInput: { type: "integer", minimum: 0 }, tokensOutput: { type: "integer", minimum: 0 } },
      required: ["tokensInput", "tokensOutput"],
      additionalProperties: false,
    },
    skip: { type: "boolean" },
    reply: {
      type: "object",
      properties: {
        text: { type: "string", minLength: 1, maxLength: 8000 },
        sources: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            properties: { title: { type: "string", maxLength: 200 }, url: { type: "string", minLength: 9, maxLength: 500 } },
            required: ["url"],
            additionalProperties: false,
          },
        },
        actions: { type: "array", maxItems: 10, items: { type: "string", format: "uuid" } },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  required: ["job_id", "lease_token", "model"],
  additionalProperties: false,
};

export const PUSH_PREVIEW_LENGTH = 140;

export function pushPreview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= PUSH_PREVIEW_LENGTH ? flat : `${flat.slice(0, PUSH_PREVIEW_LENGTH - 1)}…`;
}

export async function handleDeliver(req: Request, deps: DeliverDeps): Promise<Response> {
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  const text = await req.text();
  const env = await deps.verify(req, text);
  if (!env) return reply(401, { error: "unauthorized" });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: "invalid_input" });
  }
  const invalid = validate(DELIVER_SCHEMA, body, "body");
  if (invalid) return reply(400, { error: "invalid_input", detail: invalid });
  const skip = body.skip === true;
  const replyDoc = body.reply as Record<string, unknown> | undefined;
  if (skip === !!replyDoc) return reply(400, { error: "invalid_input", detail: "send either reply or skip" });
  const sources = (replyDoc?.sources as Array<{ url: string }> | undefined) ?? [];
  if (sources.some((s) => !s.url.startsWith("https://"))) {
    return reply(400, { error: "invalid_input", detail: "source urls must be https" });
  }

  const result = await deps.complete(env, body.job_id as number, body.lease_token as string, replyDoc ?? null, skip);
  if ("refusal" in result) {
    if (result.refusal === "lease_lost") return reply(409, { error: "lease_lost" });
    if (result.refusal === "job_not_found") return reply(404, { error: "job_not_found" });
    throw new Error(`assistant_complete_job: unexpected refusal ${result.refusal}`);
  }

  const done = result.data;
  if (done.status === "delivered" || done.status === "skipped") {
    // The reply is stored. Failing now would make the relay retry into
    // already_delivered, which records no spend and sends no push at all.
    try {
      await deps.recordSpend(env, body.model as string, body.usage as Partial<TokenUsage> | undefined);
    } catch (e) {
      console.error("assistant spend not recorded", { jobId: body.job_id, error: String(e) });
    }
  }
  if (done.status === "delivered") {
    await deps.push(
      done.user_id as string,
      (done.coach_name as string | null) ?? "Your coach",
      pushPreview(replyDoc!.text as string),
      { type: "assistant_reply", messageId: done.message_id },
    );
  }
  return reply(200, { status: done.status, message_id: done.message_id ?? null });
}
