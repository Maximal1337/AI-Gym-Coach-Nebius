import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { palette, spacing, typography } from '@gymcoach/shared';

export default function Home() {
  const scheme = useColorScheme();
  const theme = palette[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <Text
        style={{
          color: theme.ink,
          fontSize: typography.screenTitle.size,
          fontWeight: typography.screenTitle.weight,
          letterSpacing: typography.screenTitle.letterSpacing,
        }}
      >
        GymCoach AI
      </Text>
      <Text style={{ color: theme.inkSoft, marginTop: spacing.sm }}>
        M0 scaffold — screens land in M2
      </Text>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
