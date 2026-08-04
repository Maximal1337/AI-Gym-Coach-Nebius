import { z } from "zod";

export const equipmentTypeSchema = z.enum([
  "barbell",
  "dumbbell",
  "machine",
  "cable",
  "bodyweight",
  "other",
]);

export const exerciseSchema = z.object({
  id: z.string(),
  planId: z.string(),
  orderIndex: z.number().int(),
  name: z.string().min(1),
  sets: z.number().int().min(1).max(20),
  repRange: z.string(),
  restSec: z.number().int().min(0).max(1800),
  intensity: z.string(),
  warmup: z.string().nullable(),
  equipmentType: equipmentTypeSchema.nullable(),
});

export const setLogSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  exerciseId: z.string(),
  setNo: z.number().int().min(1).max(20),
  weightKg: z.number().min(0),
  reps: z.number().int().min(0).max(200),
  note: z.string().nullable(),
  createdAt: z.string(),
});

export const coachProfileSchema = z.object({
  userId: z.string(),
  coachName: z.string().min(1).max(80),
  language: z.string().min(2).max(20),
  tonePreset: z.enum([
    "motivational_energetic",
    "calm_precise",
    "tough_love",
    "friendly_casual",
  ]),
  accountabilityStyle: z.enum(["gentle", "no_excuses"]),
  personaFreeform: z.string().max(2000).nullable(),
});

export const turnInputSchema = z.object({
  userId: z.string(),
  planId: z.string(),
  planName: z.string().max(200).default(""),
  planExercises: z
    .array(z.object({ name: z.string(), orderIndex: z.number().int() }))
    .max(50)
    .default([]),
  profile: coachProfileSchema,
  exercise: exerciseSchema,
  lastLogs: z.array(setLogSchema).max(200),
  notes: z.array(z.string().max(1000)).max(50),
});

/**
 * §20 (tool-calling revision): a candidate the model can look up via the
 * `listAvailableExercises` tool and pick as next instead of the
 * deterministic default. Carries full data (not just id/name) so the tool
 * result can include a real computed target — the whole turn resolves in
 * one loop, no bolted-on second call — but this data only ever reaches
 * the model's context if it actually calls the tool, keeping an ordinary
 * set-report turn exactly as lean as before (§20's cost story).
 */
export const remainingExerciseSchema = z.object({
  exercise: exerciseSchema,
  lastLogs: z.array(setLogSchema).max(200),
  notes: z.array(z.string().max(1000)).max(50),
  deferred: z.boolean(),
});

/**
 * Free-text mid-workout turn (GYM-61/67): the user reports what they
 * actually did (which may diverge from the suggested target) or asks to
 * renegotiate it. `recentHistory` gives the model short-term memory of
 * this exchange (e.g. a just-agreed target override) since the service
 * itself holds no session state between calls.
 */
export const conversationTurnInputSchema = z.object({
  profile: coachProfileSchema,
  exercise: exerciseSchema,
  lastLogs: z.array(setLogSchema).max(200),
  notes: z.array(z.string().max(1000)).max(50),
  userMessage: z.string().min(1).max(2000),
  recentHistory: z
    .array(
      z.object({
        from: z.enum(["coach", "me"]),
        text: z.string().max(2000),
      }),
    )
    .max(12)
    .default([]),
  // §20 (tool-calling revision): real, structured progress on the CURRENT
  // exercise this session — replaces asking the model to reconstruct
  // partial completion by re-reading `recentHistory` prose, the exact
  // fragility that motivated the tool-calling rework in the first place.
  thisSessionLogs: z.array(setLogSchema).max(20).default([]),
  nextExercise: exerciseSchema.nullable(),
  nextLastLogs: z.array(setLogSchema).max(200).default([]),
  nextNotes: z.array(z.string().max(1000)).max(50).default([]),
  // Dynamic session orchestration (§20): other fresh/deferred exercises the
  // model may look up (via the listAvailableExercises tool) and pick as
  // next instead of `nextExercise` (the deterministic default) — only
  // when the user's message actually asks for a change.
  remainingExercises: z.array(remainingExerciseSchema).max(30).default([]),
  // The exercise (if any) most recently logged in this session before the
  // current one — a real production bug (a user correcting the PREVIOUS
  // exercise's set while already moved on to the current one) got silently
  // misattributed to the current exercise because the model had no other
  // exercise's logs to target. Lets a same-turn correction reach back one
  // exercise instead of only ever writing against `exercise`.
  previousExercise: exerciseSchema.nullable().default(null),
  previousExerciseLogs: z.array(setLogSchema).max(20).default([]),
});

