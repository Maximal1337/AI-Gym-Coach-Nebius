import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { useTheme, radius } from '../theme';

/**
 * A small selectable pill — the block-format type picker and the "add a
 * unit" sheet's preset list. Notch's Theme type has no distinct
 * on-accent-vs-accent-fill pair beyond what Button already defines, so this
 * reuses the same accent/onAccent tokens for the selected state.
 */
export function Chip({
  children, selected = false, onPress, style,
}: {
  children: ReactNode;
  selected?: boolean;
  onPress?: () => void;
  style?: object;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        {
          minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: selected ? theme.accent : theme.bg,
          borderWidth: 1, borderColor: selected ? theme.accent : theme.rule,
        },
        style,
      ]}
    >
      <Text style={{ color: selected ? theme.onAccent : theme.ink, fontSize: 13, fontWeight: '700' }}>
        {children}
      </Text>
    </Pressable>
  );
}
