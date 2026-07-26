import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
import { palette } from '@gymcoach/shared';

export default function RootLayout() {
  const scheme = useColorScheme();
  const theme = palette[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.bg },
      }}
    />
  );
}
