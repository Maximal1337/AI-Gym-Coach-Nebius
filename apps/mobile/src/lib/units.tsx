import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { supabase } from './supabase';

export type UnitSystem = 'metric' | 'imperial';

const STORAGE_KEY = 'notch:units';
const KG_TO_LB = 2.20462;
const CM_TO_IN = 0.393701;

function isUnitSystem(v: unknown): v is UnitSystem {
  return v === 'metric' || v === 'imperial';
}

/**
 * Absent an explicit choice, default from the device's own region setting
 * rather than guessing off app language — a language doesn't imply a
 * region (a Hebrew speaker can be in the US, an English speaker in the
 * UK), while `measurementSystem` is the platform's own answer to exactly
 * this question. `us` is the only value that means imperial for our
 * purposes — `uk`/`metric`/unset all read as metric.
 */
function deviceUnits(): UnitSystem {
  return Localization.getLocales()[0]?.measurementSystem === 'us' ? 'imperial' : 'metric';
}

/**
 * Whether this device has ever gone through an explicit units choice —
 * same device-local, never-auto-persisted pattern as hasChosenLanguage.
 */
export async function hasChosenUnits(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  return isUnitSystem(stored);
}

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
  /** Persists locally always, and to users.units when signed in. */
  setUnits: (units: UnitSystem) => Promise<void>;
}

const UnitsContext = createContext<UnitsContextValue | null>(null);

/**
 * App-level units state (guidelines/units-setting.html). Same priority
 * on first load as language: an explicit choice already made on this
 * device (AsyncStorage) > a signed-in user's saved preference
 * (users.units) > the device's own region setting > metric.
 */
export function UnitsProvider({ children }: { children: ReactNode }) {
  const [units, setUnitsState] = useState<UnitSystem>('metric');

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
      if (isUnitSystem(stored)) {
        setUnitsState(stored);
        return;
      }
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        const { data: row } = await supabase
          .from('users')
          .select('units')
          .eq('id', data.user.id)
          .maybeSingle();
        if (isUnitSystem(row?.units)) {
          setUnitsState(row.units);
          return;
        }
      }
      setUnitsState(deviceUnits());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setUnits(next: UnitSystem) {
    setUnitsState(next);
    await AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return;
    await supabase.from('users').update({ units: next }).eq('id', userId);
  }

  const value = useMemo(() => ({ units, setUnits }), [units]);

  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

export function useUnits(): UnitsContextValue {
  const ctx = useContext(UnitsContext);
  if (!ctx) throw new Error('useUnits must be used within UnitsProvider');
  return ctx;
}
