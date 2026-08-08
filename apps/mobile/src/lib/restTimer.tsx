import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import {
  clampSeconds, endAtFor, remainingSeconds, resolveStartDuration,
} from './restTimerLogic';

/**
 * Global rest timer (guidelines/rest-timer.html): one timer for the whole
 * app, not scoped to the chat screen, so it's still visible (docked bar)
 * and actionable (pill) while the user is on another tab, and still fires
 * (haptic + local notification) if they've backgrounded the app entirely —
 * "like a native timer". Lives above the tab navigator in app/_layout.tsx.
 */

const STORAGE_KEY = 'notch:restDuration';
/** Tags our own scheduled notification so the app-wide handler (app/_layout.tsx)
 * can always alert+sound for it, bypassing the foreground suppression that
 * exists for coach-reply pushes (those are redundant with the in-app unread
 * badge while foregrounded; a rest ending is not — it wants to ring regardless). */
export const REST_NOTIFICATION_TYPE = 'restTimer';
const ANDROID_CHANNEL_ID = 'rest-timer';

export type RestPhase = 'idle' | 'running' | 'paused' | 'done';

interface RestTimerContextValue {
  phase: RestPhase;
  /** Seconds left, ticking while running; frozen at the value it held when paused/done. */
  remaining: number;
  /** The configured duration for the current/last rest — used for the ring's drained fraction and grows with +30s. */
  total: number;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  /** exerciseRestSec: the plan's own rest_sec for the exercise the next set belongs to, if known — null/undefined falls back to the last manually configured duration on this device. */
  start: (exerciseRestSec?: number | null) => void;
  pause: () => void;
  resume: () => void;
  add: () => void;
  subtract: () => void;
  /** Ends a still-running/paused rest early. */
  skip: () => void;
  /** Acknowledges a finished rest, returning to idle. */
  dismiss: () => void;
}

const RestTimerContext = createContext<RestTimerContextValue | null>(null);

export function RestTimerProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<RestPhase>('idle');
  const [total, setTotal] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [endAt, setEndAt] = useState<number | null>(null);

  // Refs mirroring the state above for synchronous reads inside callbacks
  // and the tick interval — avoids stale-closure bugs without pulling in
  // a reducer for what's otherwise a small, linear state machine.
  const phaseRef = useRef<RestPhase>('idle');
  const remainingRef = useRef(0);
  const lastConfigRef = useRef<number | null>(null);
  const notificationIdRef = useRef<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      const n = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && n > 0) lastConfigRef.current = n;
    }).catch(() => {});
    // A custom channel is what makes Android actually play a sound and
    // vibrate for this — notifications on the default channel are low-
    // importance and easy to miss, wrong for something meant to ring.
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: 'Rest timer',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
      }).catch(() => {});
    }
  }, []);

  const persistLastConfig = useCallback((seconds: number) => {
    lastConfigRef.current = seconds;
    AsyncStorage.setItem(STORAGE_KEY, String(seconds)).catch(() => {});
  }, []);

  const cancelNotification = useCallback(() => {
    const id = notificationIdRef.current;
    notificationIdRef.current = null;
    if (id) Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  }, []);

  // The end alert has to be scheduled ahead of time, not fired from the
  // tick interval — a setInterval is throttled/suspended the moment the
  // app backgrounds, exactly when this needs to fire (design: "the haptic
  // and local notification are the actual product").
  const scheduleNotification = useCallback((seconds: number) => {
    cancelNotification();
    if (seconds <= 0) return;
    Notifications.scheduleNotificationAsync({
      content: {
        title: t('restNotifTitle'),
        body: t('restNotifBody'),
        sound: true,
        data: { type: REST_NOTIFICATION_TYPE },
        ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : null),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        channelId: Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined,
      },
    }).then((id) => { notificationIdRef.current = id; }).catch(() => {});
  }, [cancelNotification, t]);

  function setPhaseBoth(next: RestPhase) {
    phaseRef.current = next;
    setPhase(next);
  }

  const start = useCallback((exerciseRestSec?: number | null) => {
    const duration = resolveStartDuration(exerciseRestSec ?? null, lastConfigRef.current);
    if (duration <= 0) return; // a plan can legitimately set 0s rest (e.g. a superset) — nothing to show
    const now = Date.now();
    setTotal(duration);
    setRemaining(duration);
    remainingRef.current = duration;
    setEndAt(endAtFor(duration, now));
    setExpanded(false);
    setPhaseBoth('running');
    scheduleNotification(duration);
  }, [scheduleNotification]);

  const pause = useCallback(() => {
    if (phaseRef.current !== 'running') return;
    setPhaseBoth('paused');
    cancelNotification();
  }, [cancelNotification]);

  const resume = useCallback(() => {
    if (phaseRef.current !== 'paused') return;
    const now = Date.now();
    setEndAt(endAtFor(remainingRef.current, now));
    setPhaseBoth('running');
    scheduleNotification(remainingRef.current);
  }, [scheduleNotification]);

  const bump = useCallback((delta: number) => {
    if (phaseRef.current !== 'running' && phaseRef.current !== 'paused') return;
    const nextRemaining = clampSeconds(remainingRef.current + delta);
    remainingRef.current = nextRemaining;
    setRemaining(nextRemaining);
    setTotal((t2) => {
      const nextTotal = clampSeconds(t2 + delta);
      persistLastConfig(nextTotal);
      return nextTotal;
    });
    if (phaseRef.current === 'running') {
      setEndAt(endAtFor(nextRemaining, Date.now()));
      scheduleNotification(nextRemaining);
    }
  }, [persistLastConfig, scheduleNotification]);

  const add = useCallback(() => bump(30), [bump]);
  const subtract = useCallback(() => bump(-30), [bump]);

  const stop = useCallback(() => {
    cancelNotification();
    setEndAt(null);
    setExpanded(false);
    setPhaseBoth('idle');
  }, [cancelNotification]);

  // Ticks while running, deriving the displayed remainder from the wall
  // clock rather than decrementing a counter — the countdown stays
  // correct across a background/foreground cycle instead of drifting or
  // freezing while the interval itself was suspended.
  useEffect(() => {
    if (phase !== 'running' || endAt == null) return;
    const tick = () => {
      const s = remainingSeconds(endAt, Date.now());
      remainingRef.current = s;
      setRemaining(s);
      if (s === 0 && phaseRef.current === 'running') {
        setPhaseBoth('done');
        notificationIdRef.current = null; // already delivered by the OS at this point
        if (AppState.currentState === 'active') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase, endAt]);

  const value = useMemo<RestTimerContextValue>(() => ({
    phase, remaining, total, expanded, setExpanded, start, pause, resume, add, subtract, skip: stop, dismiss: stop,
  }), [phase, remaining, total, expanded, start, pause, resume, add, subtract, stop]);

  return <RestTimerContext.Provider value={value}>{children}</RestTimerContext.Provider>;
}

export function useRestTimer(): RestTimerContextValue {
  const ctx = useContext(RestTimerContext);
  if (!ctx) throw new Error('useRestTimer must be used within RestTimerProvider');
  return ctx;
}