/**
 * Generative-UI confirm action (System Design §19): the sets are already
 * final (confirmed via button) — nothing here is extracted or decided by
 * the model, it only composes the reply and gets the next exercise's
 * deterministic target, same quality as the free-text path.
 */
export const confirmTurnInputSchema = z.object({
  profile: coachProfileSchema,
  exercise: exerciseSchema,
  confirmedSets: z
    .array(z.object({ weightKg: z.number().min(0).max(500), reps: z.number().int().min(0).max(200) }))
    .min(1)
    .max(20),
  notes: z.array(z.string().max(1000)).max(50),
  nextExercise: exerciseSchema.nullable(),
  nextLastLogs: z.array(setLogSchema).max(200).default([]),
  nextNotes: z.array(z.string().max(1000)).max(50).default([]),
  // §20: whether `nextExercise` is being resurfaced from the deferred pool
  // rather than introduced for the first time — changes how it's phrased.
  isRevisit: z.boolean().default(false),
});

/**
 * §20 (tool-calling revision): argument schemas for each tool the
 * free-text turn's agent loop can call. Each one is both the JSON-schema
 * handed to Gemini's native function-calling API (via `tool()`) AND the
 * validator run on the arguments it actually sends back — the same
 * "never trust a hallucinated value" discipline as the rest of this
 * codebase, just applied per tool call instead of per JSON field.
 */
export const logCompletedSetsArgsSchema = z.object({
  sets: z
    .array(z.object({ weightKg: z.number().min(0).max(500), reps: z.number().int().min(0).max(200) }))
    .min(1)
    .max(20),
});

export const stopExerciseEarlyArgsSchema = z.object({
  reason: z.string().max(300).nullable().default(null),
});

export const deferCurrentExerciseArgsSchema = z.object({
  reason: z.string().max(300).nullable().default(null),
});

export const switchToExerciseArgsSchema = z.object({
  exerciseId: z.string(),
});

export const substituteExerciseArgsSchema = z.object({
  name: z.string().min(1).max(200),
  sets: z.number().int().min(1).max(20),
  repRange: z.string().min(1).max(20),
  restSec: z.number().int().min(0).max(1800),
  equipmentType: equipmentTypeSchema.nullable(),
});

export const saveNoteArgsSchema = z.object({
  text: z.string().min(1).max(500),
  general: z.boolean(),
});

/** A correction to a set ALREADY logged this session — never a new report (that's logCompletedSetsArgsSchema). */
export const correctLoggedSetArgsSchema = z.object({
  setNo: z.number().int().min(1).max(20),
  weightKg: z.number().min(0).max(500).nullable().default(null),
  reps: z.number().int().min(0).max(200).nullable().default(null),
});

export const correctNoteArgsSchema = z.object({
  newText: z.string().min(1).max(500),
});

/** A correction to a set logged for the PREVIOUS exercise in this session (not the current one). */
export const correctPreviousExerciseSetArgsSchema = z.object({
  setNo: z.number().int().min(1).max(20),
  weightKg: z.number().min(0).max(500).nullable().default(null),
  reps: z.number().int().min(0).max(200).nullable().default(null),
});
