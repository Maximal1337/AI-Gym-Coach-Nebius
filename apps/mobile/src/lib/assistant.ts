import { supabase } from './supabase';
import { callFn } from './api';
import type { AssistantRow, FactRow, OpenJob } from './assistantLogic';

/**
 * Data calls for the coach assistant (NH-70, NH-71); the screen logic is in
 * assistantLogic.ts. Messages and facts are read straight from the tables
 * (RLS: own rows only); sending goes through assistant-send, which checks the
 * flag, the subscription and the limits before anything is queued.
 */

const MESSAGE_FIELDS = 'id, role, doc, client_message_id, created_at';
const HISTORY_LIMIT = 100;

/** The push type assistant-deliver sends with a reply (supabase/functions/assistant-deliver/handler.ts). */
export const ASSISTANT_REPLY_NOTIFICATION = 'assistant_reply';

/** The latest messages, oldest first. */
export async function fetchLatestMessages(): Promise<AssistantRow[]> {
  const { data, error } = await supabase
    .from('assistant_messages')
    .select(MESSAGE_FIELDS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw error;
  return ((data ?? []) as AssistantRow[]).reverse();
}

/**
 * Messages at or after `since`, oldest first. At or after, not after: a row
 * that shares the last timestamp is refetched and merged by id rather than
 * skipped.
 */
export async function fetchMessagesSince(since: string): Promise<AssistantRow[]> {
  const { data, error } = await supabase
    .from('assistant_messages')
    .select(MESSAGE_FIELDS)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(HISTORY_LIMIT);
  if (error) throw error;
  return (data ?? []) as AssistantRow[];
}

/** This account's unanswered chat messages and what's happening to them. */
export async function fetchOpenJobs(): Promise<OpenJob[]> {
  const { data, error } = await supabase.rpc('assistant_my_open_jobs');
  if (error) throw error;
  return (data ?? []) as OpenJob[];
}

/** Queues a message; the reply arrives later as a row and a push. A retried client id is safe (200, duplicate). */
export function sendAssistantMessage(text: string, clientMessageId: string) {
  return callFn<{ duplicate: boolean; status: string | null }>('assistant-send', { text, client_message_id: clientMessageId });
}

export async function fetchFacts(): Promise<FactRow[]> {
  const { data, error } = await supabase.from('user_facts').select('id, doc, pinned, score');
  if (error) throw error;
  return (data ?? []) as FactRow[];
}

/** RLS lets a user delete only their own facts; facts_version moves so the next turn drops it too. */
export async function deleteFact(id: string): Promise<void> {
  const { error } = await supabase.from('user_facts').delete().eq('id', id);
  if (error) throw error;
}

// Whether the assistant chat is the screen in front — the notification
// handler in app/_layout.tsx shows a reply's banner everywhere else. A
// module-level value rather than context: the handler runs outside React.
let chatFocused = false;
export function setAssistantChatFocused(focused: boolean): void {
  chatFocused = focused;
}
export function isAssistantChatFocused(): boolean {
  return chatFocused;
}
