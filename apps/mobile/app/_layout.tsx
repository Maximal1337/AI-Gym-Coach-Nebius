import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { palette } from '@gymcoach/shared';
import { LanguageProvider } from '../src/lib/language';
import '../src/i18n';

export default function RootLayout() {
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
