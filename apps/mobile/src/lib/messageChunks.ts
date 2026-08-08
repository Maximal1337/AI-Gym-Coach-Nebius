/**
 * Splits a coach reply on a blank line into topic-separated chunks — the
 * same rule the model itself follows (prompt.ts's FORMATTING_GUIDE: "put
 * exactly one blank line between them" for a genuine topic change).
 *
 * Deliberately a standalone, dependency-free module — it's imported both
 * by the live path (pushCoachMessage, staggering bubbles in as they
 * arrive) and the durable resume/catch-up path (messagesFromRow, splitting
 * a reply fetched as one already-complete row) in app/(tabs)/index.tsx.
 * Before this was extracted, each path had its own copy of the same
 * regex, and the durable path's copy went stale — a real bug where a
 * multi-topic reply rendered as one undivided block only when it arrived
 * via resume/catch-up instead of live. Keeping the rule in exactly one
 * place is what actually prevents that regressing again, not just what
 * the test below checks.
 */
export function splitCoachReply(text: string): string[] {
  return text.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean);
}
