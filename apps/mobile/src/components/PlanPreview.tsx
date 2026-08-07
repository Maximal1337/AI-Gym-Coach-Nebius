import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { callFn } from '../lib/api';
import { useLanguage } from '../lib/language';
import { useTheme, spacing, radius } from '../theme';
import { Button } from './Button';
import { ConfettiBurst } from './ConfettiBurst';
import { Field } from './Field';
import { LoadingOverlay } from './LoadingOverlay';
import { StartingWeightsStep, type StartingWeightsPlan } from './StartingWeightsStep';

export interface ParsedExercise {
  orderIndex: number; name: string; sets: number; repRange: string;
  restSec: number; intensity: string; warmup: string | null;
  equipmentType: string | null;
}
export interface ParsedPlan { name: string; exercises: ParsedExercise[] }

// Rough active-work estimate per set (execution + a beat to load/unload),
// added on top of the exercise's own rest — enough for the "~X min" summary
// to catch an obviously-wrong parse (2 exercises when 8 were pasted), not
// meant as a precise duration.
const AVG_ACTIVE_SECONDS_PER_SET = 40;

function totalSets(exercises: ParsedExercise[]): number {
  return exercises.reduce((sum, e) => sum + e.sets, 0);
}

function estimateMinutes(exercises: ParsedExercise[]): number {
  const totalSeconds = exercises.reduce((sum, e) => sum + e.sets * (e.restSec + AVG_ACTIVE_SECONDS_PER_SET), 0);
  return Math.max(5, Math.round(totalSeconds / 60 / 5) * 5);
}

function emptyExercise(orderIndex: number): ParsedExercise {
  return { orderIndex, name: '', sets: 3, repRange: '8-12', restSec: 90, intensity: '', warmup: null, equipmentType: null };
}

/**
 * A single exercise's editable fields, opened from a read-only row via a
 * bottom sheet (guidelines/plan-preview.html) — full-size 44px+ tap
 * targets instead of the ~34px inline field beds the old always-editable
 * rows used, and the keyboard never covers what you're typing since the
 * sheet scrolls independently. Edits are live-bound straight to the
 * parent's state (same pattern as the rest of this app's forms), so
 * "Save" just closes rather than committing a separate draft.
 */
