import { useColorScheme } from 'react-native';
import { palette, spacing, type Theme } from '@gymcoach/shared';

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return palette[scheme === 'dark' ? 'dark' : 'light'];
}

export { spacing, radius, typography } from '@gymcoach/shared';

/** Floating tab bar geometry — screens use this to keep content clear of it. */
export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_BOTTOM_MARGIN = 24;
export const TAB_BAR_CLEARANCE = TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_MARGIN + spacing.sm;
