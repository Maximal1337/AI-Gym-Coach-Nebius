import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTheme, radius } from '../theme';

/**
 * Ported from the Notch Design System's Badge (components/core/Badge.jsx)
 * — a small non-interactive label, e.g. "AI" on the primary generate
 * option, or a muted "Optional" tag (guidelines/starting-weights.html)
 * where the loud accent pill would misread as a call to action. Other
 * tones (record/warning/critical) aren't wired to app theme fields yet,
 * so this stays scoped to what's actually used rather than a speculative
 * full port.
 */
export function Badge({ children, tone = 'accent', style }: { children: ReactNode; tone?: 'accent' | 'neutral'; style?: object }) {
  const theme = useTheme();
  const neutral = tone === 'neutral';
  return (
    <View style={{
      alignSelf: 'flex-start',
      backgroundColor: neutral ? theme.rule : theme.accent, borderRadius: radius.pill,
      paddingVertical: 3, paddingHorizontal: 10,
      ...style,
    }}>
      <Text style={{
        color: neutral ? theme.inkSoft : theme.onAccent, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase',
      }}>
        {children}
      </Text>
    </View>
  );
}
