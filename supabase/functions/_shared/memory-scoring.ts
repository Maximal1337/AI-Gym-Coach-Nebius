/**
 * Scoring and eviction for personalization memory (NH-62, D-11 in
 * docs/nebius-hackathon-plan.md).
 *
 * A user keeps at most MAX_FACTS short typed facts. Their score is computed
 * here, in code, never by the LLM — LLM-assigned numbers drift between runs.
 * The module is pure and deterministic: the same facts, candidates and `now`
 * always produce the same plan, so a re-run of the nightly job changes
 * nothing.
 *
 *   score = (importance / 5) × categoryWeight × confidence × recency + reinforcement
 *   recency = 0.5 ^ (daysSinceLastSeen / halfLife)   (permanent facts: 1)
 *   reinforcement = min(0.3, 0.1 × log2(1 + mentionCount))
 *
 * Eviction with the cap:
 *   1. Expired facts are removed.
 *   2. Below the cap, a candidate is inserted.
 *   3. At the cap, a candidate is inserted only if it scores strictly higher
 *      than the lowest-scoring unpinned fact, which is evicted.
 *   4. Health facts are pinned, at most MAX_PINNED, and a pin is sticky until
 *      the fact expires or is removed. Pinned facts are never evicted.
 *
 * The job applies the resulting plan in this order — remove, insert, update —
 * so the database caps in 20260928122000_user_facts.sql never trip.
 */

export const MAX_FACTS = 15;
export const MAX_PINNED = 3;
export const MAX_FACT_TEXT_LENGTH = 140;

export const FACT_CATEGORIES = ["health", "goal", "schedule", "equipment", "preference", "other"] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export const FACT_STABILITIES = ["temporary", "long_term", "permanent"] as const;
export type FactStability = (typeof FACT_STABILITIES)[number];

export const FACT_EVIDENCE = ["explicit", "inferred"] as const;
export type FactEvidence = (typeof FACT_EVIDENCE)[number];

export const CATEGORY_WEIGHT: Readonly<Record<FactCategory, number>> = {
  health: 1.5,
  goal: 1.2,
  schedule: 1.0,
  equipment: 1.0,
  preference: 0.9,
  other: 0.7,
};

export const CONFIDENCE: Readonly<Record<FactEvidence, number>> = {
  explicit: 1.0,
  inferred: 0.6,
};

/** Recency half-life in days; permanent facts don't decay. */
export const HALF_LIFE_DAYS: Readonly<Record<FactStability, number>> = {
  temporary: 7,
  long_term: 60,
  permanent: Number.POSITIVE_INFINITY,
};

export const MAX_REINFORCEMENT = 0.3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The JSONB document stored in user_facts.doc. */
export interface FactDoc {
  text: string;
  category: FactCategory;
  /** 1 (trivia) … 5 (must know). */
  importance: number;
  stability: FactStability;
  evidence: FactEvidence;
  /** ISO timestamp after which the fact is dropped, or null. */
  expires_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  mention_count: number;
  source_message_ids: string[];
}

/** A fact already stored in user_facts. */
export interface StoredFact {
  id: string;
  doc: FactDoc;
  pinned: boolean;
}

export interface MemoryPlan {
  /** Facts to delete, applied first. */
  remove: Array<{ id: string; reason: "expired" | "evicted" }>;
  /** New facts to insert, applied second. */
  insert: Array<{ doc: FactDoc; score: number; pinned: boolean }>;
  /** Stored facts that stay, with their fresh score and pin, applied last. */
  keep: Array<{ id: string; score: number; pinned: boolean }>;
  /** Candidates that didn't make the cut (never inserted). */
  rejected: Array<{ doc: FactDoc; score: number }>;
}

function parseTime(iso: string, field: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`invalid ${field}: ${iso}`);
  return t;
}

/** Rounded to 6 decimals, the precision of user_facts.score. */
function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/** Validates a fact document, e.g. one built from the LLM's extraction output. */
export function isValidFactDoc(doc: unknown): doc is FactDoc {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return false;
  const d = doc as Record<string, unknown>;
  const isTime = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));
  return (
    typeof d.text === "string" &&
    d.text.trim().length > 0 &&
    d.text.length <= MAX_FACT_TEXT_LENGTH &&
    (FACT_CATEGORIES as readonly unknown[]).includes(d.category) &&
    Number.isInteger(d.importance) && (d.importance as number) >= 1 && (d.importance as number) <= 5 &&
    (FACT_STABILITIES as readonly unknown[]).includes(d.stability) &&
    (FACT_EVIDENCE as readonly unknown[]).includes(d.evidence) &&
    (d.expires_at === null || isTime(d.expires_at)) &&
    isTime(d.first_seen_at) &&
    isTime(d.last_seen_at) &&
    Number.isInteger(d.mention_count) && (d.mention_count as number) >= 1 &&
    Array.isArray(d.source_message_ids) && d.source_message_ids.every((s) => typeof s === "string")
  );
}

