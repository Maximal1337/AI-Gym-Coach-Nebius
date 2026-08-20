import { AppState } from 'react-native';
import PostHog from 'posthog-react-native';

/**
 * GYM-15: funnel + interaction tracking — every meaningful button tap
 * across the app, plus the original onboarding/workout funnel events.
 * Still no autocapture, no session replay: only explicit track() calls,
 * so every event in PostHog traces back to one call site here. An unset
 * EXPO_PUBLIC_POSTHOG_KEY leaves this disabled, same "missing config =
 * silent no-op, never a throw" pattern as Sentry.
 */
const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;

const client = apiKey
  ? new PostHog(apiKey, {
      host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      // Low-volume app: send each event right away instead of batching to 20.
      // Short beta sessions were closing before the default flushAt/flushInterval
      // ever fired, so nothing reached PostHog. flushInterval sweeps any straggler.
      flushAt: 1,
      flushInterval: 5000,
    })
  : null;

// Flush the queue the moment the app leaves the foreground, so a tap-then-close
// session still delivers instead of waiting for the next launch.
if (client) {
  AppState.addEventListener('change', (state) => {
    if (state === 'background' || state === 'inactive') {
      void client.flush();
    }
  });
}

export function track(event: string, properties?: Record<string, string | number | boolean>): void {
  client?.capture(event, properties);
}
