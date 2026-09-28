/**
 * Scoring for the memory evaluation (NH-65). Pure, so CI tests it; the run
 * against Token Factory lives in supabase/eval/memory/run.ts.
 *
 * A scenario's `expected` facts are matched one-to-one against the memory the
 * job leaves behind: same category (or one of several), and every keyword
 * present in the text ("a|b" means either). Precision is matched facts over
 * all facts left; recall is matched over expected. `must_not` keyword sets are
 * facts that must never appear — something only the coach said, an injection
 * attempt, small talk — and any match is a violation.
 */

import type { MemoryWrite, SourceMessage } from "./memory-extraction.ts";
import type { FactCategory, FactDoc, FactStability, StoredFact } from "./memory-scoring.ts";

export interface ExpectedFact {
  category: FactCategory | FactCategory[];
  keywords: string[];
  /** Optional, "a|b" allowed. */
  stability?: string;
}

export interface Scenario {
  id: string;
  language?: string;
  facts?: Array<{ text: string; category: FactCategory; importance?: number; stability?: FactStability; pinned?: boolean }>;
  messages: Array<{ role: "user" | "coach"; channel?: "chat" | "workout"; text: string }>;
  expected: ExpectedFact[];
  must_not?: string[][];
}

export interface ScenarioScore {
  id: string;
  expected: number;
  kept: number;
  matched: number;
  precision: number;
  recall: number;
  violations: string[];
}

const hasKeyword = (text: string, keyword: string) =>
  keyword.toLowerCase().split("|").some((alt) => text.toLowerCase().includes(alt.trim()));

export function matches(fact: FactDoc, exp: ExpectedFact): boolean {
  const categories = Array.isArray(exp.category) ? exp.category : [exp.category];
  if (!categories.includes(fact.category)) return false;
  if (exp.stability && !exp.stability.split("|").includes(fact.stability)) return false;
  return exp.keywords.every((k) => hasKeyword(fact.text, k));
}

/** The scenario as the job would see it, with stable ids and times relative to `now`. */
export function scenarioInput(s: Scenario, now: Date): { stored: StoredFact[]; messages: SourceMessage[] } {
  const day = 24 * 60 * 60 * 1000;
  const stored: StoredFact[] = (s.facts ?? []).map((f, i) => ({
    id: `${s.id}-fact-${i + 1}`,
    pinned: f.pinned ?? false,
    doc: {
      text: f.text,
      category: f.category,
      importance: f.importance ?? 3,
      stability: f.stability ?? "long_term",
      evidence: "explicit",
      expires_at: null,
      first_seen_at: new Date(now.getTime() - 30 * day).toISOString(),
      last_seen_at: new Date(now.getTime() - 10 * day).toISOString(),
      mention_count: 1,
      source_message_ids: [],
    },
  }));
  const messages: SourceMessage[] = s.messages.map((m, i) => ({
    id: `${s.id}-msg-${i + 1}`,
    role: m.role,
    channel: m.channel ?? "chat",
    text: m.text,
    at: new Date(now.getTime() - day + i * 60_000).toISOString(),
  }));
  return { stored, messages };
}

/** The memory after a write: stored facts minus removals, with updates, plus inserts. */
export function memoryAfter(stored: StoredFact[], write: MemoryWrite): StoredFact[] {
  const removed = new Set(write.remove.map((r) => r.id));
  const updates = new Map(write.update.map((u) => [u.id, u]));
  const kept = stored
    .filter((f) => !removed.has(f.id))
    .map((f) => ({ id: f.id, doc: updates.get(f.id)?.doc ?? f.doc, pinned: updates.get(f.id)?.pinned ?? f.pinned }));
  return [...kept, ...write.insert.map((i, n) => ({ id: `inserted-${n + 1}`, doc: i.doc, pinned: i.pinned }))];
}

export function scoreScenario(s: Scenario, memory: FactDoc[]): ScenarioScore {
  const used = new Set<number>();
  let matched = 0;
  for (const exp of s.expected) {
    const i = memory.findIndex((f, idx) => !used.has(idx) && matches(f, exp));
    if (i !== -1) {
      used.add(i);
      matched++;
    }
  }
  const violations = (s.must_not ?? [])
    .filter((keys) => memory.some((f) => keys.every((k) => hasKeyword(f.text, k))))
    .map((keys) => keys.join(" + "));
  return {
    id: s.id,
    expected: s.expected.length,
    kept: memory.length,
    matched,
    // An empty memory where nothing was expected is a perfect answer.
    precision: memory.length === 0 ? 1 : matched / memory.length,
    recall: s.expected.length === 0 ? 1 : matched / s.expected.length,
    violations,
  };
}

export function totals(scores: ScenarioScore[]) {
  const expected = scores.reduce((a, s) => a + s.expected, 0);
  const kept = scores.reduce((a, s) => a + s.kept, 0);
  const matched = scores.reduce((a, s) => a + s.matched, 0);
  return {
    scenarios: scores.length,
    precision: kept === 0 ? 1 : matched / kept,
    recall: expected === 0 ? 1 : matched / expected,
    violations: scores.reduce((a, s) => a + s.violations.length, 0),
  };
}
