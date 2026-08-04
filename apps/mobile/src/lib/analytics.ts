import PostHog from 'posthog-react-native';

/**
 * GYM-15: basic funnel tracking (onboarding complete, workout started,
 * workout completed) — nothing more. No autocapture, no session replay.
 * An unset EXPO_PUBLIC_POSTHOG_KEY leaves this disabled, same "missing
 * config = silent no-op, never a throw" pattern as Sentry.
 */
const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;

const client = apiKey
  ? new PostHog(apiKey, { host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com' })
  : null;

export function track(event: string): void {
  client?.capture(event);
}
