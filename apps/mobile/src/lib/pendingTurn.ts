import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { callFn, ApiError } from './api';

/**
 * Sending a chat message now inherently requires an LLM round trip (the
 * agent parses the free text), so a set can no longer be logged fully
 * offline the way the old numeric queue allowed. This restores basic
 * resilience for a dropped connection mid-send: at most one turn is ever
 * "in flight" in this synchronous chat, so a single persisted slot (not
 * a list) is enough — retried automatically on reconnect.
 */

export interface PendingTurn {
  sessionId: string;
  exerciseId: string;
  userMessage: string;
  recentHistory: Array<{ from: 'coach' | 'me'; text: string }>;
}

export interface TurnResult {
  message: string;
  advance: boolean;
  nextExerciseId: string | null;
  /** §20: the current/next exercise may be a session-only substitution the client has never fetched — carry its name so the header doesn't need a lookup that can miss. */
  nextExerciseName: string | null;
  sessionComplete: boolean;
  nextSuggestedWeightKg: number | null;
  nextTargetReps: number[] | null;
  progress: { done: number; total: number } | null;
}

const KEY = 'gymcoach.pending-turn.v1';
let flushing = false;
let onDelivered: ((result: TurnResult) => void) | null = null;
let onFailed: ((error: unknown) => void) | null = null;

export function setPendingTurnHandlers(handlers: {
  onDelivered: (result: TurnResult) => void;
  onFailed: (error: unknown) => void;
} | null): void {
  onDelivered = handlers?.onDelivered ?? null;
  onFailed = handlers?.onFailed ?? null;
}

async function read(): Promise<PendingTurn | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Queue a turn that failed to send over the network, then try immediately. */
export async function enqueueTurn(item: PendingTurn): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(item));
  void flushPendingTurn();
}

export async function flushPendingTurn(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const item = await read();
    if (!item) return;
    try {
      const result = await callFn<TurnResult>('coach-turn', item);
      await AsyncStorage.removeItem(KEY);
      onDelivered?.(result);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
        // Session gone / invalid — retrying forever won't help.
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
  if (state.isConnected) void flushPendingTurn();
});
