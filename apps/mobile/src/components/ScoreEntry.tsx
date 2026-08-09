import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, radius } from '../theme';
import { useLanguage } from '../lib/language';

export type StudioScoreType = 'fortime' | 'amrap' | 'emom' | 'strength' | 'stations';

const FIELDS: Record<StudioScoreType, Array<{ key: string; unitKey: string }>> = {
  fortime: [{ key: 'min', unitKey: 'unit_min' }, { key: 'sec', unitKey: 'unit_sec' }],
  amrap: [{ key: 'rounds', unitKey: 'scoreRounds' }, { key: 'reps', unitKey: 'scorePlusReps' }],
  emom: [{ key: 'rounds', unitKey: 'scoreRoundsCompleted' }],
  strength: [{ key: 'weight', unitKey: 'unit_kg' }, { key: 'reps', unitKey: 'unit_reps' }],
  // A station rotation's own headline number: not parsed from the board
  // (nothing there says how many rounds a trainee will actually complete),
  // so this is never set by tree.scoreType — StudioSessionScreen offers it
  // whenever a block's name looks like a station, independent of scoreType.
  stations: [{ key: 'rounds', unitKey: 'scoreRoundsCompleted' }],
};

function pad(n: string | undefined): string {
  const v = Number(n ?? 0);
  return String(Number.isFinite(v) ? v : 0).padStart(2, '0');
}

/**
 * Ported from the Notch Design System's ScoreEntry
 * (components/forms/ScoreEntry.jsx) — the one overall result a studio
 * session sometimes wants (a for-time finish, an AMRAP round+rep count, an
 * EMOM completion, a benchmark strength lift). Only rendered when the
 * workout's scoreType calls for it — a circuit board has none, because the
 * per-exercise values already logged under each block ARE the result.
 */
export function ScoreEntry({
  type, value, onChange, style,
}: {
  type: StudioScoreType;
  value: Record<string, string>;
  onChange: (key: string, v: string) => void;
  style?: object;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const fields = FIELDS[type];

  function bump(key: string, delta: number, min = 0) {
    const n = parseInt(value[key] ?? '0', 10);
    onChange(key, String(Math.max(min, (Number.isFinite(n) ? n : 0) + delta)));
  }

  const isTime = type === 'fortime';

  return (
    <View
      style={[
        {
          backgroundColor: theme.surface, borderRadius: radius.card, padding: spacing.md,
          borderWidth: 1.5, borderColor: theme.accent,
        },
        style,
      ]}
    >
      <Text style={{
        color: theme.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase',
        marginBottom: spacing.sm, textAlign: dir === 'rtl' ? 'right' : 'left',
      }}>
        {t(`scoreType_${type}`)}
      </Text>
      <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: spacing.md }}>
        {fields.map(({ key, unitKey }) => (
          <View key={key} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
            <Text style={{ color: theme.inkSoft, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase' }}>
              {t(unitKey)}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pressable
                onPress={() => bump(key, -1)}
                style={{ width: 40, height: 40, borderRadius: radius.field, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: theme.ink, fontWeight: '800', fontSize: 19 }}>−</Text>
              </Pressable>
              <Text style={{ color: theme.ink, fontSize: 34, fontWeight: '800', minWidth: 56, textAlign: 'center' }}>
                {isTime && (key === 'min' || key === 'sec') ? pad(value[key]) : (value[key] ?? '0')}
              </Text>
              <Pressable
                onPress={() => bump(key, 1)}
                style={{ width: 40, height: 40, borderRadius: radius.field, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: theme.ink, fontWeight: '800', fontSize: 19 }}>+</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
