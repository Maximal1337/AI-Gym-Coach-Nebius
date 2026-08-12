import React, { useContext } from 'react';
import { StyleSheet } from 'react-native';

/**
 * App-wide font scale. Beta testers reported the type ran a little small,
 * and there are ~230 hard-coded `fontSize` values spread across every
 * screen — bumping each by hand would be a large, error-prone diff. Instead
 * we scale every Text/TextInput at the single point they all funnel
 * through: the `react-native` module export.
 *
 * React 19 removed `defaultProps` for function components, and RN 0.81's
 * Text/TextInput are plain function components (no `.render` to patch), so
 * the working hook here is to replace the `Text`/`TextInput` getters on the
 * shared `react-native` module object with thin wrappers. Named imports
 * (`import { Text } from 'react-native'`) compile to live member access on
 * that same object, so every call site picks the wrappers up — as long as
 * this module runs before the first render (imported first in _layout.tsx).
 */
const FONT_SCALE = 1.1;

// React Native's implicit <Text>/<TextInput> size when no fontSize is set.
const DEFAULT_TEXT_SIZE = 14;

function scaled(size: number): number {
  return Math.round(size * FONT_SCALE * 100) / 100;
}

function explicitFontSize(style: unknown): number | undefined {
  const flat = StyleSheet.flatten(style as never) as { fontSize?: unknown } | undefined;
  return typeof flat?.fontSize === 'number' ? flat.fontSize : undefined;
}

// Capture the originals before overriding the getters below, so the
// wrappers render the real components (not themselves — no recursion).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RN = require('react-native');
const OriginalText = RN.Text;
const OriginalTextInput = RN.TextInput;
// `true` when rendered inside another <Text> — RN uses this for nesting.
const TextAncestorContext = RN.unstable_TextAncestorContext;

function ScaledText(props: { style?: unknown } & Record<string, unknown>) {
  const insideText = useContext(TextAncestorContext);
  const size = explicitFontSize(props.style);
  if (size !== undefined) {
    return <OriginalText {...props} style={[props.style, { fontSize: scaled(size) }]} />;
  }
  // No explicit size: a nested <Text> must keep inheriting its (already
  // scaled) parent's size, so only lift the top-level default here.
  if (!insideText) {
    return <OriginalText {...props} style={[props.style, { fontSize: scaled(DEFAULT_TEXT_SIZE) }]} />;
  }
  return <OriginalText {...props} />;
}
ScaledText.displayName = 'ScaledText';

function ScaledTextInput(props: { style?: unknown } & Record<string, unknown>) {
  const size = explicitFontSize(props.style);
  const fontSize = size !== undefined ? scaled(size) : scaled(DEFAULT_TEXT_SIZE);
  return <OriginalTextInput {...props} style={[props.style, { fontSize }]} />;
}
ScaledTextInput.displayName = 'ScaledTextInput';

Object.defineProperty(RN, 'Text', { configurable: true, enumerable: true, get: () => ScaledText });
Object.defineProperty(RN, 'TextInput', { configurable: true, enumerable: true, get: () => ScaledTextInput });
