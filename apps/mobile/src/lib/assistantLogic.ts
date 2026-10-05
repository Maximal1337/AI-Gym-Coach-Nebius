/**
 * Pure logic for the coach assistant screens: the chat (NH-70) and "What the
 * coach remembers" (NH-71). No React Native or Supabase imports, so node:test
 * covers it (assistantLogic.test.ts); the data calls live in assistant.ts.
 *
 * The chat is asynchronous, unlike the workout chat: assistant-send only
 * queues the message, the agent runs on the VPS, and the reply lands in
 * assistant_messages with a push. So the screen is a view over the rows it
 * has fetched, the messages typed on this device that the server hasn't
 * confirmed yet, and the status of the unanswered ones
 * (assistant_my_open_jobs).
 */

export interface AssistantSource { title?: string; url: string }

export interface AssistantDoc {
  text: string;
  /** Set on replies: "chat", or "checkin" for the proactive daily message (NH-66). */
  kind?: 'chat' | 'checkin';
  sources?: AssistantSource[];
  actions?: string[];
}

export interface AssistantRow {
  id: string;
  role: 'user' | 'assistant';
  doc: AssistantDoc;
  client_message_id: string | null;
  created_at: string;
}

export interface OpenJob { message_id: string; status: 'pending' | 'leased' | 'failed'; updated_at: string }

/** A message typed on this device that isn't in the fetched rows yet. */
export interface LocalSend {
  clientMessageId: string;
  text: string;
  /** "unsent": the request failed on the network or the server — the same client id retries it safely. */
  state: 'sending' | 'unsent';
}

export type ChatItem =
  | {
      key: string;
      from: 'me';
      text: string;
      /** "no_reply": every attempt at an answer failed; the screen offers to send it again. */
      state: 'sent' | 'sending' | 'unsent' | 'no_reply';
      clientMessageId: string | null;
      rowId: string | null;
    }
  | { key: string; from: 'coach'; text: string; checkin: boolean; sources: AssistantSource[] };