function EditExerciseSheet({
  visible, exercise, onChange, onRemove, onClose,
}: {
  visible: boolean;
  exercise: ParsedExercise | null;
  onChange: (patch: Partial<ParsedExercise>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  if (!exercise) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(6,7,10,0.72)' }}
        onPress={onClose}
        accessibilityLabel={t('close')}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%' }}
      >
        <View style={{
          backgroundColor: theme.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden',
        }}>
          <View style={{
            flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'center',
            padding: spacing.md, borderBottomWidth: 1, borderBottomColor: theme.rule,
          }}>
            <Text
              style={{ flex: 1, color: theme.ink, fontWeight: '800', fontSize: 16, textAlign: dir === 'rtl' ? 'right' : 'left' }}
              numberOfLines={1}
            >
              {exercise.name || t('exerciseNamePlaceholder')}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={theme.inkSoft} />
            </Pressable>
          </View>
          <ScrollView style={{ padding: spacing.md }} keyboardShouldPersistTaps="handled">
            <Field
              label={t('exerciseNamePlaceholder')}
              value={exercise.name}
              onChangeText={(v) => onChange({ name: v })}
              style={{ marginBottom: spacing.sm }}
            />
            <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
              <Field
                label={t('setsPlaceholder')}
                value={String(exercise.sets)}
                keyboardType="number-pad"
                onChangeText={(v) => onChange({ sets: Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : 0 })}
                style={{ flex: 1 }}
              />
              <Field
                label={t('repRangePlaceholder')}
                value={exercise.repRange}
                onChangeText={(v) => onChange({ repRange: v })}
                style={{ flex: 1 }}
              />
            </View>
            <Field
              label={t('warmupPlaceholder')}
              value={exercise.warmup ?? ''}
              onChangeText={(v) => onChange({ warmup: v.length > 0 ? v : null })}
              style={{ marginBottom: spacing.lg }}
            />
            <Button block onPress={onClose}>{t('save')}</Button>
            <Button variant="destructive" block onPress={onRemove} style={{ marginTop: spacing.sm }}>
              {t('removeExercise')}
            </Button>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * The editable review/approve screen shared by every path that produces a
 * plan for approval — pasted (PlanPasteFlow), AI-generated
 * (GeneratePlanFlow, System Design §21) — so there is exactly one commit
 * path (`plan-import`'s `commit` action) and one place this UI can drift.
 * Extracted from PlanPasteFlow rather than duplicated.
 *
 * A verification screen, not a form (guidelines/plan-preview.html): the
 * user's job is to find the one row the parser got wrong, not read every
 * field equally. Rows are read-only text you scan (name, then sets ×
 * reps right-aligned in mono so the numbers form a column) — tapping one
 * opens the editable sheet, rather than every number sitting in its own
 * small always-open field bed. A summary line ("N exercises · N sets ·
 * ~N min") lets a wildly-wrong parse (2 exercises from an 8-exercise
 * paste) get caught before reading a single row.
 *
 * The design also calls for flagging which fields the parser had to
 * guess, with the source text alongside — that needs the parser to
 * return per-field confidence, which it doesn't today (a real backend
 * change, not a UI one). Shipping without it now; the layout degrades
 * cleanly, per the design's own guidance.
 */
export function PlanPreview({
  preview, setPreview, mode, editPlanId, onDone, showTryAgain = true, onTryAgain, tryAgainLabel, extraNote,
  onEnterStartingWeights,
}: {
  preview: ParsedPlan[];
  setPreview: (updater: (prev: ParsedPlan[] | null) => ParsedPlan[] | null) => void;
  mode: 'onboarding' | 'add' | 'edit';
  editPlanId?: string;
  onDone: () => void;
  showTryAgain?: boolean;
  /** Overrides what "Try again" does beyond clearing the preview — e.g. PlanPasteFlow uses this to re-open the file picker when the preview came from an upload, instead of always dropping back to the paste textbox. Defaults to just clearing the preview. */
  onTryAgain?: () => void;
  /** Overrides the "Try again" button's own label — e.g. PhotographPlanFlow's "Retake the photos", more specific than the generic default. */
  tryAgainLabel?: string;
  /** Rendered directly above the approve button (e.g. the AI-generated disclaimer, linter warnings). */
  extraNote?: ReactNode;
  /** Fires once, right when the starting-weights step is about to show — lets a caller that wraps this component in DismissKeyboardView switch it to `active={false}` for that step (see DismissKeyboardView's own doc comment for why). */
  onEnterStartingWeights?: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ planIdx: number; exIdx: number } | null>(null);
  const [startingWeightsPlans, setStartingWeightsPlans] = useState<StartingWeightsPlan[] | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);

  // Every "add a plan" route (generate/paste/upload/photo/manual) converges
  // here, so this is the one place a celebration can cover all of them at
  // once instead of being duplicated per-route (GeneratePlanFlow used to
  // have its own copy of this). Editing an existing plan isn't "finishing
  // adding" anything, so it skips this the same way it skips starting-weights.
  function celebrateAndFinish() {
    setShowConfetti(true);
    setTimeout(onDone, 1500);
  }

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

  function removeExercise(planIdx: number, exIdx: number) {
    setPreview(
      (prev) =>
        prev && prev.map((p, i) => (i !== planIdx ? p : { ...p, exercises: p.exercises.filter((_, j) => j !== exIdx) })),
    );
    setEditing(null);
  }

  function addExercise(planIdx: number) {
    const newIndex = preview[planIdx].exercises.length;
    setPreview(
      (prev) =>
        prev &&
        prev.map((p, i) => (i !== planIdx ? p : { ...p, exercises: [...p.exercises, emptyExercise(newIndex + 1)] })),
    );
    setEditing({ planIdx, exIdx: newIndex });
  }

  async function commit() {
    setBusy(true);
    try {
      const res = await callFn<{ plans: StartingWeightsPlan[] }>('plan-import', {
        action: 'commit',
        plans: preview,
        ...(mode !== 'onboarding' ? { mode } : {}),
        ...(mode === 'edit' ? { editPlanId } : {}),
      });
      // Editing an existing plan isn't "starting" anything new — skip
      // straight to onDone the way this already worked. Every other route
      // (onboarding/add, i.e. any brand-new plan) gets the one shared
      // starting-weights step (guidelines/starting-weights.html).
      if (mode === 'edit') {
        onDone();
      } else {
        setStartingWeightsPlans(res.plans);
        onEnterStartingWeights?.();
      }
    } catch {
      Alert.alert(t('coachUnavailable'));
    } finally {
      setBusy(false);
    }
  }

  if (startingWeightsPlans) {
    return (
      <>
        <StartingWeightsStep plans={startingWeightsPlans} onDone={celebrateAndFinish} />
        <ConfettiBurst active={showConfetti} />
      </>
    );
  }

  const editingExercise = editing ? preview[editing.planIdx]?.exercises[editing.exIdx] ?? null : null;

  return (
    <>
      <LoadingOverlay visible={busy} object="plate" label={t('saving')} />
      <ScrollView style={{ flex: 1 }}>
        {preview.map((plan, planIdx) => (
          <View key={planIdx} style={{
            backgroundColor: theme.surface, borderRadius: radius.card,
            padding: spacing.md, marginBottom: spacing.sm,
          }}>
            <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: spacing.sm }}>
              <TextInput
                value={plan.name}
                onChangeText={(v) => updatePlanName(planIdx, v)}
                style={{ flex: 1, color: theme.ink, fontWeight: '800', fontSize: 15, textAlign: dir === 'rtl' ? 'right' : 'left', padding: 0 }}
              />
              <Ionicons name="create-outline" size={16} color={theme.accent} />
            </View>
            <Text style={{
              color: theme.inkSoft, fontSize: 12, marginTop: 4, textAlign: dir === 'rtl' ? 'right' : 'left',
              fontVariant: ['tabular-nums'],
            }}>
              {t('planSummary', {
                exercises: plan.exercises.length,
                sets: totalSets(plan.exercises),
                minutes: estimateMinutes(plan.exercises),
              })}
            </Text>

            <View style={{ marginTop: spacing.sm }}>
              {plan.exercises.map((e, exIdx) => (
                <Pressable
                  key={exIdx}
                  onPress={() => { Keyboard.dismiss(); setEditing({ planIdx, exIdx }); }}
                  style={{
                    borderBottomWidth: exIdx === plan.exercises.length - 1 ? 0 : 1, borderBottomColor: theme.rule,
                    paddingVertical: 11,
                  }}
                >
                  <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: 10 }}>
                    <Text style={{ color: theme.inkSoft, fontSize: 12, width: 16, textAlign: 'center' }}>{exIdx + 1}</Text>
                    <Text
                      style={{ flex: 1, minWidth: 0, color: theme.ink, fontSize: 15, fontWeight: '700', textAlign: dir === 'rtl' ? 'right' : 'left' }}
                      numberOfLines={1}
                    >
                      {e.name || t('exerciseNamePlaceholder')}
                    </Text>
                    <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
                      {e.sets} × {e.repRange}
                    </Text>
                    <Ionicons name={dir === 'rtl' ? 'chevron-back' : 'chevron-forward'} size={14} color={theme.inkSoft} />
                  </View>
                  {e.warmup && (
                    <Text style={{
                      color: theme.inkSoft, fontSize: 12, marginTop: 3,
                      [dir === 'rtl' ? 'marginRight' : 'marginLeft']: 26,
                    }}>
                      {e.warmup}
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>
            <View style={{ marginTop: spacing.sm }}>
              <Button
                variant="dashed" size="md" block
                icon={<Ionicons name="add" size={15} color={theme.inkSoft} />}
                onPress={() => addExercise(planIdx)}
              >
                {t('addExercise')}
              </Button>
            </View>
          </View>
        ))}
      </ScrollView>
      {extraNote}
      <Button block disabled={busy} onPress={commit} style={{ marginTop: spacing.sm }}>
        {busy ? t('saving') : t('approveAndSave')}
      </Button>
      {showTryAgain && mode !== 'edit' && (
        <Button
          variant="quiet" block disabled={busy}
          onPress={() => (onTryAgain ? onTryAgain() : setPreview(() => null))}
        >
          {tryAgainLabel ?? t('tryAgain')}
        </Button>
      )}

      <EditExerciseSheet
        visible={editing !== null}
        exercise={editingExercise}
        onChange={(patch) => editing && updateExercise(editing.planIdx, editing.exIdx, patch)}
        onRemove={() => editing && removeExercise(editing.planIdx, editing.exIdx)}
        onClose={() => setEditing(null)}
      />
    </>
  );
}
