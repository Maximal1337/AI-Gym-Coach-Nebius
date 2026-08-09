import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme';

const SIZES = { sm: 32, md: 40 } as const;

/**
 * Settings' entry point (studio-implementation-brief.md §1.2) — a coach
 * mark, not a gear: what's behind it is the coach's identity and the
 * trainee's own profile, not system preferences. The 32px mark plus hitSlop
 * clears the 44px minimum touch target (§11) without the mark itself
 * needing to look oversized in a nav bar.
 */
export function CoachMark({ size = 'sm' }: { size?: keyof typeof SIZES }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const dim = SIZES[size];
  return (
    <Pressable
      onPress={() => router.push('/settings')}
      accessibilityRole="button"
      accessibilityLabel={t('settingsTitle')}
      hitSlop={8}
      style={{
        width: dim, height: dim, borderRadius: dim / 2,
        backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Ionicons name="person-circle-outline" size={dim - 6} color={theme.accent} />
    </Pressable>
  );
}
