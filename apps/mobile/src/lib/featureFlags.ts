/**
 * Local build-time gate for the Studio feature (whiteboard-parsed class
 * workouts) — no server-side flag infra exists in this app yet, so this is
 * a plain constant with an optional env override, per
 * guidelines/studio-implementation-brief.md's "ship behind a flag and test
 * with a real board photo" instruction. Defaults on: the point of this pass
 * is to get the parser in front of a real device and a real whiteboard.
 * Set EXPO_PUBLIC_STUDIO_WORKOUTS_ENABLED=false to turn it off for a build.
 */
export const STUDIO_WORKOUTS_ENABLED = process.env.EXPO_PUBLIC_STUDIO_WORKOUTS_ENABLED !== 'false';
