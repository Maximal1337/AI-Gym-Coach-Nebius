import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as Localization from 'expo-localization';
import { supabase } from './supabase';

export type UnitSystem = 'metric' | 'imperial';

/** The device's own measurement system (iOS Settings > General > Language
 * & Region > Measurement System) — independent of the app's chosen
 * language, unlike the language itself. Only the US (and functionally
 * Liberia/Myanmar, not worth special-casing) use imperial; everyone else,
 * including English-speaking countries like the UK/Israel/India, is
 * metric — deriving this from language instead of the device's real
 * setting is what caused an English-speaking Israeli user to see lbs. */
export function deviceUnits(): UnitSystem {
  const system = Localization.getLocales()[0]?.measurementSystem;
  return system === 'us' ? 'imperial' : 'metric';
}

const KG_TO_LB = 2.20462;
const CM_TO_IN = 0.393701;

// Storage is always kilograms/centimeters regardless of what's displayed
// (guidelines/units-setting.html's central rule) — these are pure
// converters, safe to call from anywhere, no context needed.

export function kgToLb(kg: number): number {
  return kg * KG_TO_LB;
}
export function lbToKg(lb: number): number {
  return lb / KG_TO_LB;
}
export function cmToIn(cm: number): number {
  return cm * CM_TO_IN;
}
export function inToCm(inches: number): number {
  return inches / CM_TO_IN;
}

/**
 * A stored kg value, formatted for display in the given unit system.
 * Display rounds to the nearest 0.5 (below any real plate's precision,
 * so nothing is visually lost) — entry-side conversion must NOT use
 * this, since rounding is one-directional: round only on the way out,
 * never on the way in, or a value drifts on repeated unit switches.
 */
export function formatWeightKg(kg: number, units: UnitSystem): number {
  if (units === 'metric') return Math.round(kg * 2) / 2;
  return Math.round(kgToLb(kg) * 2) / 2;
}

export function weightUnitLabel(units: UnitSystem): 'kg' | 'lb' {
  return units === 'metric' ? 'kg' : 'lb';
}

/** Exact conversion (no rounding) — what the user typed, in their current unit, converted to kg for storage. */
export function parseWeightToKg(value: string, units: UnitSystem): number | null {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return units === 'metric' ? n : lbToKg(n);
}

/** A stored cm value, formatted for display — feet/inches for imperial, plain cm for metric. */
export function formatHeightCm(cm: number, units: UnitSystem): string {
  if (units === 'metric') return `${Math.round(cm)}`;
  const inches = Math.round(cmToIn(cm));
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/**
 * Exact conversion (no rounding) for a height TYPED in the user's
 * current unit. Imperial entry is a single inches number, not a
 * feet+inches compound field — a real ft/in input widget is more
 * polish than this field (a secondary fitness-profile fact, not a
 * workout-weight flow) warrants relative to the rest of this feature.
 */
export function parseHeightToCm(value: string, units: UnitSystem): number | null {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return units === 'metric' ? n : inToCm(n);
}

/** A stored cm value as a bare number string in the current unit, for pre-filling an EDITABLE field — a plain inches count for imperial, matching parseHeightToCm's expected input (not the compound ft/in string formatHeightCm renders for read-only display). */
export function formatHeightForEntry(cm: number, units: UnitSystem): string {
  return units === 'metric' ? String(Math.round(cm)) : String(Math.round(cmToIn(cm)));
}

interface UnitsContextValue {
  units: UnitSystem;
}

const UnitsContext = createContext<UnitsContextValue | null>(null);

/**
 * Reads the same `coach_profiles.units` column the server's
 * profileToAgent() reads, so a chat message and the screen displaying it
 * always agree — NOT derived from language (see deviceUnits()'s comment
 * for why that was wrong). Falls back to the device's own measurement
 * system for the brief window before this loads (or if there's no row
 * yet, e.g. pre-onboarding) — PersonaForm.tsx is what actually persists
 * the real value, at the same moment it creates/updates coach_profiles.
 */
export function UnitsProvider({ children }: { children: ReactNode }) {
  const [units, setUnits] = useState<UnitSystem>(deviceUnits());

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) return;
      const { data } = await supabase
        .from('coach_profiles')
        .select('units')
        .eq('user_id', userId)
        .maybeSingle();
      if (data?.units === 'imperial' || data?.units === 'metric') setUnits(data.units);
    })();
  }, []);

  return <UnitsContext.Provider value={{ units }}>{children}</UnitsContext.Provider>;
}

export function useUnits(): UnitsContextValue {
  const ctx = useContext(UnitsContext);
  if (!ctx) throw new Error('useUnits must be used within UnitsProvider');
  return ctx;
}
