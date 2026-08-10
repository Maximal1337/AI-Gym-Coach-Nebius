---
name: native-timer-notifications
description: Build a countdown/timer feature that must alert (sound + vibration) regardless of whether the app is foregrounded, backgrounded, or the device is locked — "rings like a native timer." Use when adding any time-based alert, reminder, or countdown that needs to survive backgrounding.
---

# A timer that survives backgrounding and rings like a native one

Built for the rest timer (`src/lib/restTimer.tsx`, `src/lib/restTimerLogic.ts`)
— reusable for any future feature with the same requirement (a rep-cadence
beeper, a plank-hold alarm, etc.).

## 1. Never derive the countdown from `setInterval`

iOS and Android throttle/suspend JS timers within seconds of
backgrounding — a `setInterval`-decremented counter silently stops or
drifts. Instead, store a wall-clock **end timestamp** and derive the
remaining time from `Date.now()` on every tick:

```ts
// src/lib/restTimerLogic.ts
export function endAtFor(seconds: number, now: number) { return now + seconds * 1000; }
export function remainingSeconds(endAt: number, now: number) {
  return Math.max(0, Math.round((endAt - now) / 1000));
}
```

This self-corrects across any gap — background for 90s, come back, and
the countdown is exactly right without any resume-specific logic.

## 2. There's exactly ONE `Notifications.setNotificationHandler` — extend it, don't add a second

`app/_layout.tsx` already registers a single global handler that
suppresses alerts while the app is foregrounded (used for coach-reply
pushes, since there's an in-app unread badge instead — see
`NotificationBridge`). Only the *last* `setNotificationHandler` call wins,
so a new always-alert feature must branch inside that same handler, not
register its own:

```ts
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    if (notification.request.content.data?.type === MY_FEATURE_TAG) {
      return { shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
    }
    // ...falls through to the existing foreground-suppression default
  },
});
```

Tag the scheduled notification's `content.data.type` with a unique
string (see `REST_NOTIFICATION_TYPE` in `src/lib/restTimer.tsx`) so the
handler can tell "this needs to always ring" apart from "this is
redundant with UI already visible."

## 3. Android needs its own high-importance channel

The default notification channel is low-importance and easy to miss.
Register a dedicated channel once (e.g. on provider mount) with explicit
sound + vibration:

```ts
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('rest-timer', {
    name: 'Rest timer',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
  });
}
```

## 4. Schedule with `TIME_INTERVAL`, and always cancel-then-reschedule

```ts
Notifications.scheduleNotificationAsync({
  content: { title, body, sound: true, data: { type: MY_FEATURE_TAG } },
  trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, channelId },
});
```

Store the returned identifier. Whenever the underlying duration changes
(pause, ±30s adjust, resume, a fresh start) **cancel the old scheduled
notification before scheduling a new one** — otherwise a stale
notification fires at the old duration, orphaned from the state that
originally scheduled it.

## 5. Haptics are foreground-only; the notification covers backgrounded

`expo-haptics` (`Haptics.notificationAsync(...)`) only does anything while
the app is running and visible — fire it from the same wall-clock tick
that flips the countdown to zero, guarded by `AppState.currentState ===
'active'`. The scheduled notification is what covers the
backgrounded/locked case; don't try to make haptics do both jobs.
