/**
 * Expo's answer to a push send, made safe for the log: Expo quotes the push
 * token back in a ticket's message and details, and a token is enough to
 * push to that device, so it never reaches the log.
 */

const PUSH_TOKEN = /Expo(nent)?PushToken\[[^\]]*\]/g;

export interface PushTicketLog {
  status: string;
  error?: string;
  message?: string;
  id?: string;
}

export interface PushAnswerLog {
  http: number;
  tickets?: PushTicketLog[];
  errors?: { code?: string; message?: string }[];
}

function clean(v: unknown): string | undefined {
  return typeof v === "string" ? v.replace(PUSH_TOKEN, "<token>").slice(0, 300) : undefined;
}

/** One entry per token sent, in order: status, Expo's error code and message, and the ticket id for its receipt. */
export function pushAnswerForLog(http: number, answer: unknown): PushAnswerLog {
  const out: PushAnswerLog = { http };
  const body = (answer ?? {}) as { data?: unknown; errors?: unknown };
  if (Array.isArray(body.data)) {
    out.tickets = body.data.map((t: Record<string, unknown>) => {
      const ticket: PushTicketLog = { status: clean(t?.status) ?? "unknown" };
      const error = clean((t?.details as Record<string, unknown> | undefined)?.error);
      if (error) ticket.error = error;
      const message = clean(t?.message);
      if (message) ticket.message = message;
      const id = clean(t?.id);
      if (id) ticket.id = id;
      return ticket;
    });
  }
  if (Array.isArray(body.errors)) {
    out.errors = body.errors.map((e: Record<string, unknown>) => ({ code: clean(e?.code), message: clean(e?.message) }));
  }
  return out;
}
