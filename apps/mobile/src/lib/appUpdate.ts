import { useEffect } from 'react';
import { Alert, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { track } from './analytics';
import { supabase } from './supabase';
import { deriveUpdateStatus, NO_UPDATE, type UpdateStatus } from './appUpdateLogic';

/**
 * App-version gate — IO side. The pure decision logic (and its tests) live in
 * appUpdateLogic.ts. The threshold is server-controlled (app_config), so it can
 * be flipped without an app release.
 *
 * Guardrails so a bug here can't lock the app:
 *  - fetchUpdateStatus never throws and returns NO_UPDATE on ANY failure
 *    (query error, missing row, or a slow/hung query that trips the timeout).
 *  - The block decision is delegated to deriveUpdateStatus, which only blocks
 *    on a confirmed running < min.
 */

export type { UpdateStatus } from './appUpdateLogic';
export { compareVersions } from './appUpdateLogic';

/** How long to wait on the config query before failing open — a version gate must never block launch. */
const FETCH_TIMEOUT_MS = 3000;

/**
 * Marketing version of the running binary (app.json "version"), e.g. "1.0.1".
 * Falls back to '' (NOT '0.0.0') when unknown: an empty version fail-opens in
 * deriveUpdateStatus, whereas '0.0.0' is below every real min and would
 * wrongly force-update if the version were ever unreadable.
 */
export function runningVersion(): string {
  return Constants.expoConfig?.version ?? '';
}

export async function fetchUpdateStatus(): Promise<UpdateStatus> {
  try {
    const query = supabase
      .from('app_config')
      .select('min_supported_version, latest_version, store_url')
      .eq('platform', 'ios')
      .maybeSingle();
    const result = await Promise.race([
      Promise.resolve(query),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS)),
    ]);
    if (!result || result.error || !result.data) return NO_UPDATE;
    return deriveUpdateStatus(runningVersion(), {
      minSupportedVersion: result.data.min_supported_version,
      latestVersion: result.data.latest_version,
      storeUrl: result.data.store_url,
    });
  } catch {
    return NO_UPDATE;
  }
}

/**
 * Soft "update available" nudge — a dismissible alert shown at most once per
 * available version (AsyncStorage-keyed), only when a non-mandatory update
 * exists. Never gates anything; purely informational. Mount once in the app.
 */
export function useUpdateNudge(): void {
  const { t } = useTranslation();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await fetchUpdateStatus();
      if (cancelled || !status.updateAvailable || !status.latestVersion) return;
      const key = `notch:updateNudged:${status.latestVersion}`;
      const seen = await AsyncStorage.getItem(key).catch(() => null);
      if (cancelled || seen) return;
      await AsyncStorage.setItem(key, '1').catch(() => {}); // once per version, either choice
      track('update_nudge_shown', { latestVersion: status.latestVersion });
      Alert.alert(t('updateAvailableTitle'), t('updateAvailableBody'), [
        { text: t('updateLater'), style: 'cancel' },
        ...(status.storeUrl
          ? [{ text: t('updateNow'), onPress: () => { track('update_nudge_tapped'); void Linking.openURL(status.storeUrl!); } }]
          : []),
      ]);
    })();
    return () => { cancelled = true; };
  }, [t]);
}
