import { useRef } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTheme, radius } from '../theme';
import { useLanguage } from '../lib/language';

const LENGTH = 6;

/**
 * Six-digit code entry — the one new primitive the design system's
 * auth-flow guidelines called out as needed for the "one-time code" sign-in
 * (guidelines/auth-flow.html's CodeBoxes). A single invisible TextInput
 * drives real keyboard/paste/autofill behavior; the six boxes are a pure
 * visual reflection of its value, with the next-to-fill box getting the
 * accent ring the design specifies.
 */
export function CodeInput({
  value, onChangeText, disabled, autoFocus,
}: {
  value: string;
  onChangeText: (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  const { dir } = useLanguage();
  const inputRef = useRef<TextInput>(null);
  const digits = value.split('');
  const activeIndex = Math.min(value.length, LENGTH - 1);

  return (
    <Pressable onPress={() => inputRef.current?.focus()}>
      <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: 8, marginBottom: 16 }}>
        {Array.from({ length: LENGTH }, (_, i) => (
          <View
            key={i}
            style={{
              flex: 1, aspectRatio: 1 / 1.15, borderRadius: radius.field,
              backgroundColor: theme.surface,
              borderWidth: 1.5, borderColor: i === activeIndex && !disabled ? theme.accent : 'transparent',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 22, fontWeight: '600', color: theme.ink, fontVariant: ['tabular-nums'] }}>
              {digits[i] ?? ''}
            </Text>
          </View>
        ))}
      </View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(v) => onChangeText(v.replace(/[^0-9]/g, '').slice(0, LENGTH))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={LENGTH}
        editable={!disabled}
        autoFocus={autoFocus}
        // Visually hidden (not display:none) so it stays focusable/typeable —
        // the six boxes above are what the user actually sees.
        style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
      />
    </Pressable>
  );
}
