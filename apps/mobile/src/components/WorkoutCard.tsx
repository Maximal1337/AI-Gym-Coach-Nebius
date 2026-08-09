import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, radius } from '../theme';
import { useLanguage } from '../lib/language';
import { INTENSITY_LEVELS } from './IntensityPicker';

export interface WorkoutCardData {
  id: string;
  kind: 'studio' | 'gym';
  name: string;
  meta: string; // "7 blocks · 16 exercises" (studio) or "8 exercises" (gym) — never a duration
  movements: string[];
  movementsMore: number;
  lastDoneAt: string | null;
  intensity: 1 | 2 | 3 | 4 | 5 | null;
}

function relativeTime(iso: string | null, t: (k: string, opts?: Record<string, unknown>) => string): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return t('today');
  if (days === 1) return t('yesterday');
  if (days < 14) return t('daysAgo', { count: days });
  return t('weeksAgo', { count: Math.floor(days / 7) });
}

/**
 * One card, both kinds (studio-implementation-brief.md §3.1) — the leading
 * icon tile carries the type (flame-outline studio / barbell-outline gym),
 * same glyph the add-workout entry point uses, so nothing else in the card
 * needs to say "studio" or "gym" out loud. Tapping the card opens it
 * directly; there's no select-then-confirm.
 */
export function WorkoutCard({
  workout, onPress, onLongPress,
}: {
  workout: WorkoutCardData;
  onPress: () => void;
  /** Gym plans' edit/archive actions — no visible menu button per the
   * brief's "tapping the card IS the choice" (§3.1); reachable instead via
   * the standard long-press affordance, same as the old plan-actions sheet. */
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const face = workout.intensity ? INTENSITY_LEVELS[workout.intensity - 1].glyph : null;
  const when = relativeTime(workout.lastDoneAt, t);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={{ backgroundColor: theme.surface, borderRadius: radius.card, padding: spacing.md }}
    >
      <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'flex-start', gap: spacing.sm }}>
        <View style={{
          width: 36, height: 36, borderRadius: radius.card, backgroundColor: theme.bg,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name={workout.kind === 'studio' ? 'flame-outline' : 'barbell-outline'} size={18} color={theme.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {workout.name}
          </Text>
          <Text style={{ color: theme.inkSoft, fontSize: 12, marginTop: 2, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {workout.meta}
          </Text>
        </View>
        <Ionicons name={dir === 'rtl' ? 'chevron-back' : 'chevron-forward'} size={17} color={theme.inkSoft} />
      </View>

      {workout.movements.length > 0 && (
        <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
          {workout.movements.map((m, i) => (
            // Index, not name — the same movement legitimately repeats
            // (e.g. a buy-in and buy-out both called "Jump Lunges").
            <View key={i} style={{ backgroundColor: theme.bg, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 }}>
              <Text style={{ color: theme.inkSoft, fontSize: 11 }}>{m}</Text>
            </View>
          ))}
          {workout.movementsMore > 0 && (
            <Text style={{ color: theme.inkSoft, fontSize: 11, alignSelf: 'center', paddingHorizontal: 2 }}>
              {`+${workout.movementsMore}`}
            </Text>
          )}
        </View>
      )}

      {when && (
        <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm }}>
          <Ionicons name="time-outline" size={13} color={theme.inkSoft} />
          <Text style={{ color: theme.inkSoft, fontSize: 11 }}>{when}</Text>
          {face && <Text style={{ fontSize: 14, marginInlineStart: 2 }}>{face}</Text>}
        </View>
      )}
    </Pressable>
  );
}
