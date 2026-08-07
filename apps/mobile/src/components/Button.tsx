import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useTheme, spacing, radius } from '../theme';
import { useLanguage } from '../lib/language';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'dashed' | 'ghost' | 'quiet' | 'destructive';
export type ButtonSize = 'lg' | 'md' | 'sm';

const SIZES: Record<ButtonSize, { paddingVertical: number; paddingHorizontal: number; fontSize: number; minHeight: number }> = {
  lg: { paddingVertical: 14, paddingHorizontal: 20, fontSize: 15, minHeight: 50 },
  md: { paddingVertical: 10, paddingHorizontal: 16, fontSize: 13, minHeight: 40 },
  sm: { paddingVertical: 6, paddingHorizontal: 12, fontSize: 12.5, minHeight: 30 },
};

/**
 * Ported from the Notch Design System's Button (components/core/Button.jsx)
 * — the one action primitive. Hierarchy is carried by `variant`, not by
 * repeating the same accent pill everywhere: exactly one `primary` per
 * screen region, `quiet`/`ghost` for secondary text-only actions,
 * `dashed` for "add another" affordances, `destructive` for framed
 * dangerous actions (the fill stays transparent — a filled red pill reads
 * as more alarming than this app's confirm-dialog-gated deletes need).
 */
export function Button({
  children, variant = 'primary', size = 'lg', block = false, disabled = false,
  busy = false, icon, onPress, style, textStyle,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  disabled?: boolean;
  /** Shows a spinner in place of the icon and dims interaction, without changing layout/label. */
  busy?: boolean;
  icon?: ReactNode;
  onPress?: () => void;
  style?: object;
  textStyle?: object;
}) {
  const theme = useTheme();
  const { dir } = useLanguage();

  // rgba mixes for states the app's simplified Theme type doesn't carry a
  // token for (Notch's --volt-wash / --volt-300) — kept local to this
  // component rather than widening the shared palette for one primitive.
  const isDisabled = disabled || busy;
  const VARIANTS: Record<ButtonVariant, { background: string; color: string; borderColor: string; borderWidth: number }> = {
    primary: { background: theme.accent, color: theme.onAccent, borderColor: 'transparent', borderWidth: 0 },
    secondary: { background: theme.surface, color: theme.ink, borderColor: theme.rule, borderWidth: 1.5 },
    outline: { background: 'transparent', color: theme.accent, borderColor: theme.accent, borderWidth: 1.5 },
    dashed: { background: 'transparent', color: theme.inkSoft, borderColor: theme.rule, borderWidth: 1 },
    ghost: { background: 'transparent', color: theme.accent, borderColor: 'transparent', borderWidth: 0 },
    quiet: { background: 'transparent', color: theme.inkSoft, borderColor: 'transparent', borderWidth: 0 },
    destructive: { background: 'transparent', color: theme.critical, borderColor: theme.critical, borderWidth: 1.5 },
  };
  const v = isDisabled
    ? { background: theme.rule, color: theme.inkSoft, borderColor: 'transparent', borderWidth: 0 }
    : VARIANTS[variant];
  const isText = variant === 'ghost' || variant === 'quiet';
  const s = SIZES[size];
  const dashed = !isDisabled && variant === 'dashed';

  return (
    <Pressable
      disabled={isDisabled}
      onPress={onPress}
      style={{
        alignSelf: block ? 'stretch' : 'flex-start',
        flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
        backgroundColor: v.background,
        borderWidth: v.borderWidth, borderColor: v.borderColor,
        borderStyle: dashed ? 'dashed' : 'solid',
        borderRadius: radius.pill,
        opacity: isDisabled && !busy ? 0.6 : 1,
        ...(isText
          ? { paddingVertical: 8, paddingHorizontal: 4 }
          : { paddingVertical: s.paddingVertical, paddingHorizontal: s.paddingHorizontal, minHeight: s.minHeight }),
        ...style,
      }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={v.color} />
      ) : icon ? (
        <View>{icon}</View>
      ) : null}
      <Text style={{ color: v.color, fontWeight: '700', fontSize: s.fontSize, textAlign: 'center', ...textStyle }}>
        {children}
      </Text>
    </Pressable>
  );
}
