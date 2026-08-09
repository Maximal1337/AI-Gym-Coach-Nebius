import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../lib/language';
import { useTheme, spacing } from '../theme';
import { BottomSheet } from './BottomSheet';
import { ChoiceCard } from './ChoiceCard';

export interface AddWorkoutMethod {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description?: string;
  emphasis?: 'default' | 'primary';
  badge?: ReactNode;
  onPress: () => void;
}

/**
 * The "add a workout" sheet — one method list (photograph / paste / upload
 * / build, plus an optional AI-generate option first) behind a single entry
 * point. Extracted from plans.tsx's original inline sheet so the Studio tab
 * reuses the exact same component and interaction rather than a second,
 * subtly different one (same shell `BottomSheet` + `ChoiceCard` rows either
 * way — only the method list and copy differ per caller).
 */
export function AddWorkoutSheet({
  visible, title, methods, caption, onClose,
}: {
  visible: boolean;
  title: string;
  methods: AddWorkoutMethod[];
  caption?: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { dir } = useLanguage();
  return (
    <BottomSheet visible={visible} title={title} onClose={onClose}>
      <View style={{ gap: spacing.sm }}>
        {methods.map((m) => (
          <ChoiceCard
            key={m.label}
            icon={m.icon}
            label={m.label}
            description={m.description}
            emphasis={m.emphasis}
            badge={m.badge}
            onPress={m.onPress}
          />
        ))}
      </View>
      {caption && (
        <Text style={{ color: theme.inkSoft, fontSize: 10.5, lineHeight: 15, textAlign: dir === 'rtl' ? 'right' : 'left', marginTop: spacing.sm }}>
          {caption}
        </Text>
      )}
    </BottomSheet>
  );
}