function compareRows(a: AssistantRow, b: AssistantRow): number {
  // Date.parse first (offsets may differ), then the raw strings: Postgres
  // prints microseconds, which Date drops, and its trimmed fractions still
  // sort correctly as text. The id breaks exact ties, as the server does.
  const byTime = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (byTime !== 0) return byTime;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Rows merged by id, oldest first. A refetch of the same row replaces it. */
export function mergeRows(current: AssistantRow[], incoming: AssistantRow[]): AssistantRow[] {
  const byId = new Map(current.map((r) => [r.id, r]));
  for (const r of incoming) byId.set(r.id, r);
  return [...byId.values()].sort(compareRows);
}

/** https links only — the server checks this too; a bad row must not become a tappable link. */
export function validSources(sources: unknown): AssistantSource[] {
  if (!Array.isArray(sources)) return [];
  return sources.filter(
    (s): s is AssistantSource =>
      typeof s === 'object' && s !== null && typeof (s as AssistantSource).url === 'string' && /^https:\/\/\S+$/.test((s as AssistantSource).url),
  );
}

/** The link's title, or its host when there's none. */
export function sourceLabel(source: AssistantSource): string {
  const title = source.title?.trim();
  if (title) return title;
  const host = /^https:\/\/([^/?#]+)/.exec(source.url)?.[1] ?? source.url;
  return host.replace(/^www\./, '');
}

/**
 * The transcript: fetched rows in order, then this device's messages the
 * server hasn't confirmed yet. `failedMessageIds` are user messages whose job
 * failed for good (the screen leaves out the ones already sent again).
 */
export function buildItems(rows: AssistantRow[], local: LocalSend[], failedMessageIds: ReadonlySet<string>): ChatItem[] {
  const confirmed = new Set(rows.map((r) => r.client_message_id).filter((id): id is string => !!id));
  const items: ChatItem[] = rows.map((r) =>
    r.role === 'user'
      ? {
          key: r.id,
          from: 'me' as const,
          text: r.doc.text,
          state: failedMessageIds.has(r.id) ? ('no_reply' as const) : ('sent' as const),
          clientMessageId: r.client_message_id,
          rowId: r.id,
        }
      : {
          key: r.id,
          from: 'coach' as const,
          text: r.doc.text,
          checkin: r.doc.kind === 'checkin',
          sources: validSources(r.doc.sources),
        },
  );
  for (const l of local) {
    if (confirmed.has(l.clientMessageId)) continue;
    items.push({ key: `local-${l.clientMessageId}`, from: 'me', text: l.text, state: l.state, clientMessageId: l.clientMessageId, rowId: null });
  }
  return items;
}

/** Local sends the fetched rows now confirm are dropped; the rest stay. */
export function pruneLocal(local: LocalSend[], rows: AssistantRow[]): LocalSend[] {
  const confirmed = new Set(rows.map((r) => r.client_message_id).filter(Boolean));
  const kept = local.filter((l) => !confirmed.has(l.clientMessageId));
  return kept.length === local.length ? local : kept;
}

export type ReplyStatus = 'idle' | 'queued' | 'typing' | 'slow';

/** Past this, the screen says the reply is taking longer than usual (a cold sandbox start is ≤ 60 s by NH-20). */
export const SLOW_REPLY_MS = 120_000;

/**
 * What the coach is doing with the unanswered messages: "typing" once the
 * relay has picked one up, "queued" before that, "slow" when the oldest open
 * one was sent more than SLOW_REPLY_MS ago. Timed from the message, not the
 * job: a job's updated_at moves on every claim, retry and deferral, so a
 * reply stuck behind a cold sandbox would never read as slow. A message not
 * fetched yet falls back to its job's updated_at.
 */
export function replyStatus(jobs: OpenJob[], rows: AssistantRow[], now: number): ReplyStatus {
  const open = jobs.filter((j) => j.status === 'pending' || j.status === 'leased');
  if (open.length === 0) return 'idle';
  const sentAt = new Map(rows.map((r) => [r.id, r.created_at]));
  const oldest = Math.min(...open.map((j) => Date.parse(sentAt.get(j.message_id) ?? j.updated_at)));
  if (Number.isFinite(oldest) && now - oldest > SLOW_REPLY_MS) return 'slow';
  return open.some((j) => j.status === 'leased') ? 'typing' : 'queued';
}

/** The client id "send again" gives the new copy of a failed message: it names the original. */
export function resendClientId(originalRowId: string, fresh: string): string {
  return `again:${originalRowId}:${fresh}`;
}

/**
 * User messages whose job failed for good and that haven't been sent again,
 * for buildItems. Sent again means tapped on this device this session
 * (`resent`), or a fetched row whose client id names it (resendClientId):
 * that survives an app restart and shows on every device, where `resent`
 * doesn't, and unlike matching the text it can't mistake a later "Yes" for
 * a resend of an earlier one.
 */
export function failedMessageIds(jobs: OpenJob[], rows: AssistantRow[], resent: ReadonlySet<string>): Set<string> {
  const resentIds = new Set(
    rows.map((r) => /^again:([^:]+):/.exec(r.client_message_id ?? '')?.[1]).filter((id): id is string => !!id),
  );
  return new Set(
    jobs.filter((j) => j.status === 'failed' && !resent.has(j.message_id) && !resentIds.has(j.message_id)).map((j) => j.message_id),
  );
}

/** Poll for the reply only while one is expected — push and foregrounding cover the rest. */
export function shouldPoll(status: ReplyStatus, local: LocalSend[]): boolean {
  return status !== 'idle' || local.some((l) => l.state === 'sending');
}

/**
 * What a failed assistant-send means for the screen (the contract is in
 * supabase/functions/assistant-send/handler.ts):
 *  - retry: network or server trouble — keep the message as "unsent", same client id;
 *  - subscription: the paywall, same as the workout chat;
 *  - the rest are refusals: the message goes back into the composer with a notice.
 * `status` is null for a network failure.
 */
export type SendFailure =
  | 'retry'
  | 'subscription'
  | 'assistantOff'
  | 'slowDown'
  | 'dailyLimit'
  | 'busyToday'
  | 'tooLong'
  | 'signedOut';

export function classifySendFailure(status: number | null, code: string | null, reason?: unknown): SendFailure {
  if (status === null || status >= 500) return 'retry';
  if (status === 401) return 'signedOut';
  if (status === 402 || code === 'subscription_required') return 'subscription';
  if (status === 403 || code === 'assistant_disabled') return 'assistantOff';
  if (code === 'daily_limit_reached') return reason === 'messages' ? 'dailyLimit' : 'busyToday';
  if (status === 429) return 'slowDown';
  if (status === 400) return 'tooLong';
  return 'retry';
}

/** assistant-send's own limit (MAX_MESSAGE_LENGTH). */
export const MAX_ASSISTANT_MESSAGE = 2000;

// ------------------------------------------------------------ memory (NH-71)

export const FACT_CATEGORIES = ['health', 'goal', 'schedule', 'equipment', 'preference', 'other'] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export interface FactRow {
  id: string;
  doc: { text: string; category: FactCategory; stability?: 'temporary' | 'long_term' | 'permanent' };
  pinned: boolean;
  score: number | string;
}

/**
 * The order the memory screen lists facts in: pinned health facts first (the
 * coach always keeps them), then by category in a fixed order so similar
 * facts sit together, then by score. Unknown categories sort as "other".
 */
export function sortFacts(facts: FactRow[]): FactRow[] {
  const rank = (c: string) => {
    const i = (FACT_CATEGORIES as readonly string[]).indexOf(c);
    return i === -1 ? FACT_CATEGORIES.length - 1 : i;
  };
  return [...facts].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      rank(a.doc.category) - rank(b.doc.category) ||
      Number(b.score) - Number(a.score) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** A category's i18n key, "other" for anything unknown. */
export function factCategoryKey(category: string): `factCategory_${FactCategory}` {
  return `factCategory_${(FACT_CATEGORIES as readonly string[]).includes(category) ? (category as FactCategory) : 'other'}`;
}
