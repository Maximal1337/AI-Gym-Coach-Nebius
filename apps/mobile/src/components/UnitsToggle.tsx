import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../lib/language';
import { useTheme, radius } from '../theme';
import type { UnitSystem } from '../lib/units';

const OPTIONS: UnitSystem[] = ['metric', 'imperial'];

/**
 * Two chips, matching the app's existing gender-pill pattern rather than
 * inventing a segmented primitive the source design system never defined
 * (guidelines/units-setting.html). Used in both Settings and onboarding's
 * "About you" step — same control in both places, per the design's own
 * point that they must read as one control, not a special-cased variant.
 */
export function UnitsToggle({
  units, onChange, block = false,
}: {
  units: UnitSystem;
  onChange: (next: UnitSystem) => void;
  /** Full-width chips (onboarding) vs. compact inline chips (a Settings row). */
  block?: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();

  return (
    <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: 6 }}>
      {OPTIONS.map((opt) => {
        const selected = units === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={{
              ...(block ? { flex: 1, alignItems: 'center' as const } : {}),
              paddingVertical: block ? 10 : 6, paddingHorizontal: block ? 0 : 12,
              borderRadius: radius.field,
              // block=true is the onboarding case, sitting directly on the
              // page background (theme.bg) like the gender pills it mirrors,
              // so theme.surface reads as a chip. block=false is the
              // Settings case, nested inside a theme.surface card row — the
              // same fill there would be invisible except for the selected
              // border, so it flips to theme.bg to keep contrast.
              backgroundColor: block ? theme.surface : theme.bg, borderWidth: 1.5,
              borderColor: selected ? theme.accent : 'transparent',
            }}
          >
            <Text style={{ color: theme.ink, fontWeight: '700', fontSize: block ? 12.5 : 12.5 }}>
              {t(opt === 'metric' ? 'unitsMetric' : 'unitsImperial')}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
