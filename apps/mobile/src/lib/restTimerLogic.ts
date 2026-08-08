/**
 * Pure arithmetic for the rest timer (guidelines/rest-timer.html), kept free
 * of React/AsyncStorage/Notifications so it's unit-testable in isolation —
 * restTimer.tsx is the thin stateful shell around these functions.
 */

export const DEFAULT_REST_SEC = 90;
export const REST_STEP_SEC = 30;

/**
 * What a rest should start at: the plan's own rest_sec for the exercise
 * that's next up (guidelines/rest-timer.html — "it should start from the
 * data of the resting time if exist"), else whatever duration the user
 * last configured on this device, else the hard default.
 */
export function resolveStartDuration(
  exerciseRestSec: number | null | undefined,
  lastConfigSec: number | null,
): number {
  return exerciseRestSec ?? lastConfigSec ?? DEFAULT_REST_SEC;
}

/** Seconds remaining, derived from a wall-clock end timestamp rather than a
 * decrementing counter — a setInterval is throttled/suspended the moment
 * the app backgrounds, so deriving from Date.now() is what keeps the
 * countdown accurate across a background/foreground cycle. */
export function remainingSeconds(endAt: number, now: number): number {
  return Math.max(0, Math.round((endAt - now) / 1000));
}

export function endAtFor(seconds: number, now: number): number {
  return now + seconds * 1000;
}

/** Never negative — a −30s tap with 10s left lands on 0, not -20. */
export function clampSeconds(seconds: number): number {
  return Math.max(0, seconds);
}

/** The bar/ring pulse instead of a color change in the last stretch (design: "not a warning"). */
export function isFinalStretch(remaining: number): boolean {
  return remaining > 0 && remaining <= 3;
}

/** Tabular "M:SS" — same width for 1:30 and 0:59 so nothing reflows per tick. */
export function formatCountdown(seconds: number): string {
  const clamped = clampSeconds(seconds);
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 0..1 fraction of the rest still remaining, for the draining hairline/ring. */
export function ringProgress(remaining: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, remaining / total));
}
