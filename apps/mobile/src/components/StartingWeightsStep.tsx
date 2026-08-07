import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { callFn } from '../lib/api';
import { useLanguage } from '../lib/language';
import { useUnits, parseWeightToKg, weightUnitLabel } from '../lib/units';
import { useTheme, spacing, radius } from '../theme';
import { Button } from './Button';
import { Badge } from './Badge';
import { LoadingOverlay } from './LoadingOverlay';

export interface StartingWeightsExercise { id: string; name: string; sets: number; repRange: string }
export interface StartingWeightsPlan { id: string; name: string; exercises: StartingWeightsExercise[] }

interface Row { weight: string; reps: string }

function lowEnd(repRange: string): string {
  const first = repRange.split('-')[0]?.trim() ?? '';
  return /^\d+$/.test(first) ? first : '';
}

function NumField({
  value, placeholder, unit, dim, onChangeText,
}: {
  value: string;
  placeholder: string;
  unit?: string;
  dim?: boolean;
  onChangeText: (v: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'baseline', gap: 3, backgroundColor: theme.surface,
      borderRadius: radius.field, paddingVertical: 7, paddingHorizontal: 8, width: unit ? 58 : 42, justifyContent: 'center',
    }}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.inkSoft}
        keyboardType="decimal-pad"
        maxLength={6}
        style={{
          width: unit ? 26 : 34, padding: 0, textAlign: 'center', fontSize: 14, fontWeight: '500',
          color: dim ? theme.inkSoft : theme.ink,
        }}
      />
      {unit && <Text style={{ fontSize: 10.5, color: theme.inkSoft }}>{unit}</Text>}
    </View>
  );
}

function StartingWeightRow({
  exercise, row, unit, onChange,
}: {
  exercise: StartingWeightsExercise;
  row: Row;
  unit: string;
  onChange: (patch: Partial<Row>) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const filled = row.weight.trim().length > 0;

  return (
    <View style={{
      flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: spacing.sm,
      paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: theme.rule,
    }}>
      <View style={{ width: 18, alignItems: 'center', justifyContent: 'center' }}>
        {filled ? (
          <Ionicons name="checkmark-circle" size={17} color={theme.accent} />
        ) : (
          <View style={{ width: 7, height: 7, borderRadius: 4, borderWidth: 1.5, borderColor: theme.rule }} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: theme.ink, fontSize: 14, fontWeight: '600', textAlign: dir === 'rtl' ? 'right' : 'left' }}>
          {exercise.name}
        </Text>
        <Text style={{ color: theme.inkSoft, fontSize: 11.5, marginTop: 1, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
          {t('planLine', { sets: exercise.sets, reps: exercise.repRange })}
        </Text>
      </View>
      <NumField value={row.weight} placeholder="—" unit={unit} onChangeText={(v) => onChange({ weight: v })} />
      <Text style={{ color: theme.inkSoft, fontSize: 13 }}>×</Text>
      <NumField value={row.reps} placeholder={lowEnd(exercise.repRange) || '—'} dim={!filled} onChangeText={(v) => onChange({ reps: v })} />
    </View>
  );
}

/**
 * "Where are you starting from?" (guidelines/starting-weights.html): one
 * optional step after the plan preview, before the first workout — the
 * single place across all four plan-creation routes (generate, paste,
 * upload, manual build) that asks what you lift, so it only has to be
 * asked once. Nothing here is required; the primary button never
 * disables, it just changes label depending on whether anything's filled.
 *
 * Data side: a filled row becomes one `set_logs` row on a synthetic
 * `imported` session (same shape history-import already writes) — the
 * coach's existing cold-start read of "last time" picks it up with no
 * special-cased "starting weight" concept of its own. A skipped exercise
 * and one with no history yet are the same state, so nothing is written
 * for rows left blank.
 */
export function StartingWeightsStep({
  plans, onDone,
}: {
  plans: StartingWeightsPlan[];
  onDone: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const { units } = useUnits();
  const exercises = plans.flatMap((p) => p.exercises);
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(exercises.map((e) => [e.id, { weight: '', reps: '' }])));
  const [busy, setBusy] = useState(false);

  const filledCount = exercises.filter((e) => rows[e.id]?.weight.trim().length > 0).length;

  function updateRow(exerciseId: string, patch: Partial<Row>) {
    setRows((r) => ({ ...r, [exerciseId]: { ...r[exerciseId], ...patch } }));
  }

  async function submit() {
    const entries = exercises
      .map((e) => {
        const row = rows[e.id];
        const weightKg = parseWeightToKg(row.weight, units);
        const repsRaw = row.reps.trim() || lowEnd(e.repRange);
        const reps = parseInt(repsRaw, 10);
        if (weightKg === null || weightKg < 0 || !Number.isInteger(reps) || reps < 1) return null;
        return { exerciseId: e.id, weightKg, reps };
      })
      .filter((e): e is { exerciseId: string; weightKg: number; reps: number } => e !== null);

    if (entries.length === 0) {
      onDone();
      return;
    }
    setBusy(true);
    try {
      await callFn('plan-import', { action: 'seed-starting-weights', entries });
      onDone();
    } catch {
      Alert.alert(t('coachUnavailable'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <LoadingOverlay visible={busy} object="plate" label={t('saving')} />
      <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 }}>{t('startingTitle')}</Text>
        <Badge tone="neutral">{t('startingOptional')}</Badge>
      </View>
      <Text style={{ color: theme.inkSoft, fontSize: 14.5, lineHeight: 21, marginTop: 4, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
        {t('startingSub')}
      </Text>

      <ScrollView style={{ flex: 1, marginTop: spacing.md }}>
        <View style={{
          flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', justifyContent: 'space-between',
          paddingBottom: 2,
        }}>
          <Text style={{ color: theme.inkSoft, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            {t('exerciseNamePlaceholder')}
          </Text>
          <Text style={{ color: theme.inkSoft, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            {t('lastSetLabel')}
          </Text>
        </View>
        {exercises.map((e) => (
          <StartingWeightRow
            key={e.id}
            exercise={e}
            row={rows[e.id]}
            unit={weightUnitLabel(units)}
            onChange={(patch) => updateRow(e.id, patch)}
          />
        ))}
        {filledCount === 0 && (
          <Text style={{ color: theme.inkSoft, fontSize: 12.5, marginTop: spacing.md, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {t('startingEmpty')}
          </Text>
        )}
      </ScrollView>

      <View style={{ paddingTop: spacing.sm, gap: spacing.sm }}>
        <Button block disabled={busy} onPress={submit}>
          {t('startingContinue')}
        </Button>
        <Button variant="quiet" block disabled={busy} onPress={onDone}>
          {t('startingSkip')}
        </Button>
      </View>
    </View>
  );
}
