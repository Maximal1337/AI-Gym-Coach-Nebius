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
  nextExercise: exerciseSchema.nullable(),
  nextLastLogs: z.array(setLogSchema).max(200).default([]),
  nextNotes: z.array(z.string().max(1000)).max(50).default([]),
});

export const conversationReplySchema = z.object({
  message: z.string().min(1),
  loggedSets: z
    .array(
      z.object({
        weightKg: z.number().min(0).max(500),
        reps: z.number().int().min(0).max(200),
      }),
    )
    .max(20)
    .default([]),
  advance: z.boolean(),
  noteToSave: z
    .object({
      text: z.string().min(1).max(500),
      general: z.boolean(),
    })
    .nullable()
    .default(null),
});
