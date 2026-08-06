import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../lib/language';
import { useTheme, spacing } from '../theme';

/**
 * Ported from the Notch Design System's SheetShell + SheetHeader
 * (guidelines/plan-actions.html) — the reusable bottom-sheet chrome: scrim,
 * rounded top card, title row with a close X. Same scrim-Pressable +
 * rounded-container pattern PlanPreview's EditExerciseSheet already used,
 * pulled out here since plan-actions.html now needs two different sheets
 * sharing the same shell.
 */
export function BottomSheet({
  visible, title, onClose, children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(6,7,10,0.72)' }}
        onPress={onClose}
        accessibilityLabel={t('close')}
      />
      <View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '85%',
        backgroundColor: theme.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden',
      }}>
        <View style={{
          flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'center',
          padding: spacing.md, borderBottomWidth: 1, borderBottomColor: theme.rule,
        }}>
          <Text
            style={{ flex: 1, color: theme.ink, fontWeight: '800', fontSize: 16, textAlign: dir === 'rtl' ? 'right' : 'left' }}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('close')}>
            <Ionicons name="close" size={22} color={theme.inkSoft} />
          </Pressable>
        </View>
        <ScrollView style={{ padding: spacing.md }} contentContainerStyle={{ paddingBottom: spacing.md }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}
