import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Marks the user's other open workouts abandoned once one has started. The app
 * resumes only the newest in_progress session of the last six hours
 * (apps/mobile/src/lib/messages.ts, fetchResumableSession), so any other is
 * never finished: on 2026-10-23 a workout left open by an app restart stayed
 * in_progress for good, and the daily check-in read it as a workout under way.
 * Best effort — a failure here never fails the start.
 */
export async function abandonOtherSessions(
  db: Pick<SupabaseClient, "from">,
  userId: string,
  keepId: string,
): Promise<void> {
  const { error } = await db
    .from("workout_sessions")
    .update({ status: "abandoned" })
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .neq("id", keepId);
  if (error) console.error("other sessions not abandoned", { userId, error: error.message });
}
