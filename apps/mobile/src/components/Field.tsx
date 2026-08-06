import { Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { useTheme, radius } from '../theme';
import { useLanguage } from '../lib/language';

/**
 * Ported from the Notch Design System's Field (components/forms/Field.jsx)
 * — single-line text input. `surface` picks which ground it sits on:
 * "card" for a field on the app ground, "sunken" for a field nested
 * inside a card, "outline" for the hairline treatment sign-in uses.
 */
export function Field({
  label, value, placeholder, unit, keyboardType, secureTextEntry, autoCapitalize,
  surface = 'card', invalid, disabled, onChangeText, onSubmitEditing, autoFocus, style,
}: {
  label?: string;
  value: string;
  placeholder?: string;
  unit?: string;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  surface?: 'card' | 'sunken' | 'outline';
  invalid?: boolean;
  disabled?: boolean;
  onChangeText?: (next: string) => void;
  onSubmitEditing?: () => void;
  autoFocus?: boolean;
  style?: object;
}) {
  const theme = useTheme();
  const { dir } = useLanguage();
  const bg = surface === 'sunken' ? theme.bg : surface === 'outline' ? 'transparent' : theme.surface;
  const borderColor = invalid ? theme.critical : surface === 'outline' ? theme.rule : 'transparent';

  return (
    <View style={style}>
      {label && (
        <Text style={{
          marginBottom: 6, color: theme.inkSoft, fontSize: 11, fontWeight: '600',
          textAlign: dir === 'rtl' ? 'right' : 'left',
        }}>
          {label}
        </Text>
      )}
      <View style={{
        flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: 6,
        backgroundColor: bg, borderWidth: 1, borderColor, borderRadius: radius.field,
        padding: 12, opacity: disabled ? 0.5 : 1,
      }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          placeholder={placeholder}
          placeholderTextColor={theme.inkSoft}
          editable={!disabled}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize}
          autoFocus={autoFocus}
          style={{ flex: 1, minWidth: 0, color: theme.ink, fontSize: 14.5, textAlign: dir === 'rtl' ? 'right' : 'left' }}
        />
        {unit && <Text style={{ color: theme.inkSoft, fontSize: 12 }}>{unit}</Text>}
      </View>
    </View>
  );
}
