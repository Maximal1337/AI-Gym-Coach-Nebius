import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, radius } from '../theme';

interface SetRow { kg: string; reps: string }

function initialRows(weightKg: number, targetReps: number[]): SetRow[] {
  return targetReps.map((reps) => ({ kg: String(weightKg), reps: String(reps) }));
}

/** Rounds away the float noise repeated +/- taps would otherwise accumulate. */
function clampStep(n: number): number {
  return Math.max(0, Math.round(n * 100) / 100);
}

function Stepper({
  value, onChange, step, disabled, suffix,
}: {
  value: string;
  onChange: (v: string) => void;
  step: number;
  disabled?: boolean;
  suffix: string;
}) {
  const theme = useTheme();

  function bump(delta: number) {
    const n = parseFloat(value);
    onChange(String(clampStep((Number.isFinite(n) ? n : 0) + delta)));
  }

  const btnStyle = {
    width: 28, height: 28, borderRadius: radius.field, backgroundColor: theme.bg,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    opacity: disabled ? 0.5 : 1,
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Pressable disabled={disabled} onPress={() => bump(-step)} style={btnStyle} hitSlop={4}>
        <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 15 }}>−</Text>
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        editable={!disabled}
        style={{
          width: 44, backgroundColor: theme.bg, borderRadius: radius.field, padding: 6,
          color: theme.ink, textAlign: 'center', fontSize: 13,
        }}
      />
      <Pressable disabled={disabled} onPress={() => bump(step)} style={btnStyle} hitSlop={4}>
        <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 15 }}>+</Text>
      </Pressable>
      <Text style={{ color: theme.inkSoft, fontSize: 12 }}>{suffix}</Text>
    </View>
  );
}

/**
 * Generative-UI suggested action (System Design §19): pinned above the
 * composer (not inline in the message list) so it reads as part of the
 * input controls, not as just another chat bubble. Pure props in, pure
 * callbacks out — no Supabase/session knowledge here.
 *
 * Both actions are deterministic on the server for the numbers (only the
 * reply text goes through the LLM). Fields are pre-filled with the
 * suggested numbers as real, editable values (not placeholders) so "send
 * exactly this" needs zero taps, while +/- steppers make a quick nudge
 * (a plate short, one more rep) faster than retyping the whole number.
 */
export function SuggestedActionBar({
  weightKg,
  targetReps,
  disabled,
  onConfirmExact,
  onSubmitSets,
}: {
  weightKg: number;
  targetReps: number[];
  disabled?: boolean;
  onConfirmExact: () => void;
  onSubmitSets: (sets: Array<{ weightKg: number; reps: number }>) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [rows, setRows] = useState<SetRow[]>(() => initialRows(weightKg, targetReps));

  // A new suggestion (different exercise, or a renegotiated target) should
  // reset any in-progress edits rather than keep showing stale numbers.
  useEffect(() => {
    setRows(initialRows(weightKg, targetReps));
  }, [weightKg, targetReps.join(',')]);

  function updateRow(i: number, patch: Partial<SetRow>) {
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  const parsedSets = rows.map((r) => ({ weightKg: parseFloat(r.kg), reps: parseInt(r.reps, 10) }));
  const allValid = parsedSets.every(
    (s) => Number.isFinite(s.weightKg) && s.weightKg >= 0 && Number.isInteger(s.reps) && s.reps >= 0,
  );

  return (
    <View style={{
      backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.rule,
      padding: spacing.md, gap: 8,
    }}>
      <Pressable
        disabled={disabled}
        onPress={onConfirmExact}
        style={{
          backgroundColor: theme.accent, paddingVertical: 12, borderRadius: radius.pill,
          alignItems: 'center', opacity: disabled ? 0.5 : 1,
        }}
      >
        <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{t('confirmExactAction')}</Text>
      </Pressable>

      <View style={{ gap: 6 }}>
        {rows.map((row, i) => (
          <View key={i} style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <Text style={{ color: theme.inkSoft, fontSize: 12, width: 14, textAlign: 'center' }}>{i + 1}.</Text>
            <Stepper
              value={row.kg}
              onChange={(v) => updateRow(i, { kg: v })}
              step={1}
              disabled={disabled}
              suffix={t('kgLabel')}
            />
            <Stepper
              value={row.reps}
              onChange={(v) => updateRow(i, { reps: v })}
              step={1}
              disabled={disabled}
              suffix={t('repsLabel')}
            />
          </View>
        ))}
      </View>

      <Pressable
        disabled={disabled || !allValid}
        onPress={() => onSubmitSets(parsedSets)}
        style={{
          backgroundColor: allValid ? theme.accent : theme.rule, paddingVertical: 10,
          borderRadius: radius.pill, alignItems: 'center',
        }}
      >
        <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{t('send')}</Text>
      </Pressable>
    </View>
  );
}
