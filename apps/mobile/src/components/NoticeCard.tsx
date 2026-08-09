import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTheme, spacing, radius } from '../theme';
import { useLanguage } from '../lib/language';

/**
 * A quiet inline notice — "anything you don't touch saves as planned," or
 * (tone="warning") the amber flag on a low-confidence parsed row. Not a
 * dialog or a toast: it sits in the flow of the screen, same weight as the
 * content around it.
 */
export function NoticeCard({
  children, label, tone = 'default', style,
}: {
  children: ReactNode;
  label?: string;
  tone?: 'default' | 'warning';
  style?: object;
}) {
  const theme = useTheme();
  const { dir } = useLanguage();
  const warn = tone === 'warning';
  return (
    <View
      style={[
        {
          backgroundColor: warn ? `${theme.warning}1F` : theme.surface,
          borderWidth: 1, borderColor: warn ? `${theme.warning}55` : 'transparent',
          borderRadius: radius.card, padding: spacing.sm,
        },
        style,
      ]}
    >
      {label && (
        <Text style={{
          color: warn ? theme.warning : theme.ink, fontSize: 11, fontWeight: '800',
          marginBottom: 3, textAlign: dir === 'rtl' ? 'right' : 'left',
        }}>
          {label}
        </Text>
      )}
      <Text style={{ color: theme.inkSoft, fontSize: 12.5, lineHeight: 18, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
        {children}
      </Text>
    </View>
  );
}
