import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguagePicker } from '../lib/useLanguagePicker';
import { useTheme } from '../theme';

/** A plain globe icon — tapping it opens the native list of languages. */
export function LanguagePicker({ size = 22 }: { size?: number }) {
  const theme = useTheme();
  const { open } = useLanguagePicker();

  return (
    <Pressable onPress={open} hitSlop={12} style={{ padding: 8 }}>
      <Ionicons name="globe-outline" size={size} color={theme.inkSoft} />
    </Pressable>
  );
}
