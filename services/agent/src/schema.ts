import { z } from "zod";

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
