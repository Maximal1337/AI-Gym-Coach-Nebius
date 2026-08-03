import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
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
  const [gender, setGender] = useState<Gender | null>(initial.gender);
  const [age, setAge] = useState(initial.age);
  const [weightKg, setWeightKg] = useState(initial.weightKg);
  const [heightCm, setHeightCm] = useState(initial.heightCm);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return;
    const { error } = await supabase.from('fitness_profiles').update({
      gender,
      age: age.trim() ? parseInt(age, 10) : null,
      weight_kg: weightKg.trim() ? parseFloat(weightKg) : null,
      height_cm: heightCm.trim() ? parseFloat(heightCm) : null,
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
      <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', marginBottom: spacing.md, textAlign: 'right' }}>
        {t('editProfileTitle')}
      </Text>

      <Text style={{ color: theme.inkSoft, fontSize: 11, fontWeight: '600', textAlign: 'right', marginBottom: 6 }}>
        {t('genderLabel')}
      </Text>
      <View style={{ flexDirection: 'row-reverse', gap: 6, marginBottom: spacing.md }}>
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

      {[
        { label: t('ageLabel'), placeholder: t('agePlaceholder'), value: age, onChange: setAge },
        { label: t('weightLabel'), placeholder: t('weightPlaceholder'), value: weightKg, onChange: setWeightKg },
        { label: t('heightLabel'), placeholder: t('heightPlaceholder'), value: heightCm, onChange: setHeightCm },
      ].map((f) => (
        <View key={f.label} style={{ marginBottom: spacing.sm }}>
          <Text style={{ color: theme.inkSoft, fontSize: 11, fontWeight: '600', textAlign: 'right', marginBottom: 6 }}>
            {f.label}
          </Text>
          <TextInput
            value={f.value}
            onChangeText={f.onChange}
            placeholder={f.placeholder}
            placeholderTextColor={theme.inkSoft}
            keyboardType="number-pad"
            style={{
              backgroundColor: theme.surface, borderRadius: radius.field, padding: 12,
              color: theme.ink, textAlign: 'right',
            }}
          />
        </View>
      ))}

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
