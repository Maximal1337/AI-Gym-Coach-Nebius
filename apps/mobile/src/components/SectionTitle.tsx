import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme';
import { useLanguage } from '../lib/language';

/**
 * Ported from the Notch Design System's SectionTitle
 * (components/core/SectionTitle.jsx) — the overline label that groups a
 * set of rows or cards (e.g. "+ Add new workout type" above the
 * plan-creation choices).
 */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const theme = useTheme();
  const { dir } = useLanguage();
  return (
    <View style={{
      flexDirection: dir === 'rtl' ? 'row-reverse' : 'row',
      alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6,
    }}>
      <Text style={{
        color: theme.inkSoft, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase',
      }}>
        {children}
      </Text>
      {action}
    </View>
  );
}
