import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTheme, radius } from '../theme';

/**
 * Ported from the Notch Design System's Badge (components/core/Badge.jsx)
 * — a small non-interactive label, e.g. "AI" on the primary generate
 * option. Only the `accent` tone is used today; other tones (record/
 * warning/critical/neutral) aren't wired to app theme fields yet, so this
 * stays scoped to what's actually used rather than a speculative full port.
 */
export function Badge({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return (
    <View style={{
      alignSelf: 'flex-start',
      backgroundColor: theme.accent, borderRadius: radius.pill,
      paddingVertical: 3, paddingHorizontal: 10,
      ...style,
    }}>
      <Text style={{
        color: theme.onAccent, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase',
      }}>
        {children}
      </Text>
    </View>
  );
}
