// Must run before any screen renders — installs the app-wide font scale by
// replacing the react-native Text/TextInput exports (see fontScale.tsx).
import '../src/lib/fontScale';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { palette } from '@gymcoach/shared';
import { LanguageProvider } from '../src/lib/language';
import { UnitsProvider } from '../src/lib/units';
import { UnreadProvider, useUnread } from '../src/lib/unread';
import { FlagsProvider } from '../src/lib/flags';
import { RestTimerProvider, REST_NOTIFICATION_TYPE } from '../src/lib/restTimer';
import { ASSISTANT_REPLY_NOTIFICATION, isAssistantChatFocused } from '../src/lib/assistant';
import '../src/i18n';

// GYM-14: crash/error reporting. An empty DSN leaves the SDK disabled
// (documented Sentry behavior) rather than throwing, so local dev without
// EXPO_PUBLIC_SENTRY_DSN set still runs fine.
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0,
});

// Durable coach replies (Linear doc "Durable Coach Replies"): push.ts has
// registered a token since onboarding, but until now nothing reacted to a
// received notification. While the app is foregrounded, a native alert is
// an interruption for something already visible as an unread badge on the
// chat tab (see NotificationBridge below) — only show the OS banner when
// the app isn't the thing the user is currently looking at.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // A rest ending is meant to ring "like a native timer" regardless of
    // whether the app happens to be foregrounded (guidelines/rest-timer.html)
    // — unlike a coach reply, which is redundant with the in-app unread
    // badge while the user is already looking at the app.
    if (notification.request.content.data?.type === REST_NOTIFICATION_TYPE) {
      return {
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      };
    }
    const foregrounded = AppState.currentState === 'active';
    // A coach assistant reply (NH-70) has no unread badge: it shows a banner
    // everywhere except on the assistant chat itself, which fetches it at once.
    if (notification.request.content.data?.type === ASSISTANT_REPLY_NOTIFICATION) {
      const hidden = foregrounded && isAssistantChatFocused();
      return {
        shouldShowAlert: !hidden,
        shouldShowBanner: !hidden,
        shouldShowList: !hidden,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    }
    return {
      shouldShowAlert: !foregrounded,
      shouldShowBanner: !foregrounded,
      shouldShowList: !foregrounded,
      shouldPlaySound: false,
      shouldSetBadge: false,
    };
  },
});

/**
 * Rendered inside UnreadProvider (unlike the listeners themselves, which
 * used to live directly in RootLayout) specifically so the received-
 * notification handler can reach useUnread() — RootLayout renders the
 * provider as a child, so it can't call the hook itself.
 */
function NotificationBridge() {
  const { increment } = useUnread();

  // Tapping a notification just needs to land on the chat tab — whether
  // the app was fully closed (resume-on-mount) or only backgrounded (the
  // AppState listener), train.tsx already knows how to catch up once
  // it's there. Chat lives at "/train" now that Plans is the app's
  // index/default tab (app/(tabs)/index.tsx).
  useEffect(() => {
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      // A coach assistant reply or check-in opens its own chat, which
      // catches up on focus the same way.
      const type = response.notification.request.content.data?.type;
      router.push(type === ASSISTANT_REPLY_NOTIFICATION ? '/(tabs)/coach' : '/(tabs)/train');
    });
    // Foreground receipt: setNotificationHandler above already suppressed
    // the native banner for this case — this is what shows the "+1" on
    // the chat tab instead. Doesn't fetch/apply anything itself; the chat
    // screen's own catch-up (or just opening it) does that, this is only
    // the "something happened" signal for whichever tab isn't chat.
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      // The "+1" belongs to the workout chat's tab; an assistant reply isn't one.
      if (notification.request.content.data?.type === ASSISTANT_REPLY_NOTIFICATION) return;
      if (AppState.currentState === 'active') increment();
    });
    return () => {
      responseSub.remove();
      receivedSub.remove();
    };
  }, [increment]);

  return null;
}

function RootLayout() {
  // Dark mode only, by design decision — not following the system scheme.
  const theme = palette.dark;

  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <UnitsProvider>
          <FlagsProvider>
            <UnreadProvider>
              <RestTimerProvider>
                <NotificationBridge />
                <StatusBar style="light" />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: theme.bg },
                  }}
                />
              </RestTimerProvider>
            </UnreadProvider>
          </FlagsProvider>
        </UnitsProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(RootLayout);
