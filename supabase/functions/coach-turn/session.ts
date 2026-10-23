import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** A workout session older than this can no longer drive coaching turns. */
export const SESSION_MAX_AGE_MS = 6 * 3600_000;

export interface OpenSession {
  id: string;
  plan_id: string;
  status: string;
  started_at: string;
}

const EXPIRED = { status: 410, body: { error: "session_expired" } } as const;

/**
 * The user's running session for a turn, or the 410 to answer. A session that
 * isn't open any more is answered like one past its age: session_expired is
 * what the app explains in the user's language ("start a new workout"), where
 * a 404 only showed "Coach isn't available" — as on 2026-10-23, when a demo
 * account's reseed deleted the workout its app still had open. A session past
 * its age is marked abandoned on the way.
 */
export async function openSessionFor(
  db: Pick<SupabaseClient, "from">,
  userId: string,
  sessionId: string,
  now: number = Date.now(),
): Promise<{ session: OpenSession } | typeof EXPIRED> {
  const { data: session } = await db
    .from("workout_sessions")
    .select("id, plan_id, status, started_at")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .maybeSingle();
  if (!session) return EXPIRED;

  if (now - new Date(session.started_at).getTime() > SESSION_MAX_AGE_MS) {
    await db
      .from("workout_sessions")
      .update({ status: "abandoned" })
      .eq("id", session.id)
      .eq("user_id", userId);
    return EXPIRED;
  }
  return { session: session as OpenSession };
}
