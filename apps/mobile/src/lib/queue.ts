import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { callFn, ApiError } from './api';

/**
 * GYM-29: offline-first queue for the one interaction that must never
 * block on network — logging a set. Writes land here first, then sync.
 * The server upsert makes replays harmless (last write wins).
 */

export interface QueuedSet {
  sessionId: string;
  exerciseId: string;
  setNo: number;
  weightKg: number;
  reps: number;
  note?: string;
}

const KEY = 'gymcoach.log-queue.v1';
let flushing = false;

async function read(): Promise<QueuedSet[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]');
  } catch {
    return [];
  }
}

async function write(items: QueuedSet[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

/** Queue a set locally, then try to sync immediately. */
export async function enqueueSet(item: QueuedSet): Promise<void> {
  const items = await read();
  // Replace an earlier unsynced write for the same set (corrections).
  const rest = items.filter(
    (i) =>
      !(
        i.sessionId === item.sessionId &&
        i.exerciseId === item.exerciseId &&
        i.setNo === item.setNo
      ),
  );
  await write([...rest, item]);
  void flush();
}

function sameValues(a: QueuedSet, b: QueuedSet): boolean {
  return (
    a.sessionId === b.sessionId && a.exerciseId === b.exerciseId &&
    a.setNo === b.setNo && a.weightKg === b.weightKg &&
    a.reps === b.reps && a.note === b.note
  );
}

/**
 * Push everything queued; keep items on network failure, drop on 4xx.
 * Storage is re-read before every removal so a set enqueued while an
 * upload is in flight is never clobbered — and a CORRECTION enqueued for
 * a set that's mid-upload survives (deep-equality removal, not key
 * removal), so the corrected value uploads on the next pass.
 */
export async function flush(): Promise<{ pending: number }> {
  if (flushing) return { pending: (await read()).length };
  flushing = true;
  try {
    for (let guard = 0; guard < 200; guard++) {
      const items = await read();
      const item = items[0];
      if (!item) break;
      try {
        await callFn('session-log-set', item);
        await write((await read()).filter((i) => !sameValues(i, item)));
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
          // Session gone / invalid — retrying forever won't help.
          await write((await read()).filter((i) => !sameValues(i, item)));
        } else {
          break; // offline or server trouble — try again later
        }
      }
    }
    return { pending: (await read()).length };
  } finally {
    flushing = false;
  }
}

export async function pendingCount(): Promise<number> {
  return (await read()).length;
}

// Sync whenever connectivity returns.
NetInfo.addEventListener((state) => {
  if (state.isConnected) void flush();
});
