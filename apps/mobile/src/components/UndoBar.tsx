import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, radius } from '../theme';
import { useLanguage } from '../lib/language';

/**
 * Ported from the Notch Design System's UndoBar
 * (components/feedback/UndoBar.jsx) — a reversible destructive action,
 * announced after the fact rather than gated by a confirm dialog. Used for
 * the frequent, low-stakes deletes inside a session (removing a row or a
 * unit); the rarer, higher-cost "discard this whole workout" stays a real
 * confirm (Alert.alert), since that trade only favors undo-over-confirm
 * for actions someone might make constantly by accident.
 */
export function UndoBar({ message, bottom, onUndo }: { message: string; bottom: number; onUndo: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  return (
    <View
      style={{
        position: 'absolute', left: spacing.md, right: spacing.md, bottom, zIndex: 20,
        flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: theme.surface, borderRadius: radius.pill, minHeight: 48,
        paddingVertical: 4, paddingHorizontal: spacing.md,
        shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
      }}
    >
      <Text
        style={{ flex: 1, color: theme.ink, fontSize: 14, textAlign: dir === 'rtl' ? 'right' : 'left' }}
        numberOfLines={1}
      >
        {message}
      </Text>
      <Pressable onPress={onUndo} hitSlop={8}>
        <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '800' }}>{t('undo')}</Text>
      </Pressable>
    </View>
  );
}
