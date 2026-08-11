import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, radius } from '../theme';
import { track } from '../lib/analytics';

export const INTENSITY_LEVELS = [
  { v: 1, glyph: '\u{1F60C}', key: 'intensity1' },
  { v: 2, glyph: '\u{1F642}', key: 'intensity2' },
  { v: 3, glyph: '\u{1F624}', key: 'intensity3' },
  { v: 4, glyph: '\u{1F975}', key: 'intensity4' },
  { v: 5, glyph: '\u{1FAE0}', key: 'intensity5' },
] as const;

/**
 * Ported from the Notch Design System's IntensityPicker
 * (components/forms/IntensityPicker.jsx) — how hard a studio session felt,
 * the one thing the app can't derive from the numbers logged. Five faces,
 * not a 1–10 scale: that's as fine as anyone can report while still
 * breathing hard, and a glyph needs no translation across three languages.
 * The only sanctioned use of emoji in the app.
 */
export function IntensityPicker({
  value, onChange, style,
}: {
  value: number | null;
  onChange: (v: 1 | 2 | 3 | 4 | 5) => void;
  style?: object;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View style={[{ flexDirection: 'row', gap: spacing.sm }, style]}>
      {INTENSITY_LEVELS.map((l) => {
        const on = value === l.v;
        return (
          <Pressable
            key={l.v}
            onPress={() => { track('intensity_selected', { value: l.v }); onChange(l.v); }}
            accessibilityRole="button"
            accessibilityLabel={t(l.key)}
            accessibilityState={{ selected: on }}
            style={{
              flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 5,
              paddingVertical: 10, borderRadius: radius.card,
              backgroundColor: on ? `${theme.accent}1F` : theme.surface,
              borderWidth: 1.5, borderColor: on ? theme.accent : 'transparent',
            }}
          >
            <Text style={{ fontSize: 26, opacity: on ? 1 : 0.7 }}>{l.glyph}</Text>
            <Text style={{ color: on ? theme.accent : theme.inkSoft, fontSize: 10.5, fontWeight: '700', textAlign: 'center' }}>
              {t(l.key)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
