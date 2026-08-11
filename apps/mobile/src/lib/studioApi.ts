import { ApiError, callFn } from './api';
import type { AppLanguage } from './language';

/**
 * Thin client for the `studio-session` Edge Function. Types here mirror the
 * function's actual JSON wire shape (a `metrics` array per exercise), not
 * the DB row shape `packages/shared`'s StudioExercise mirrors (which inlines
 * a fixed primary/extra pair) — the same split PlanPreview.tsx's own
 * ParsedPlan/ParsedExercise types already draw between "what the wire sends"
 * and "what the table stores."
 */

export type StudioFormatType = 'buyin' | 'rounds' | 'fortime' | 'amrap' | 'emom' | 'intervals' | 'custom';
export type StudioScoreType = 'fortime' | 'amrap' | 'emom' | 'strength';

export interface StudioMetric {
  unit: string;
  value: number;
  tiers: number[] | null;
  tierIndex: number | null;
  /** "6/6 pistol" — one value, done each side. Mutually exclusive with
   * tiers/ladder. */
  perSide: boolean;
  /** "10-8-6-3-3 Deadlift" — one value per round. Mutually exclusive with
   * tiers/perSide; `value` is only a fallback (round 1) when this is set. */
  ladder: number[] | null;
}

export interface StudioExercise {
  name: string;
  parseConfidence: 'low' | null;
  /** [primary] or [primary, extra] — never more. */
  metrics: StudioMetric[];
}

export interface StudioBlock {
  /** null = flat list, no header rendered. */
  name: string | null;
  /** null = no format was ever chosen for this block — most boards don't
   * write one for every block. Not the same as 'buyin' (a real, distinct
   * bookending buy-in/buy-out pairing). */
  formatType: StudioFormatType | null;
  formatParams: Record<string, number>;
  formatCustom: string | null;
  exercises: StudioExercise[];
}

export interface StudioTree {
  name: string;
  scoreType: StudioScoreType | null;
  blocks: StudioBlock[];
}

export type StudioLastMap = Record<string, StudioMetric[] | null>;

export interface StudioSessionSource {
  text?: string;
  pdfBase64?: string;
  docxBase64?: string;
  filename?: string;
  imagesBase64?: string[];
}

export const STUDIO_EQUIPMENT_OPTIONS = [
  'bodyweight', 'dumbbells', 'kettlebell', 'barbell', 'box',
  'jump_rope', 'erg_bike_row', 'wall_ball', 'pull_up_bar',
] as const;
export type StudioEquipment = (typeof STUDIO_EQUIPMENT_OPTIONS)[number];

export interface GenerateStudioIntake {
  fitnessLevel: 'beginner' | 'intermediate' | 'advanced';
  durationMin: number;
  equipment: StudioEquipment[];
  /** Free-text equipment beyond the preset list, e.g. "battle ropes". */
  customEquipment: string[];
  focus: 'conditioning' | 'strength' | 'mixed';
  injuryNotes: string | null;
  language: AppLanguage;
}

export interface StudioCustomUnit {
  id: string;
  key: string;
  label: string;
  step: number;
  min: number;
  max: number;
}

export function openStudioSession(
  input:
    | { source: StudioSessionSource }
    | { sourceSessionId: string }
    | { blank: true }
    | { generate: GenerateStudioIntake },
): Promise<{ sessionId: string; tree: StudioTree; last: StudioLastMap; customUnits: StudioCustomUnit[] }> {
  return callFn('studio-session', { action: 'open', ...input });
}

export function addCustomUnit(
  unit: { key: string; label: string; step: number; min: number; max: number },
): Promise<{ customUnit: StudioCustomUnit }> {
  return callFn('studio-session', { action: 'add-custom-unit', ...unit });
}

export function updateStudioSession(sessionId: string, tree: StudioTree): Promise<{ ok: true }> {
  return callFn('studio-session', { action: 'update', sessionId, tree });
}

export function saveStudioSession(
  sessionId: string,
  patch: { tree?: StudioTree; score?: Record<string, string> | null; intensity?: number | null; note?: string | null },
): Promise<{ ok: true }> {
  return callFn('studio-session', { action: 'save', sessionId, ...patch });
}

export function discardStudioSession(sessionId: string): Promise<{ discarded: true }> {
  return callFn('studio-session', { action: 'discard', sessionId });
}

/** "Did I get something wrong?" — re-parses the session's original source
 * (photo/text/file) alongside a free-text correction. Returns a merged tree
 * WITHOUT writing it: the caller reviews removedExerciseNames (anything the
 * new read no longer mentions by name) and, if they proceed, persists the
 * result themselves via updateStudioSession — this never writes on its own. */
export function reparseStudioSession(sessionId: string, correctionText: string): Promise<{
  tree: StudioTree;
  removedExerciseNames: string[];
  last: StudioLastMap;
}> {
  return callFn('studio-session', { action: 'reparse', sessionId, correctionText });
}

export interface StudioSessionListSummary {
  id: string;
  name: string;
  blockCount: number;
  exerciseCount: number;
  movements: string[];
  movementsMore: number;
  savedAt: string | null;
  intensity: 1 | 2 | 3 | 4 | 5 | null;
}

export function listStudioSessions(): Promise<{
  open: { id: string; name: string; startedAt: string } | null;
  recent: StudioSessionListSummary[];
}> {
  return callFn('studio-session', { action: 'list' });
}

/** Every `open` entry point (photograph/paste/upload/generate/build-own/
 * do-again) 409s with "session_already_open" if one is already open — the
 * DB's own one-open-session-per-user rule. Rather than each call site
 * showing a generic failure for what's actually an expected, recoverable
 * state, this looks the existing session up so the caller can route there
 * directly instead. Returns null for any other error (a real failure) or
 * if the lookup itself fails. */
export async function existingOpenSessionId(e: unknown): Promise<string | null> {
  if (!(e instanceof ApiError) || e.code !== 'session_already_open') return null;
  const list = await listStudioSessions().catch(() => null);
  return list?.open?.id ?? null;
}

export function getStudioSession(sessionId: string): Promise<{
  sessionId: string;
  savedAt: string | null;
  score: Record<string, string> | null;
  intensity: 1 | 2 | 3 | 4 | 5 | null;
  note: string | null;
  tree: StudioTree;
  last: StudioLastMap;
  customUnits: StudioCustomUnit[];
}> {
  return callFn('studio-session', { action: 'get', sessionId });
}
