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
