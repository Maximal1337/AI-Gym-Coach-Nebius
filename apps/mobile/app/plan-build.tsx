import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ManualPlanForm } from '../src/components/ManualPlanForm';
import { Screen } from '../src/components/Screen';
import { useLanguage } from '../src/lib/language';
import { useTheme, spacing } from '../src/theme';

export default function PlanBuild() {
  const theme = useTheme();
  const { dir } = useLanguage();
  const { mode } = useLocalSearchParams<{ mode?: 'onboarding' }>();

  return (
    <Screen>
      {/* headerShown is false app-wide (app/_layout.tsx) — pushed routes get
          no native back button, only the swipe/hardware gesture, which
          isn't a visible affordance. Every screen needs an obvious one. */}
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ alignSelf: dir === 'rtl' ? 'flex-end' : 'flex-start' }}>
          <Ionicons name={dir === 'rtl' ? 'chevron-forward' : 'chevron-back'} size={24} color={theme.inkSoft} />
        </Pressable>
      </View>
      <ManualPlanForm onDone={() => (mode === 'onboarding' ? router.replace('/') : router.back())} />
    </Screen>
  );
}
