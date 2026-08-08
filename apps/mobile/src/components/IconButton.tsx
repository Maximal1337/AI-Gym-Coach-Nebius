import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, radius } from '../theme';

/**
 * Ported from the Notch Design System's IconButton — a bare icon tap
 * target (components/core/IconButton.jsx), used where a label pill would
 * be too heavy (a card's "more actions" affordance, guidelines/plan-actions.html).
 * Always pass `label` — it's the only accessible name the button has.
 */
export function IconButton({
  name, label, size = 19, onPress, style, color,
}: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  size?: number;
  onPress?: () => void;
  style?: object;
  /** Defaults to the muted inkSoft tone; pass theme.accent for an accented entry point (e.g. the composer's timer button, guidelines/rest-timer.html's tone="accent"). */
  color?: string;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 36, height: 36, borderRadius: radius.field,
        alignItems: 'center', justifyContent: 'center',
        ...style,
      }}
    >
      <Ionicons name={name} size={size} color={color ?? theme.inkSoft} />
    </Pressable>
  );
}
