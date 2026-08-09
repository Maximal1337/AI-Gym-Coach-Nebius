import { callFn } from './api';

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

export interface StudioCustomUnit {
  id: string;
  key: string;
  label: string;
  step: number;
  min: number;
  max: number;
}

export function openStudioSession(
  input: { source: StudioSessionSource } | { sourceSessionId: string } | { blank: true },
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
