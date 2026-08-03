import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../lib/language';
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
  value, onChange, step, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  step: number;
  disabled?: boolean;
}) {
  const theme = useTheme();

  function bump(delta: number) {
    const n = parseFloat(value);
    onChange(String(clampStep((Number.isFinite(n) ? n : 0) + delta)));
  }

  const btnStyle = {
    width: 32, height: 32, borderRadius: radius.field, backgroundColor: theme.bg,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    opacity: disabled ? 0.5 : 1,
  };

  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Pressable disabled={disabled} onPress={() => bump(-step)} style={btnStyle} hitSlop={4}>
        <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 17 }}>−</Text>
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        editable={!disabled}
        style={{
          flex: 1, marginHorizontal: 4, backgroundColor: theme.bg, borderRadius: radius.field, padding: 6,
          color: theme.ink, textAlign: 'center', fontSize: 15,
        }}
      />
      <Pressable disabled={disabled} onPress={() => bump(step)} style={btnStyle} hitSlop={4}>
        <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 17 }}>+</Text>
      </Pressable>
    </View>
  );
}

/**
 * Generative-UI suggested action (System Design §19): pinned above the
 * composer (not inline in the message list) so it reads as part of the
 * input controls, not as just another chat bubble. Pure props in, pure
 * callbacks out — no Supabase/session knowledge here.
 *
 * The numbers are deterministic on the server (only the reply text goes
 * through the LLM). Fields are pre-filled with the suggested numbers as
 * real, editable values (not placeholders) so "send exactly this" needs
 * zero taps, while +/- steppers make a quick nudge (a plate short, one
 * more rep) faster than retyping the whole number.
 */
export function SuggestedActionBar({
  weightKg,
  targetReps,
  disabled,
  onSubmitSets,
}: {
  weightKg: number;
  targetReps: number[];
  disabled?: boolean;
  onSubmitSets: (sets: Array<{ weightKg: number; reps: number }>) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
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
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2,
    }}>
      <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: 8 }}>
        <Text style={{ width: 14 }} />
        <Text style={{ flex: 1, color: theme.inkSoft, fontSize: 11, lineHeight: 13, textAlign: 'center' }}>
          {t('kgLabel')}
        </Text>
        <Text style={{ flex: 1, color: theme.inkSoft, fontSize: 11, lineHeight: 13, textAlign: 'center' }}>
          {t('repsLabel')}
        </Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: 10, alignItems: 'stretch' }}>
        <View style={{ flex: 1, gap: 6 }}>
          {rows.map((row, i) => (
            <View key={i} style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: theme.inkSoft, fontSize: 12, width: 14, textAlign: 'center' }}>{i + 1}.</Text>
              <Stepper
                value={row.kg}
                onChange={(v) => updateRow(i, { kg: v })}
                step={1}
                disabled={disabled}
              />
              <Stepper
                value={row.reps}
                onChange={(v) => updateRow(i, { reps: v })}
                step={1}
                disabled={disabled}
              />
            </View>
          ))}
        </View>

        <Pressable
          disabled={disabled || !allValid}
          onPress={() => onSubmitSets(parsedSets)}
          style={{
            width: 48,
            backgroundColor: allValid ? theme.accent : theme.rule,
            borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Ionicons name="send" size={20} color={theme.onAccent} style={dir === 'rtl' ? { transform: [{ scaleX: -1 }] } : undefined} />
        </Pressable>
      </View>
    </View>
  );
}
