import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Sentry from '@sentry/react-native';
import { palette } from '@gymcoach/shared';
import { LanguageProvider } from '../src/lib/language';
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
  const scheme = useColorScheme();
  const theme = palette[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.bg },
          }}
        />
      </LanguageProvider>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(RootLayout);
