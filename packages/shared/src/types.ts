/** Domain types mirroring the Postgres schema (supabase/migrations). */

export interface User {
  id: string;
  appleSub: string | null;
  locale: string;
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  createdAt: string;
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

export interface CoachProfile {
  userId: string;
  coachName: string;
  language: string; // BCP-47, e.g. "he"
  tonePreset: TonePreset;
  accountabilityStyle: AccountabilityStyle;
  personaFreeform: string | null;
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

/** One row per user per calendar month — the real mechanism behind "12 workouts". */
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
