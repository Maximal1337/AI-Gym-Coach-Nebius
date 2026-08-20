/**
 * Pure decision logic for the app-version gate — no React Native / Supabase /
 * Expo imports, so it's unit-testable in isolation (appUpdateLogic.test.ts).
 * The IO side (fetching the config, showing UI) lives in appUpdate.ts.
 *
 * The one property that must never break: the gate blocks ONLY on a confirmed
 * `running < minSupportedVersion`. Any missing/blank input yields "no update"
 * so a bug or a config outage can never lock a user out.
 */

export interface AppConfigRow {
  minSupportedVersion: string | null;
  latestVersion: string | null;
  storeUrl: string | null;
}

export interface UpdateStatus {
  /** running < min_supported_version — hard block. */
  mustUpdate: boolean;
  /** running < latest_version (and not mustUpdate) — soft, dismissible nudge. */
  updateAvailable: boolean;
  latestVersion: string | null;
  storeUrl: string | null;
}

export const NO_UPDATE: UpdateStatus = {
  mustUpdate: false, updateAvailable: false, latestVersion: null, storeUrl: null,
};

/**
 * Numeric dotted-version compare: <0 if a<b, 0 if equal, >0 if a>b. Each part
 * is parsed as an integer; missing or non-numeric parts count as 0 (so
 * "1.0" == "1.0.0", and garbage like "abc" is treated as "0", never throwing).
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Fail-safe by construction: a null config (fetch failed / no row) or a
 * missing running version returns NO_UPDATE. A hard block requires a real,
 * present `minSupportedVersion` that the running version is strictly below.
 */
export function deriveUpdateStatus(running: string, config: AppConfigRow | null): UpdateStatus {
  if (!config || !running) return NO_UPDATE;
  const mustUpdate = !!config.minSupportedVersion && compareVersions(running, config.minSupportedVersion) < 0;
  const updateAvailable = !mustUpdate && !!config.latestVersion && compareVersions(running, config.latestVersion) < 0;
  return { mustUpdate, updateAvailable, latestVersion: config.latestVersion ?? null, storeUrl: config.storeUrl ?? null };
}