export function recency(doc: FactDoc, now: Date): number {
  const halfLife = HALF_LIFE_DAYS[doc.stability];
  if (!Number.isFinite(halfLife)) return 1;
  const days = Math.max(0, (now.getTime() - parseTime(doc.last_seen_at, "last_seen_at")) / DAY_MS);
  return Math.pow(0.5, days / halfLife);
}

export function reinforcement(mentionCount: number): number {
  return Math.min(MAX_REINFORCEMENT, 0.1 * Math.log2(1 + Math.max(0, mentionCount)));
}

export function scoreFact(doc: FactDoc, now: Date): number {
  return round6(
    (doc.importance / 5) * CATEGORY_WEIGHT[doc.category] * CONFIDENCE[doc.evidence] * recency(doc, now) +
      reinforcement(doc.mention_count),
  );
}

export function isExpired(doc: FactDoc, now: Date): boolean {
  return doc.expires_at !== null && parseTime(doc.expires_at, "expires_at") <= now.getTime();
}

interface Entry {
  /** Stored fact id, or null for a candidate. */
  id: string | null;
  doc: FactDoc;
  score: number;
  pinned: boolean;
  /**
   * Last-resort tie-break: the stored id, or "~candidate:<text>:<index>" —
   * "~" sorts after the uuids, so a stored fact outranks an otherwise equal
   * candidate, and candidates tie-break by text, so their order in the input
   * only matters for exact duplicates.
   */
  key: string;
}

/** Higher score first; ties: seen more recently first, then by key. */
function byRank(a: Entry, b: Entry): number {
  if (a.score !== b.score) return b.score - a.score;
  const seen = parseTime(b.doc.last_seen_at, "last_seen_at") - parseTime(a.doc.last_seen_at, "last_seen_at");
  if (seen !== 0) return seen;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** The entry that goes first: the lowest-ranked unpinned one. */
function lowestUnpinned(entries: Entry[]): Entry | undefined {
  let worst: Entry | undefined;
  for (const e of entries) {
    if (e.pinned) continue;
    if (!worst || byRank(e, worst) > 0) worst = e;
  }
  return worst;
}

/**
 * Plans the next state of a user's memory from their stored facts and the
 * new candidate facts (already validated, already de-duplicated against
 * stored facts and each other by the extraction step).
 */
export function planMemory(stored: StoredFact[], candidates: FactDoc[], now: Date): MemoryPlan {
  const plan: MemoryPlan = { remove: [], insert: [], keep: [], rejected: [] };

  // 1. Expired facts go first; an expired candidate is never inserted.
  const live: Entry[] = [];
  for (const f of [...stored].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (isExpired(f.doc, now)) {
      plan.remove.push({ id: f.id, reason: "expired" });
      continue;
    }
    live.push({ id: f.id, doc: f.doc, score: scoreFact(f.doc, now), pinned: f.pinned && f.doc.category === "health", key: f.id });
  }
  const fresh: Entry[] = [];
  candidates.forEach((doc, i) => {
    const key = `~candidate:${doc.text}:${String(i).padStart(6, "0")}`;
    const entry: Entry = { id: null, doc, score: scoreFact(doc, now), pinned: false, key };
    if (isExpired(doc, now)) plan.rejected.push({ doc, score: entry.score });
    else fresh.push(entry);
  });

  // Pins are sticky, but never more than MAX_PINNED (if the stored state
  // somehow has more, the best-ranked ones keep theirs).
  const pinnedNow = live.filter((e) => e.pinned).sort(byRank);
  for (const e of pinnedNow.slice(MAX_PINNED)) e.pinned = false;

  // Stored state over the cap (shouldn't happen — the database refuses it):
  // trim the lowest unpinned facts.
  while (live.length > MAX_FACTS) {
    const worst = lowestUnpinned(live);
    if (!worst) break;
    live.splice(live.indexOf(worst), 1);
    plan.remove.push({ id: worst.id!, reason: "evicted" });
  }

  // 2–3. Best candidates first; a candidate can evict a stored fact or a
  // candidate admitted earlier in the same run.
  const current = [...live];
  for (const cand of [...fresh].sort(byRank)) {
    if (current.length < MAX_FACTS) {
      current.push(cand);
      continue;
    }
    const worst = lowestUnpinned(current);
    if (worst && cand.score > worst.score) {
      current.splice(current.indexOf(worst), 1);
      if (worst.id === null) plan.rejected.push({ doc: worst.doc, score: worst.score });
      else plan.remove.push({ id: worst.id, reason: "evicted" });
      current.push(cand);
    } else {
      plan.rejected.push({ doc: cand.doc, score: cand.score });
    }
  }

  // 4. Fill free pin slots with the best-ranked unpinned health facts.
  let pinned = current.filter((e) => e.pinned).length;
  for (const e of current.filter((e) => !e.pinned && e.doc.category === "health").sort(byRank)) {
    if (pinned >= MAX_PINNED) break;
    e.pinned = true;
    pinned++;
  }

  for (const e of [...current].sort(byRank)) {
    if (e.id === null) plan.insert.push({ doc: e.doc, score: e.score, pinned: e.pinned });
    else plan.keep.push({ id: e.id, score: e.score, pinned: e.pinned });
  }
  return plan;
}
