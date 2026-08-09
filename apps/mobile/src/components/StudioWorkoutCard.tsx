import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, radius } from '../theme';
import { useLanguage } from '../lib/language';
import { INTENSITY_LEVELS } from './IntensityPicker';

export interface StudioSessionSummary {
  id: string;
  name: string;
  blockCount: number;
  exerciseCount: number;
  movements: string[];
  movementsMore: number;
  savedAt: string | null;
  intensity: 1 | 2 | 3 | 4 | 5 | null;
}

function relativeTime(iso: string | null, t: (k: string, opts?: Record<string, unknown>) => string): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return t('today');
  if (days === 1) return t('yesterday');
  if (days < 14) return t('daysAgo', { count: days });
  return t('weeksAgo', { count: Math.floor(days / 7) });
}

/**
 * "Or do one again" — a saved studio workout, carrying exactly what a
 * trainee recognises a session by: its shape (blocks/exercises), a few
 * movements as a memory hook, and when it was last done. Deliberately no
 * score/Rx badge (guidelines/studio-workout-entry.html) — a circuit has
 * none, and where one exists it's a stale number attached to a board that
 * may have since changed. Tapping the card IS the choice — no
 * select-then-confirm.
 */
export function StudioWorkoutCard({ workout, onPress }: { workout: StudioSessionSummary; onPress: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const meta = workout.blockCount > 0
    ? t('blocksAndExercises', { blocks: workout.blockCount, exercises: workout.exerciseCount })
    : t('exercisesCount', { count: workout.exerciseCount });
  const face = workout.intensity ? INTENSITY_LEVELS[workout.intensity - 1].glyph : null;

  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: theme.surface, borderRadius: radius.card, padding: spacing.md, overflow: 'hidden',
      }}
    >
      <View style={{ position: 'absolute', top: 0, bottom: 0, [dir === 'rtl' ? 'right' : 'left']: 0, width: 3, backgroundColor: theme.accent, opacity: 0.7 }} />
      <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'flex-start', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {workout.name}
          </Text>
          <Text style={{ color: theme.inkSoft, fontSize: 12, marginTop: 2, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {meta}
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

      <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm }}>
        <Ionicons name="time-outline" size={13} color={theme.inkSoft} />
        <Text style={{ color: theme.inkSoft, fontSize: 11 }}>{relativeTime(workout.savedAt, t)}</Text>
        {face && <Text style={{ fontSize: 14, marginInlineStart: 2 }}>{face}</Text>}
      </View>
    </Pressable>
  );
}
