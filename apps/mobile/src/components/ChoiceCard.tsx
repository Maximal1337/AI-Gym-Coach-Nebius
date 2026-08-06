import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radius } from '../theme';
import { useLanguage } from '../lib/language';

// Notch Design System values not carried by the app's simplified Theme
// type (tokens/colors.css: --volt-wash, --volt-300) — kept local to this
// component, same approach SketchLoader.tsx uses for its orbit color.
const VOLT_WASH = 'rgba(98, 252, 152, 0.12)';
const VOLT_BORDER = '#45DE7F';

/**
 * Ported from the Notch Design System's ChoiceCard
 * (components/forms/ChoiceCard.jsx) — a selectable option row: leading
 * icon square, label + optional description, optional badge, trailing
 * chevron. `emphasis="primary"` marks the one recommended path (a wash
 * background + accent icon square) so it doesn't read as just another
 * item in the list — e.g. "Build me a plan" among the plan-creation
 * choices.
 *
 * It is a button, never a checkbox: tapping it navigates. `selectable`
 * (not used yet in this app) is for the rare case a choice persists on
 * screen until a separate commit, matching the source's own scoping.
 */
export function ChoiceCard({
  label, description, icon, selected = false, selectable = false, emphasis = 'default',
  badge, disabled, onPress, style,
}: {
  label: string;
  description?: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected?: boolean;
  selectable?: boolean;
  emphasis?: 'default' | 'primary';
  badge?: ReactNode;
  disabled?: boolean;
  onPress?: () => void;
  style?: object;
}) {
  const theme = useTheme();
  const { dir } = useLanguage();
  const primary = emphasis === 'primary';
  const highlighted = primary || selected;

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: spacing.md,
        backgroundColor: highlighted ? VOLT_WASH : theme.surface,
        borderWidth: 1.5, borderColor: selected ? theme.accent : primary ? VOLT_BORDER : 'transparent',
        borderRadius: radius.card, padding: spacing.md,
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      <View style={{
        width: 40, height: 40, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center',
        backgroundColor: highlighted ? theme.accent : theme.rule,
      }}>
        <Ionicons name={icon} size={19} color={highlighted ? theme.onAccent : theme.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{
            color: theme.ink, fontSize: 14, fontWeight: '700', textAlign: dir === 'rtl' ? 'right' : 'left',
          }}>
            {label}
          </Text>
          {badge}
        </View>
        {description && (
          <Text style={{
            color: theme.inkSoft, fontSize: 12, lineHeight: 15.5, marginTop: 3,
            textAlign: dir === 'rtl' ? 'right' : 'left',
          }} numberOfLines={2}>
            {description}
          </Text>
        )}
      </View>
      {!selectable && (
        <Ionicons
          name={dir === 'rtl' ? 'chevron-back' : 'chevron-forward'} size={16}
          color={primary ? theme.accent : theme.inkSoft}
        />
      )}
    </Pressable>
  );
}
