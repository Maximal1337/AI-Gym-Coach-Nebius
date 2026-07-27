import { useState } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { callFn } from '../lib/api';
import { DismissKeyboardView } from './DismissKeyboardView';
import { useTheme, spacing, radius } from '../theme';

interface ParsedExercise {
  orderIndex: number; name: string; sets: number; repRange: string;
  restSec: number; intensity: string; warmup: string | null;
}
interface ParsedPlan { name: string; exercises: ParsedExercise[] }

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

  async function commit() {
    if (!preview) return;
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

  const stepLabel = mode === 'onboarding' ? t('planStep') : mode === 'edit' ? t('editPlanStep') : t('addPlanStep');

  return (
    <DismissKeyboardView style={{ padding: spacing.lg }}>
      <Text style={{ color: theme.inkSoft, fontSize: 12, fontWeight: '700', textAlign: 'right' }}>
        {stepLabel}
      </Text>
      <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', marginVertical: spacing.sm, textAlign: 'right' }}>
        {preview ? t('confirmPlanTitle') : t('planTitle')}
      </Text>

      {!preview ? (
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
        <>
          <ScrollView style={{ flex: 1 }}>
            {preview.map((plan) => (
              <View key={plan.name} style={{
                backgroundColor: theme.surface, borderRadius: radius.card,
                padding: spacing.md, marginBottom: spacing.sm,
              }}>
                <Text style={{ color: theme.ink, fontWeight: '700', textAlign: 'right' }}>{plan.name}</Text>
                <Text style={{ color: theme.inkSoft, fontSize: 12, textAlign: 'right', marginBottom: 6 }}>
                  {t('exercisesCount', { count: plan.exercises.length })}
                </Text>
                {plan.exercises.map((e) => (
                  <Text key={e.orderIndex} style={{ color: theme.ink, fontSize: 13, textAlign: 'right', marginBottom: 2 }}>
                    {e.orderIndex}. {e.name} — {e.sets}×{e.repRange}
                  </Text>
                ))}
              </View>
            ))}
          </ScrollView>
          <Pressable
            disabled={busy}
            onPress={commit}
            style={{ backgroundColor: theme.accent, padding: 14, borderRadius: radius.pill, alignItems: 'center', marginTop: spacing.sm }}
          >
            <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{t('approveAndSave')}</Text>
          </Pressable>
          <Pressable disabled={busy} onPress={() => setPreview(null)} style={{ padding: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: theme.accent, fontWeight: '600' }}>{t('tryAgain')}</Text>
          </Pressable>
        </>
      )}
    </DismissKeyboardView>
  );
}
