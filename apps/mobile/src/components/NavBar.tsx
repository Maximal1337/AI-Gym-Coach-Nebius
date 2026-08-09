import { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useLanguage } from '../lib/language';
import { useTheme, spacing } from '../theme';

/**
 * Root-tab header: a title plus one trailing slot — Settings' new home is a
 * CoachMark dropped in here, not a tab bar entry (studio-implementation-
 * brief.md §1.2). Same dir-ternary RTL technique as every other row in this
 * app, for consistency with the rest of the codebase.
 */
export function NavBar({ title, trailing }: { title: string; trailing?: ReactNode }) {
  const theme = useTheme();
  const { dir } = useLanguage();
  return (
    <View style={{
      flexDirection: dir === 'rtl' ? 'row-reverse' : 'row',
      alignItems: 'center', justifyContent: 'space-between',
      marginBottom: spacing.md,
    }}>
      <Text
        style={{ flex: 1, color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left' }}
        numberOfLines={1}
      >
        {title}
      </Text>
      {trailing}
    </View>
  );
}
