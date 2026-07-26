/**
 * Design tokens — single source of truth, mirrored from the
 * "GymCoach AI" Claude Design project (claude.ai/design).
 * X-meets-WhatsApp direction: monochrome ground, one blue accent,
 * semantic colors reserved for meaning (PR hit / warning / destructive).
 */

export const palette = {
  light: {
    bg: "#FFFFFF",
    surface: "#F0F1F2",
    ink: "#0F1419",
    inkSoft: "#536471",
    accent: "#1D7FE0",
    onAccent: "#FFFFFF",
    rule: "#E5E7E8",
    success: "#1DA34A",
    warning: "#B8842B",
    critical: "#D9342B",
  },
  dark: {
    bg: "#000000",
    surface: "#16181C",
    ink: "#E7E9EA",
    inkSoft: "#71767B",
    accent: "#3B9EFF",
    onAccent: "#06131F",
    rule: "#2F3336",
    success: "#4FBE73",
    warning: "#D9A94C",
    critical: "#F4756A",
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
