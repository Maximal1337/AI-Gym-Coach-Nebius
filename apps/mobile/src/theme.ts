import { useColorScheme } from 'react-native';
import { palette, type Theme } from '@gymcoach/shared';

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return palette[scheme === 'dark' ? 'dark' : 'light'];
}

export { spacing, radius, typography } from '@gymcoach/shared';
