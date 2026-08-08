import { supabase } from './supabase';

/**
 * Durable chat transcript reads (lean version — Linear doc "Durable Coach
 * Replies"). The live send/receive path is otherwise unchanged; this is
 * only for catching up on whatever the phone missed while it wasn't
 * around to receive a reply directly — on cold launch (resume) or on
 * returning to foreground after being backgrounded (catch-up).
 */

export interface DbMessage {
  id: string;
  from_role: 'coach' | 'me' | 'system';
  text: string;
  payload: Record<string, unknown> | null;
  client_message_id: string | null;
  created_at: string;
}

/** No new dependency needed for a stable id — Hermes already exposes crypto.randomUUID on this RN version; falls back if not. */
export function generateMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Same in-progress + 6h reuse window session-start itself uses (supabase/functions/session-start/index.ts). */
export async function fetchResumableSession(): Promise<{ id: string } | null> {
  const sixHoursAgo = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('status', 'in_progress')
    .gte('started_at', sixHoursAgo)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function fetchMessages(sessionId: string, sinceCreatedAt?: string): Promise<DbMessage[]> {
  let query = supabase
    .from('messages')
    .select('id, from_role, text, payload, client_message_id, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (sinceCreatedAt) query = query.gt('created_at', sinceCreatedAt);
  const { data } = await query;
  return (data ?? []) as DbMessage[];
}
