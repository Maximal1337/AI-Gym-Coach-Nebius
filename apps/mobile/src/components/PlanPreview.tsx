import type { ReactNode } from 'react';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { callFn } from '../lib/api';
import { useTheme, spacing, radius } from '../theme';

export interface ParsedExercise {
  orderIndex: number; name: string; sets: number; repRange: string;
  restSec: number; intensity: string; warmup: string | null;
  equipmentType: string | null;
}
export interface ParsedPlan { name: string; exercises: ParsedExercise[] }

/**
 * The editable review/approve screen shared by every path that produces a
 * plan for approval — pasted (PlanPasteFlow), AI-generated
 * (GeneratePlanFlow, System Design §21) — so there is exactly one commit
 * path (`plan-import`'s `commit` action) and one place this UI can drift.
 * Extracted from PlanPasteFlow rather than duplicated.
 */
export function PlanPreview({
  preview, setPreview, mode, editPlanId, onDone, showTryAgain = true, extraNote,
}: {
  preview: ParsedPlan[];
  setPreview: (updater: (prev: ParsedPlan[] | null) => ParsedPlan[] | null) => void;
  mode: 'onboarding' | 'add' | 'edit';
  editPlanId?: string;
  onDone: () => void;
  showTryAgain?: boolean;
  /** Rendered directly above the approve button (e.g. the AI-generated disclaimer, linter warnings). */
  extraNote?: ReactNode;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  function updatePlanName(planIdx: number, name: string) {
    setPreview((prev) => prev && prev.map((p, i) => (i === planIdx ? { ...p, name } : p)));
  }

  function updateExercise(planIdx: number, exIdx: number, patch: Partial<ParsedExercise>) {
    setPreview(
      (prev) =>
        prev &&
        prev.map((p, i) =>
          i !== planIdx
            ? p
            : { ...p, exercises: p.exercises.map((e, j) => (j === exIdx ? { ...e, ...patch } : e)) },
        ),
    );
  }

  async function commit() {
    setBusy(true);
    try {
      await callFn('plan-import', {
        action: 'commit',
        plans: preview,
        ...(mode !== 'onboarding' ? { mode } : {}),
        ...(mode === 'edit' ? { editPlanId } : {}),
      });
      onDone();
    } catch {
      Alert.alert(t('coachUnavailable'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ScrollView style={{ flex: 1 }}>
        {preview.map((plan, planIdx) => (
          <View key={planIdx} style={{
            backgroundColor: theme.surface, borderRadius: radius.card,
            padding: spacing.md, marginBottom: spacing.sm,
          }}>
            <TextInput
              value={plan.name}
              onChangeText={(v) => updatePlanName(planIdx, v)}
              style={{ color: theme.ink, fontWeight: '700', textAlign: 'right', padding: 0 }}
            />
            <Text style={{ color: theme.inkSoft, fontSize: 12, textAlign: 'right', marginBottom: 6 }}>
              {t('exercisesCount', { count: plan.exercises.length })}
            </Text>
            {plan.exercises.map((e, exIdx) => (
              <View key={e.orderIndex} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: theme.inkSoft, fontSize: 13 }}>{e.orderIndex}.</Text>
                  <TextInput
                    value={e.name}
                    onChangeText={(v) => updateExercise(planIdx, exIdx, { name: v })}
                    style={{ flex: 1, color: theme.ink, fontSize: 13, textAlign: 'right', padding: 0 }}
                  />
                  <TextInput
                    value={String(e.sets)}
                    onChangeText={(v) => {
                      const n = parseInt(v, 10);
                      updateExercise(planIdx, exIdx, { sets: Number.isFinite(n) ? n : 0 });
                    }}
                    keyboardType="number-pad"
                    style={{ width: 28, color: theme.ink, fontSize: 13, textAlign: 'center', padding: 0 }}
                  />
                  <Text style={{ color: theme.inkSoft, fontSize: 13 }}>×</Text>
                  <TextInput
                    value={e.repRange}
                    onChangeText={(v) => updateExercise(planIdx, exIdx, { repRange: v })}
                    style={{ width: 48, color: theme.ink, fontSize: 13, textAlign: 'center', padding: 0 }}
                  />
                </View>
                <TextInput
                  value={e.warmup ?? ''}
                  onChangeText={(v) => updateExercise(planIdx, exIdx, { warmup: v.length > 0 ? v : null })}
                  placeholder={t('warmupPlaceholder')}
                  placeholderTextColor={theme.inkSoft}
                  style={{ color: theme.inkSoft, fontSize: 12, textAlign: 'right', padding: 0, marginTop: 2 }}
                />
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
      {extraNote}
      <Pressable
        disabled={busy}
        onPress={commit}
        style={{ backgroundColor: theme.accent, padding: 14, borderRadius: radius.pill, alignItems: 'center', marginTop: spacing.sm }}
      >
        <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{busy ? t('saving') : t('approveAndSave')}</Text>
      </Pressable>
      {showTryAgain && mode !== 'edit' && (
        <Pressable disabled={busy} onPress={() => setPreview(() => null)} style={{ padding: spacing.md, alignItems: 'center' }}>
          <Text style={{ color: theme.accent, fontWeight: '600' }}>{t('tryAgain')}</Text>
        </Pressable>
      )}
    </>
  );
}
