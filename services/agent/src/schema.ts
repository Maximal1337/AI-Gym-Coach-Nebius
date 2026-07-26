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

export const turnInputSchema = z.object({
  userId: z.string(),
  planId: z.string(),
  exercise: exerciseSchema,
  lastLogs: z.array(setLogSchema).max(200),
});
