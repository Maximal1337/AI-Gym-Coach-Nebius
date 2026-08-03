import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../src/lib/supabase';
import { callFn } from '../../src/lib/api';
import { Screen } from '../../src/components/Screen';
import { useTheme, spacing, radius, TAB_BAR_CLEARANCE } from '../../src/theme';

const BUDGET_CENTS = Number(process.env.EXPO_PUBLIC_MONTHLY_BUDGET_CENTS ?? '8');
const APPROX_CENTS_PER_WORKOUT = 0.6;

export default function Settings() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [coach, setCoach] = useState<{ coach_name: string; tone_preset: string } | null>(null);
  const [spentCents, setSpentCents] = useState(0);
  // null = not loaded yet / no row at all — the section only renders once
  // this is a real row (System Design §21: appears only if the user
  // actually typed something in "קצת עליך", never as an empty prompt).
  const [fitnessProfile, setFitnessProfile] = useState<{
    gender: string | null; age: number | null; weight_kg: number | null; height_cm: number | null;
  } | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const period = new Date().toISOString().slice(0, 7);
        const [{ data: profile }, { data: usage }, { data: fitness }] = await Promise.all([
          supabase.from('coach_profiles').select('coach_name, tone_preset').maybeSingle(),
          supabase.from('usage_ledger').select('cost_cents').eq('period', period).maybeSingle(),
          supabase.from('fitness_profiles').select('gender, age, weight_kg, height_cm').maybeSingle(),
        ]);
        setCoach(profile);
        setSpentCents(Number(usage?.cost_cents ?? 0));
        setFitnessProfile(fitness ?? null);
      })();
    }, []),
  );

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/sign-in');
  }

  function confirmDelete() {
    Alert.alert(t('deleteConfirmTitle'), t('deleteConfirmBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await callFn('account-delete', {});
            await supabase.auth.signOut();
            router.replace('/sign-in');
          } catch {
            Alert.alert(t('coachUnavailable'));
          }
        },
      },
    ]);
  }

  const used = Math.min(
    Math.round(spentCents / APPROX_CENTS_PER_WORKOUT),
    Math.round(BUDGET_CENTS / APPROX_CENTS_PER_WORKOUT),
  );
  const total = Math.round(BUDGET_CENTS / APPROX_CENTS_PER_WORKOUT);

  const row = (label: string, value?: string, onPress?: () => void, destructive = false) => (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={{
        flexDirection: 'row-reverse', justifyContent: 'space-between',
        padding: spacing.md, borderBottomWidth: 1, borderBottomColor: theme.rule,
      }}
    >
      <Text style={{ color: destructive ? theme.critical : theme.ink, fontWeight: destructive ? '700' : '400' }}>
        {label}
      </Text>
      {value && <Text style={{ color: theme.inkSoft }}>{value}</Text>}
    </Pressable>
  );

  return (
    <Screen>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.md, paddingBottom: TAB_BAR_CLEARANCE }}>
      <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: 'right', marginBottom: spacing.md }}>
        {t('settingsTitle')}
      </Text>

      <Text style={{ color: theme.inkSoft, fontSize: 11, fontWeight: '700', textAlign: 'right', marginBottom: 6 }}>
        {t('myCoach')}
      </Text>
      <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, marginBottom: spacing.md, overflow: 'hidden' }}>
        {row(t('coachName'), coach?.coach_name ?? '—', () => router.push('/edit-persona'))}
        {row(t('tone'), coach ? t(`tone_${coach.tone_preset}`) : '—', () => router.push('/edit-persona'))}
      </View>

      {fitnessProfile && (
        <>
          <Text style={{ color: theme.inkSoft, fontSize: 11, fontWeight: '700', textAlign: 'right', marginBottom: 6 }}>
            {t('profileSection')}
          </Text>
          <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, marginBottom: spacing.md, overflow: 'hidden' }}>
            {row(t('genderLabel'), fitnessProfile.gender ? t(`gender_${fitnessProfile.gender}`) : '—', () => router.push('/edit-fitness-profile'))}
            {row(t('ageLabel'), fitnessProfile.age != null ? String(fitnessProfile.age) : '—', () => router.push('/edit-fitness-profile'))}
            {row(t('weightLabel'), fitnessProfile.weight_kg != null ? String(fitnessProfile.weight_kg) : '—', () => router.push('/edit-fitness-profile'))}
            {row(t('heightLabel'), fitnessProfile.height_cm != null ? String(fitnessProfile.height_cm) : '—', () => router.push('/edit-fitness-profile'))}
          </View>
        </>
      )}

      <Text style={{ color: theme.inkSoft, fontSize: 11, fontWeight: '700', textAlign: 'right', marginBottom: 6 }}>
        {t('trainingPlans')}
      </Text>
      <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, marginBottom: spacing.md, overflow: 'hidden' }}>
        {row(t('managePlans'), undefined, () => router.push('/manage-plans'))}
      </View>

      <Text style={{ color: theme.inkSoft, fontSize: 11, fontWeight: '700', textAlign: 'right', marginBottom: 6 }}>
        {t('account')}
      </Text>
      <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, marginBottom: spacing.md, overflow: 'hidden' }}>
        {row(t('usageThisMonth'), t('workoutsApprox', { used, total }))}
        {row(t('renewsOn'))}
      </View>

      <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, overflow: 'hidden' }}>
        {row(t('signOut'), undefined, signOut)}
        {row(t('deleteAccount'), undefined, confirmDelete, true)}
      </View>
    </ScrollView>
    </Screen>
  );
}
