import { Pressable, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useLanguagePicker } from '../lib/useLanguagePicker';
import { useLanguage } from '../lib/language';
import { useTheme, spacing, radius } from '../theme';

/**
 * Feedback from early beta testers: a bare gray icon at the bottom of the
 * sign-in screen was too easy to miss, especially for someone who can't
 * even read the buttons yet because the app isn't in their language.
 * Labeled pill in the accent color, not just an icon, so it reads as a
 * real control rather than decoration.
 */
export function LanguagePicker({ size = 16 }: { size?: number }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir, language } = useLanguage();
  const { open } = useLanguagePicker();

  return (
    <Pressable
      onPress={open}
      hitSlop={12}
      style={{
        flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: 6,
        backgroundColor: theme.surface, borderRadius: radius.pill,
        paddingVertical: spacing.xs, paddingHorizontal: spacing.sm,
      }}
    >
      <Ionicons name="globe-outline" size={size} color={theme.accent} />
      <Text style={{ color: theme.accent, fontWeight: '700', fontSize: 13 }}>{t(`lang_${language}`)}</Text>
    </Pressable>
  );
}
