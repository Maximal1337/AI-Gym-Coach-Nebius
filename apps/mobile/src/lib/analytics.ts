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
  ? new PostHog(apiKey, { host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com' })
  : null;

export function track(event: string, properties?: Record<string, string | number | boolean>): void {
  client?.capture(event, properties);
}
