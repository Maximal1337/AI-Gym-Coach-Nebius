/** Domain types mirroring the Postgres schema (supabase/migrations). */

export type SubscriptionStatus = "trialing" | "active" | "canceled" | "expired";

export interface User {
  id: string;
  appleSub: string | null;
  locale: string;
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  createdAt: string;
  /** First-month-free trial deadline; entitled while now() is before this OR subscriptionStatus grants access. */
  trialEndsAt: string;
  subscriptionStatus: SubscriptionStatus;
  /** Set by revenuecat-webhook; still entitled through this date even when status is 'canceled'. */
  subscriptionExpiresAt: string | null;
  revenuecatCustomerId: string | null;
}

export type PlanStatus = "active" | "archived";
export type SessionStatus = "in_progress" | "completed" | "abandoned";
export type SessionSource = "live" | "imported";
export type TonePreset =
  | "motivational_energetic"
  | "calm_precise"
  | "tough_love"
  | "friendly_casual";
export type AccountabilityStyle = "gentle" | "no_excuses";
export type UnitSystem = "metric" | "imperial";

export interface CoachProfile {
  userId: string;
  coachName: string;
  language: string; // BCP-47, e.g. "he"
  tonePreset: TonePreset;
  accountabilityStyle: AccountabilityStyle;
  personaFreeform: string | null;
  /** Weights are always computed/stored in kg — this only governs how they're phrased in coach replies. */
  units: UnitSystem;
}

export interface TrainingPlan {
  id: string;
  userId: string;
  name: string;
  status: PlanStatus;
  createdAt: string;
}

export type EquipmentType = "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight" | "other";

export interface Exercise {
  id: string;
  planId: string;
  orderIndex: number;
  name: string;
  sets: number;
  repRange: string; // e.g. "8-12"
  restSec: number;
  intensity: string; // e.g. "RIR 1-2", "failure"
  warmup: string | null;
  equipmentType: EquipmentType | null;
}

export interface WorkoutSession {
  id: string;
  userId: string;
  planId: string;
  startedAt: string;
  completedAt: string | null;
  status: SessionStatus;
  source: SessionSource;
}

export interface SetLog {
  id: string;
  sessionId: string;
  exerciseId: string;
  setNo: number;
  weightKg: number;
  reps: number;
  note: string | null;
  createdAt: string;
}

export interface CoachNote {
  id: string;
  userId: string;
  exerciseId: string | null;
  note: string;
  createdAt: string;
}

/** One row per user per calendar month — now an abuse-cap only, not the free/paid gate (see SubscriptionStatus/trialEndsAt on User). */
export interface UsageLedgerEntry {
  userId: string;
  period: string; // "YYYY-MM"
  tokensInput: number;
  tokensOutput: number;
  /** Fractional cents (numeric(10,4) in SQL) — a Flash-Lite session costs ~0.2¢. */
  costCents: number;
}

export type PrimaryGoal = "strength" | "hypertrophy" | "general_fitness" | "fat_loss";
export type ExperienceLevel = "beginner" | "intermediate" | "advanced";
export type Gender = "male" | "female" | "other";

/** Intake facts for AI plan generation (System Design §21) — persisted, reusable. */
export interface FitnessProfile {
  userId: string;
  primaryGoal: PrimaryGoal;
  experienceLevel: ExperienceLevel;
  daysPerWeek: number;
  gender: Gender | null;
  age: number | null;
  weightKg: number | null;
  heightCm: number | null;
  injuryNotes: string | null;
}

export type MovementPattern = "push" | "pull" | "squat" | "hinge" | "lunge" | "core" | "isolation";

/** Small hand-curated seed list — ground truth for the plan-quality linter, not model knowledge. */
export interface CommonExercise {
  id: string;
  name: string;
  muscleGroup: string;
  movementPattern: MovementPattern;
  equipmentType: EquipmentType;
  isCompound: boolean;
}

// --------------------------------------------------------------- studio
// A second, fully independent training kind for class/functional-fitness
// trainees — whiteboard boards with blocks, coach-set scaling tiers and
// per-movement units, rather than gym sets/reps/kg. See
// supabase/migrations/20260809120000_studio_workouts.sql.

export type StudioScoreType = "fortime" | "amrap" | "emom" | "strength";

export type StudioBlockFormatType =
  | "buyin"
  | "rounds"
  | "fortime"
  | "amrap"
  | "emom"
  | "intervals"
  | "custom";

/** Params shape depends on format_type — {} for buyin/fortime, {count} for
 * rounds, {cap} for amrap (minutes), {every,total} for emom (minutes),
 * {on,off} for intervals (seconds). Derive the display string from this in
 * one place (client-side), never store a formatted label. */
export type StudioBlockFormatParams = Record<string, number>;

export interface StudioSession {
  id: string;
  userId: string;
  sourceSessionId: string | null;
  name: string;
  startedAt: string;
  /** null = still open/live — the sole lifecycle signal. Set only by a
   * deliberate Save; there is no auto-save/abandoned state. */
  savedAt: string | null;
  scoreType: StudioScoreType | null;
  score: Record<string, string | number> | null;
  intensity: 1 | 2 | 3 | 4 | 5 | null;
  note: string | null;
}

export interface StudioBlock {
  id: string;
  sessionId: string;
  orderIndex: number;
  /** null = flat list, no block header rendered. */
  name: string | null;
  /** null = no format was ever chosen for this block — most boards don't
   * write one for every block. Not the same as 'buyin', which is a real,
   * distinct format (a bookending buy-in/buy-out pairing). */
  formatType: StudioBlockFormatType | null;
  formatParams: StudioBlockFormatParams;
  formatCustom: string | null;
}

export interface StudioExercise {
  id: string;
  blockId: string;
  orderIndex: number;
  name: string;
  parseConfidence: "low" | null;
  unit: string;
  value: number;
  tiers: number[] | null;
  tierIndex: number | null;
  /** "6/6 pistol" — one value, done each side. NOT the same as a two-value
   * tier ladder ("15/20"), which is two different numbers; per_side is
   * always two IDENTICAL numbers on the board. */
  perSide: boolean;
  /** "10-8-6-3-3 Deadlift" — one value per round, mutually exclusive with
   * tiers/perSide. When set, `value` is only a fallback (the first round);
   * the real data is this array, index-aligned with the block's own round
   * count when the block's format is `rounds`. */
  ladder: number[] | null;
  /** The "+ unit" second metric — always optional, never a third. Ladders
   * are primary-metric only — a laddered exercise pairing a second unit
   * with its own separate ladder isn't a real board pattern. */
  extraUnit: string | null;
  extraValue: number | null;
  extraTiers: number[] | null;
  extraTierIndex: number | null;
  extraPerSide: boolean;
}

export interface StudioCustomUnit {
  id: string;
  userId: string;
  key: string;
  label: string;
  step: number;
  min: number;
  max: number;
}
