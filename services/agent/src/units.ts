import type { UnitSystem } from "@gymcoach/shared";

/**
 * Mirrors apps/mobile/src/lib/units.tsx's formatWeightKg/weightUnitLabel —
 * weights are always computed and stored in kg, so every prompt/tool-result
 * string that mentions a weight to the model must go through this before
 * interpolation. Without it the model is handed a raw, unrounded kg float
 * and (per the prompts' own "restate exactly" instructions) echoes it
 * straight into the reply, ignoring the user's chosen units entirely.
 */
export function formatWeightForPrompt(kg: number, units: UnitSystem): string {
  const value = units === "metric" ? kg : kg * 2.20462;
  const rounded = Math.round(value * 2) / 2;
  return `${rounded}${units === "metric" ? "kg" : "lb"}`;
}

/**
 * Inverse of the display conversion above: turns a weight the model stated
 * in the USER'S units (the units it sees throughout the prompt) back into
 * kg, the single internal/stored unit. Used when the model hands back a
 * weight it chose (see decideWeight.ts) rather than one we gave it — so the
 * model never has to do a lb<->kg conversion in its head (a real arithmetic
 * mistake risk on the small model), it just echoes numbers in the units it
 * was shown and we convert deterministically.
 */
export function displayWeightToKg(value: number, units: UnitSystem): number {
  return units === "metric" ? value : value / 2.20462;
}
