/**
 * Design tokens — single source of truth, mirrored from the
 * "GymCoach AI" Claude Design project (claude.ai/design).
 * X-meets-WhatsApp direction: monochrome ground, one accent (the app
 * icon's lime), semantic colors reserved for meaning (PR hit / warning /
 * destructive). Dark mode's ground is a cool charcoal rather than flat
 * black, so the lime has the same material to glow against that it does
 * in the icon. Light mode carries the same accent hue, but deeper and
 * more saturated — full-brightness lime fails contrast as a solid fill
 * on white.
 */

export const palette = {
  light: {
    bg: "#FFFFFF",
    surface: "#F0F1F2",
    ink: "#0F1419",
    inkSoft: "#536471",
    accent: "#6EA100",
    onAccent: "#FFFFFF",
    rule: "#E5E7E8",
    success: "#1DA34A",
    warning: "#B8842B",
    critical: "#D9342B",
  },
  dark: {
    bg: "#0A0B0D",
    surface: "#15181D",
    ink: "#F3F6EF",
    inkSoft: "#8A9482",
    accent: "#62FC98",
    onAccent: "#0A0D11",
    rule: "#23272E",
    success: "#4FE38A",
    warning: "#E3B23C",
    critical: "#FF6B5C",
  },
} as const;

export type ThemeName = keyof typeof palette;
export type Theme = (typeof palette)[ThemeName];

/** 8pt spacing grid. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  bubble: 16,
  bubbleTail: 4,
  card: 14,
  field: 12,
  pill: 24,
} as const;

export const typography = {
  /** Tight, confident chrome (X-like). */
  screenTitle: { size: 26, weight: "800", letterSpacing: -0.5 },
  navLabel: { size: 13, weight: "700", letterSpacing: 0.3 },
  button: { size: 15, weight: "700" },
  /** Relaxed, readable message text (WhatsApp-like). */
  message: { size: 15.5, weight: "400", lineHeight: 24 },
  meta: { size: 11.5, weight: "400" },
} as const;
