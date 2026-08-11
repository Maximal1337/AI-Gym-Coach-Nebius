import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { callFn, ApiError } from '../lib/api';
import { ConfettiBurst } from './ConfettiBurst';
import { DismissKeyboardView } from './DismissKeyboardView';
import { LoadingOverlay } from './LoadingOverlay';
import { StartingWeightsStep, type StartingWeightsPlan } from './StartingWeightsStep';
import { useLanguage } from '../lib/language';
import { track } from '../lib/analytics';
import { useTheme, spacing, radius } from '../theme';

interface ManualExercise {
  name: string;
  sets: string;
  repRange: string;
  note: string;
  warmup: string;
}

function emptyExercise(): ManualExercise {
  return { name: '', sets: '', repRange: '', note: '', warmup: '' };
}

/**
 * Structured, from-scratch alternative to paste-and-parse (GYM feedback):
 * the user builds a plan by filling one form per exercise instead of
 * relying on the LLM to understand free text. Submits through the same
 * plan-import "commit" action as the paste flow — no server-side change
 * needed, this is purely a different way to arrive at the same payload.
 */
export function ManualPlanForm({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const [planName, setPlanName] = useState('');
  const [exercises, setExercises] = useState<ManualExercise[]>([emptyExercise()]);
  const [busy, setBusy] = useState(false);
  const [startingWeightsPlans, setStartingWeightsPlans] = useState<StartingWeightsPlan[] | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);

  function celebrateAndFinish() {
    setShowConfetti(true);
    setTimeout(onDone, 1500);
  }

  function updateExercise(idx: number, patch: Partial<ManualExercise>) {
    setExercises((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeExercise(idx: number) {
    setExercises((rows) => rows.filter((_, i) => i !== idx));
  }

  async function save() {
    track('manual_plan_save_tapped');
    if (!planName.trim()) {
      Alert.alert(t('manualPlanNoName'));
      return;
    }
    const filled = exercises.filter((e) => e.name.trim().length > 0);
    if (filled.length === 0) {
      Alert.alert(t('manualPlanEmpty'));
      return;
    }
    for (const e of filled) {
      const sets = parseInt(e.sets, 10);
      if (!Number.isFinite(sets) || sets < 1 || !e.repRange.trim()) {
        Alert.alert(t('manualPlanInvalid'));
        return;
      }
    }

    setBusy(true);
    try {
      const res = await callFn<{ plans: StartingWeightsPlan[] }>('plan-import', {
        action: 'commit',
        mode: 'add',
        plans: [
          {
            name: planName.trim(),
            exercises: filled.map((e, i) => ({
              orderIndex: i + 1,
              name: e.name.trim(),
              sets: parseInt(e.sets, 10),
              repRange: e.repRange.trim(),
              restSec: 60,
              intensity: e.note.trim(),
              warmup: e.warmup.trim() ? e.warmup.trim() : null,
              equipmentType: null,
            })),
          },
        ],
      });
      setStartingWeightsPlans(res.plans);
    } catch (e) {
      Alert.alert(e instanceof ApiError ? t('coachUnavailable') : t('manualPlanInvalid'));
    } finally {
      setBusy(false);
    }
  }

  if (startingWeightsPlans) {
    return (
      <View style={{ flex: 1, padding: spacing.lg }}>
        <StartingWeightsStep plans={startingWeightsPlans} onDone={celebrateAndFinish} />
        <ConfettiBurst active={showConfetti} />
      </View>
    );
  }

  return (
    <DismissKeyboardView style={{ padding: spacing.lg }}>
      <LoadingOverlay visible={busy} object="plate" label={t('saving')} />
      <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', marginBottom: spacing.sm, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
        {t('manualPlanTitle')}
      </Text>
      <Text style={{ color: theme.inkSoft, marginBottom: spacing.md, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
        {t('manualPlanSub')}
      </Text>

      <TextInput
        value={planName}
        onChangeText={setPlanName}
        placeholder={t('planNamePlaceholder')}
        placeholderTextColor={theme.inkSoft}
        style={{
          backgroundColor: theme.surface, borderRadius: radius.card, padding: spacing.md,
          color: theme.ink, textAlign: dir === 'rtl' ? 'right' : 'left', fontWeight: '700', marginBottom: spacing.md,
        }}
      />

      <ScrollView style={{ flex: 1 }}>
        {exercises.map((e, idx) => (
          <View key={idx} style={{
            backgroundColor: theme.surface, borderRadius: radius.card,
            padding: spacing.md, marginBottom: spacing.sm, gap: 8,
          }}>
            <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: theme.inkSoft, fontSize: 12 }}>{idx + 1}.</Text>
              <TextInput
                value={e.name}
                onChangeText={(v) => updateExercise(idx, { name: v })}
                placeholder={t('exerciseNamePlaceholder')}
                placeholderTextColor={theme.inkSoft}
                style={{ flex: 1, color: theme.ink, fontWeight: '700', textAlign: dir === 'rtl' ? 'right' : 'left', padding: 0 }}
              />
              <Pressable onPress={() => { track('manual_plan_remove_exercise_tapped'); removeExercise(idx); }} hitSlop={8}>
                <Text style={{ color: theme.critical, fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>

            <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: 8 }}>
              <TextInput
                value={e.sets}
                onChangeText={(v) => updateExercise(idx, { sets: v })}
                placeholder={t('setsPlaceholder')}
                placeholderTextColor={theme.inkSoft}
                keyboardType="number-pad"
                style={{
                  flex: 1, backgroundColor: theme.bg, borderRadius: radius.field, padding: 8,
                  color: theme.ink, textAlign: dir === 'rtl' ? 'right' : 'left', fontSize: 13,
                }}
              />
              <TextInput
                value={e.repRange}
                onChangeText={(v) => updateExercise(idx, { repRange: v })}
                placeholder={t('repRangePlaceholder')}
                placeholderTextColor={theme.inkSoft}
                style={{
                  flex: 1, backgroundColor: theme.bg, borderRadius: radius.field, padding: 8,
                  color: theme.ink, textAlign: dir === 'rtl' ? 'right' : 'left', fontSize: 13,
                }}
              />
            </View>

            <TextInput
              value={e.warmup}
              onChangeText={(v) => updateExercise(idx, { warmup: v })}
              placeholder={t('warmupPlaceholder')}
              placeholderTextColor={theme.inkSoft}
              style={{
                backgroundColor: theme.bg, borderRadius: radius.field, padding: 8,
                color: theme.ink, textAlign: dir === 'rtl' ? 'right' : 'left', fontSize: 13,
              }}
            />
            <TextInput
              value={e.note}
              onChangeText={(v) => updateExercise(idx, { note: v })}
              placeholder={t('notePlaceholder')}
              placeholderTextColor={theme.inkSoft}
              maxLength={150}
              style={{
                backgroundColor: theme.bg, borderRadius: radius.field, padding: 8,
                color: theme.ink, textAlign: dir === 'rtl' ? 'right' : 'left', fontSize: 13,
              }}
            />
          </View>
        ))}

        <Pressable
          onPress={() => { track('manual_plan_add_exercise_tapped'); setExercises((rows) => [...rows, emptyExercise()]); }}
          style={{
            borderWidth: 1, borderColor: theme.accent, borderStyle: 'dashed', borderRadius: radius.card,
            padding: spacing.sm, alignItems: 'center', marginBottom: spacing.md,
          }}
        >
          <Text style={{ color: theme.accent, fontWeight: '700' }}>{t('addExercise')}</Text>
        </Pressable>
      </ScrollView>

      <Pressable
        disabled={busy}
        onPress={save}
        style={{ backgroundColor: theme.accent, padding: 14, borderRadius: radius.pill, alignItems: 'center', marginTop: spacing.sm }}
      >
        <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{busy ? t('saving') : t('savePlan')}</Text>
      </Pressable>
    </DismissKeyboardView>
  );
}
