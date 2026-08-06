import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { callFn, ApiError } from './api';

/**
 * Same resilience gap as pendingTurn.ts, but for starting a workout: iOS
 * suspends an in-flight fetch within seconds of backgrounding, and
 * session-start is the call most likely to still be in flight when that
 * happens (Fly.io cold starts can take 10-22s). Mirrors pendingTurn's
 * single-slot queue-and-retry-on-reconnect pattern. Safe to retry blindly
 * because session-start itself is idempotent server-side — it replays a
 * cached intro response instead of paying for a second LLM call.
 */

export interface PendingSessionStart {
  planId: string;
}

export interface SessionStartResult {
  sessionId: string;
  exerciseId: string;
  message: string;
  suggestedWeightKg: number | null;
  targetReps: number[] | null;
  /** Per-set weight — the real source of truth when a set carried its own track (a fatigue drop kept at its own weight); suggestedWeightKg alone can't express that. */
  targetWeights: number[] | null;
  exerciseSets: number;
}

const KEY = 'gymcoach.pending-session-start.v1';
let flushing = false;
let onDelivered: ((result: SessionStartResult) => void) | null = null;
let onFailed: ((error: unknown) => void) | null = null;

export function setPendingSessionStartHandlers(handlers: {
  onDelivered: (result: SessionStartResult) => void;
  onFailed: (error: unknown) => void;
} | null): void {
  onDelivered = handlers?.onDelivered ?? null;
  onFailed = handlers?.onFailed ?? null;
}

async function read(): Promise<PendingSessionStart | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Queue a session-start that failed to send over the network, then try immediately. */
export async function enqueueSessionStart(item: PendingSessionStart): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(item));
  void flushPendingSessionStart();
}

export async function flushPendingSessionStart(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const item = await read();
    if (!item) return;
    try {
      const result = await callFn<SessionStartResult>('session-start', item);
      await AsyncStorage.removeItem(KEY);
      onDelivered?.(result);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
        // Plan gone / invalid — retrying forever won't help.
        await AsyncStorage.removeItem(KEY);
        onFailed?.(e);
      }
      // else: offline or server trouble — stay queued, retry on reconnect.
    }
  } finally {
    flushing = false;
  }
}

// Retry whenever connectivity returns.
NetInfo.addEventListener((state) => {
  if (state.isConnected) void flushPendingSessionStart();
});
