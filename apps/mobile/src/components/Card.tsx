import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme, spacing, radius } from '../theme';

/**
 * A rounded surface container — the pattern most screens already inline
 * (see plans.tsx's plan rows), pulled out here since the Studio screens use
 * it repeatedly enough to name it. `inset` drops the padding for a
 * container whose children manage their own row padding/dividers (e.g. a
 * list of exercise rows with hairlines between them).
 */
export function Card({ children, inset = false, style }: { children: ReactNode; inset?: boolean; style?: object }) {
  const theme = useTheme();
  return (
    <View
      style={[
        { backgroundColor: theme.surface, borderRadius: radius.card, overflow: 'hidden' },
        inset ? null : { padding: spacing.md },
        style,
      ]}
    >
      {children}
    </View>
  );
}
