import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Sentry from '@sentry/react-native';
import { palette } from '@gymcoach/shared';
import { LanguageProvider } from '../src/lib/language';
import { UnitsProvider } from '../src/lib/units';
import '../src/i18n';

// GYM-14: crash/error reporting. An empty DSN leaves the SDK disabled
// (documented Sentry behavior) rather than throwing, so local dev without
// EXPO_PUBLIC_SENTRY_DSN set still runs fine.
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0,
});

function RootLayout() {
  // Dark mode only, by design decision — not following the system scheme.
  const theme = palette.dark;

  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <UnitsProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.bg },
            }}
          />
        </UnitsProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(RootLayout);
