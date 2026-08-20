import * as StoreReview from 'expo-store-review';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { track } from './analytics';

const KEY = 'notch:reviewRequested';

/**
 * Ask iOS for its native in-app review prompt — at most ONCE, ever, fired at a
 * positive moment (a completed workout).
 *
 * The OS owns this: it decides whether to actually show the sheet (throttled to
 * ~3/yr per user) and returns no result, so nothing is ever gated on it. We
 * only self-throttle to a single request so we don't waste that OS quota, and
 * we never wire it to a "Rate us" button (against Apple's guidance — that path
 * should deep-link via StoreReview.storeUrl() instead). Fully best-effort and
 * swallowed: it must never affect the workout-completion flow.
 */
export async function maybeRequestReview(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(KEY).catch(() => null)) return;
    if (!(await StoreReview.isAvailableAsync())) return;
    track('review_prompt_requested');
    await StoreReview.requestReview();
    // Mark only after we've actually asked — a failure retries next time.
    await AsyncStorage.setItem(KEY, '1').catch(() => {});
  } catch {
    // A review prompt must never break workout completion.
  }
}
