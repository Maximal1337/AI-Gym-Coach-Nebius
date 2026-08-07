import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../lib/language';
import {
  useUnits, formatWeightKg, formatHeightForEntry, parseWeightToKg, parseHeightToCm, weightUnitLabel,
} from '../lib/units';
import { Field } from './Field';
import { useTheme, spacing, radius } from '../theme';

type Gender = 'male' | 'female' | 'other';

export interface FitnessProfileValues {
  gender: Gender | null;
  age: string;
  weightKg: string;
  heightCm: string;
}

/**
 * Editing the "קצת עליך" facts collected during AI plan generation (System
 * Design §21) — only reachable from Settings when a fitness_profiles row
 * already exists, so this is always an UPDATE of gender/age/weight/height,
 * never touches primary_goal/experience_level/days_per_week.
 */
export function FitnessProfileForm({
  initial, onDone,
}: {
  initial: FitnessProfileValues;
  onDone: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const { units } = useUnits();
  const [gender, setGender] = useState<Gender | null>(initial.gender);
  const [age, setAge] = useState(initial.age);
  // Stored values arrive in kg/cm; the editable field shows/accepts
  // whatever the user's current unit is, converted on the way in and out.
  const [weightInput, setWeightInput] = useState(
    () => (initial.weightKg.trim() ? String(formatWeightKg(parseFloat(initial.weightKg), units)) : ''),
  );
  const [heightInput, setHeightInput] = useState(
    () => (initial.heightCm.trim() ? formatHeightForEntry(parseFloat(initial.heightCm), units) : ''),
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return;
    const { error } = await supabase.from('fitness_profiles').update({
      gender,
      age: age.trim() ? parseInt(age, 10) : null,
      weight_kg: weightInput.trim() ? parseWeightToKg(weightInput, units) : null,
      height_cm: heightInput.trim() ? parseHeightToCm(heightInput, units) : null,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId);
    setBusy(false);
    if (error) return Alert.alert(t('coachUnavailable'));
    onDone();
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: spacing.lg }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', marginBottom: spacing.md, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
        {t('editProfileTitle')}
      </Text>

      <Text style={{ color: theme.inkSoft, fontSize: 11, fontWeight: '600', textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: 6 }}>
        {t('genderLabel')}
      </Text>
      <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: 6, marginBottom: spacing.md }}>
        {(['male', 'female', 'other'] as Gender[]).map((g) => (
          <Pressable
            key={g}
            onPress={() => setGender(gender === g ? null : g)}
            style={{
              flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.field,
              backgroundColor: theme.surface, borderWidth: 1.5,
              borderColor: gender === g ? theme.accent : 'transparent',
            }}
          >
            <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 12.5 }}>{t(`gender_${g}`)}</Text>
          </Pressable>
        ))}
      </View>

      <Field
        label={t('ageLabel')}
        placeholder={t('agePlaceholder')}
        value={age}
        onChangeText={setAge}
        keyboardType="number-pad"
        style={{ marginBottom: spacing.sm }}
      />
      <Field
        label={t('weightLabel')}
        placeholder={units === 'metric' ? t('weightPlaceholder') : t('weightPlaceholderImperial')}
        value={weightInput}
        onChangeText={setWeightInput}
        keyboardType="decimal-pad"
        unit={weightUnitLabel(units)}
        style={{ marginBottom: spacing.sm }}
      />
      <Field
        label={t('heightLabel')}
        placeholder={units === 'metric' ? t('heightPlaceholder') : t('heightPlaceholderImperial')}
        value={heightInput}
        onChangeText={setHeightInput}
        keyboardType="decimal-pad"
        unit={units === 'metric' ? t('cmLabel') : t('inLabel')}
        style={{ marginBottom: spacing.sm }}
      />

      <Pressable
        disabled={busy}
        onPress={save}
        style={{ backgroundColor: theme.accent, padding: 14, borderRadius: radius.pill, alignItems: 'center', marginTop: spacing.sm }}
      >
        <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{busy ? t('saving') : t('save')}</Text>
      </Pressable>
    </ScrollView>
  );
}
