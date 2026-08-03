import { useEffect, useState } from 'react';
import { Alert, Keyboard, Pressable, Text, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { callFn } from '../lib/api';
import { supabase } from '../lib/supabase';
import { DismissKeyboardView } from './DismissKeyboardView';
import { PlanPreview, type ParsedPlan } from './PlanPreview';
import { useTheme, spacing, radius } from '../theme';

/**
 * Paste-and-parse plan flow (GYM-26), shared between first-run onboarding
 * and adding/editing a training type afterward (GYM-69) — same screen,
 * different commit semantics server-side (see plan-import's `mode`).
 */
export function PlanPasteFlow({
  mode, editPlanId, onDone,
}: {
  mode: 'onboarding' | 'add' | 'edit';
  editPlanId?: string;
  onDone: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ParsedPlan[] | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(mode === 'edit');

  // Editing an existing plan skips the paste-and-parse step entirely —
  // load its current exercises straight into the review/edit screen.
  useEffect(() => {
    if (mode !== 'edit' || !editPlanId) return;
    let cancelled = false;
    (async () => {
      setLoadingExisting(true);
      const [{ data: planRow }, { data: exRows }] = await Promise.all([
        supabase.from('training_plans').select('name').eq('id', editPlanId).single(),
        supabase
          .from('exercises')
          .select('order_index, name, sets, rep_range, rest_sec, intensity, warmup, equipment_type')
          .eq('plan_id', editPlanId)
          .eq('source', 'plan') // exclude session-only substitutions (System Design §20)
          .order('order_index'),
      ]);
      if (cancelled) return;
      if (planRow) {
        setPreview([
          {
            name: planRow.name,
            exercises: (exRows ?? []).map((e) => ({
              orderIndex: e.order_index,
              name: e.name,
              sets: e.sets,
              repRange: e.rep_range,
              restSec: e.rest_sec,
              intensity: e.intensity,
              warmup: e.warmup,
              equipmentType: e.equipment_type,
            })),
          },
        ]);
      } else {
        Alert.alert(t('coachUnavailable'));
      }
      setLoadingExisting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, editPlanId, t]);

  async function parse() {
    setBusy(true);
    try {
      const res = await callFn<{ plans: ParsedPlan[] }>('plan-import', { action: 'parse', text });
      setPreview(res.plans);
    } catch {
      Alert.alert(t('parseFailed'));
    } finally {
      setBusy(false);
    }
  }

  const stepLabel = mode === 'onboarding' ? t('planStep') : mode === 'edit' ? t('editPlanStep') : t('addPlanStep');

  return (
    <DismissKeyboardView style={{ padding: spacing.lg }}>
      <Text style={{ color: theme.inkSoft, fontSize: 12, fontWeight: '700', textAlign: 'right' }}>
        {stepLabel}
      </Text>
      <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', marginVertical: spacing.sm, textAlign: 'right' }}>
        {preview ? t('confirmPlanTitle') : t('planTitle')}
      </Text>

      {loadingExisting ? (
        <Text style={{ color: theme.inkSoft, textAlign: 'right' }}>{t('loading')}</Text>
      ) : !preview ? (
        <>
          <Text style={{ color: theme.inkSoft, marginBottom: spacing.md, textAlign: 'right' }}>
            {t('planSub')}
          </Text>
          <TextInput
            multiline
            placeholder={t('planPlaceholder')}
            placeholderTextColor={theme.inkSoft}
            value={text}
            onChangeText={setText}
            blurOnSubmit={false}
            style={{
              flex: 1, backgroundColor: theme.surface, borderRadius: radius.card,
              padding: spacing.md, color: theme.ink, textAlign: 'right', textAlignVertical: 'top',
            }}
          />
          <Pressable
            disabled={busy || text.length < 10}
            onPress={() => {
              Keyboard.dismiss();
              parse();
            }}
            style={{
              backgroundColor: text.length >= 10 ? theme.accent : theme.rule,
              padding: 14, borderRadius: radius.pill, alignItems: 'center', marginTop: spacing.md,
            }}
          >
            <Text style={{ color: text.length >= 10 ? theme.onAccent : theme.inkSoft, fontWeight: '700' }}>
              {busy ? t('parsing') : t('parsePlan')}
            </Text>
          </Pressable>
        </>
      ) : (
        <PlanPreview
          preview={preview}
          setPreview={setPreview}
          mode={mode}
          editPlanId={editPlanId}
          onDone={onDone}
        />
      )}
    </DismissKeyboardView>
  );
}
