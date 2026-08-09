import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/lib/supabase';
import { callFn } from '../../src/lib/api';
import { Screen } from '../../src/components/Screen';
import { LoadingOverlay } from '../../src/components/LoadingOverlay';
import { useLanguage } from '../../src/lib/language';
import { useLanguagePicker } from '../../src/lib/useLanguagePicker';
import { useUnits, formatWeightKg, formatHeightCm, weightUnitLabel } from '../../src/lib/units';
import { TERMS_URL, PRIVACY_URL } from '../../src/lib/webUrl';
import { fetchUsageSnapshot } from '../../src/lib/usage';
import { useTheme, spacing, radius, TAB_BAR_CLEARANCE } from '../../src/theme';

const SUBSCRIPTION_UI_ENABLED = true;

export default function Settings() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir, language } = useLanguage();
  const { open: openLanguagePicker } = useLanguagePicker();
  const { units } = useUnits();
  const [coach, setCoach] = useState<{ coach_name: string; tone_preset: string } | null>(null);
  const [usage, setUsage] = useState({ used: 0, total: 0 });
  // null = not loaded yet / no row at all — the section only renders once
  // this is a real row (System Design §21: appears only if the user
  // actually typed something in "קצת עליך", never as an empty prompt).
  const [fitnessProfile, setFitnessProfile] = useState<{
    gender: string | null; age: number | null; weight_kg: number | null; height_cm: number | null;
  } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [{ data: profile }, snapshot, { data: fitness }] = await Promise.all([
          supabase.from('coach_profiles').select('coach_name, tone_preset').maybeSingle(),
          fetchUsageSnapshot(),
          supabase.from('fitness_profiles').select('gender, age, weight_kg, height_cm').maybeSingle(),
        ]);
        setCoach(profile);
        setUsage(snapshot);
        setFitnessProfile(fitness ?? null);
      })();
    }, []),
  );

  async function signOut() {
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
      router.replace('/sign-in');
    } finally {
      setSigningOut(false);
    }
  }

  function confirmDelete() {
    Alert.alert(t('deleteConfirmTitle'), t('deleteConfirmBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await callFn('account-delete', {});
            await supabase.auth.signOut();
            router.replace('/sign-in');
          } catch {
            Alert.alert(t('coachUnavailable'));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  const { used, total } = usage;

  const row = (
    label: string, value?: string, onPress?: () => void, destructive = false,
    icon?: keyof typeof Ionicons.glyphMap,
  ) => (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={{
        flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', justifyContent: 'space-between',
        padding: spacing.md, borderBottomWidth: 1, borderBottomColor: theme.rule,
      }}
    >
      <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: 8 }}>
        {icon && <Ionicons name={icon} size={17} color={destructive ? theme.critical : theme.inkSoft} />}
        <Text style={{ color: destructive ? theme.critical : theme.ink, fontWeight: destructive ? '700' : '400' }}>
          {label}
        </Text>
      </View>
      {value && <Text style={{ color: theme.inkSoft }}>{value}</Text>}
    </Pressable>
  );

  const sectionTitle = (label: string) => (
    <Text style={{
      color: theme.inkSoft, fontSize: 11, fontWeight: '700',
      textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: 6,
    }}>
      {label}
    </Text>
  );

  return (
    <Screen>
    <LoadingOverlay
      visible={signingOut || deleting}
      object="dumbbell"
      label={deleting ? t('deletingAccount') : t('signingOut')}
    />
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.md, paddingBottom: TAB_BAR_CLEARANCE }}>
      <Text style={{
        color: theme.ink, fontSize: 20, fontWeight: '800',
        textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.md,
      }}>
        {t('settingsTitle')}
      </Text>

      {sectionTitle(t('myCoach'))}
      <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, marginBottom: spacing.md, overflow: 'hidden' }}>
        {row(t('coachName'), coach?.coach_name ?? '—', () => router.push('/edit-persona'))}
        {row(t('tone'), coach ? t(`tone_${coach.tone_preset}`) : '—', () => router.push('/edit-persona'))}
      </View>

      {fitnessProfile && (
        <>
          {sectionTitle(t('profileSection'))}
          <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, marginBottom: spacing.md, overflow: 'hidden' }}>
            {row(t('genderLabel'), fitnessProfile.gender ? t(`gender_${fitnessProfile.gender}`) : '—', () => router.push('/edit-fitness-profile'))}
            {row(t('ageLabel'), fitnessProfile.age != null ? String(fitnessProfile.age) : '—', () => router.push('/edit-fitness-profile'))}
            {row(
              t('weightLabel'),
              fitnessProfile.weight_kg != null ? `${formatWeightKg(fitnessProfile.weight_kg, units)} ${weightUnitLabel(units)}` : '—',
              () => router.push('/edit-fitness-profile'),
            )}
            {row(
              t('heightLabel'),
              fitnessProfile.height_cm != null ? formatHeightCm(fitnessProfile.height_cm, units) : '—',
              () => router.push('/edit-fitness-profile'),
            )}
          </View>
        </>
      )}

      {sectionTitle(t('account'))}
      <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, marginBottom: spacing.md, overflow: 'hidden' }}>
        {SUBSCRIPTION_UI_ENABLED && row(t('subscription'), undefined, () => router.push('/subscribe'), false, 'star-outline')}
        {row(t('usageThisMonth'), t('workoutsApprox', { used, total }))}
        {row(t('renewsOn'))}
      </View>

      <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, marginBottom: spacing.md, overflow: 'hidden' }}>
        {row(t('signOut'), undefined, signOut)}
        {row(t('deleteAccount'), undefined, confirmDelete, true)}
      </View>

      <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, marginBottom: spacing.md, overflow: 'hidden' }}>
        {row(t('language'), t(`lang_${language}`), openLanguagePicker, false, 'globe-outline')}
      </View>

      {sectionTitle(t('legalSection'))}
      <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, overflow: 'hidden' }}>
        {row(t('termsOfUse'), undefined, () => Linking.openURL(TERMS_URL))}
        {row(t('privacyPolicy'), undefined, () => Linking.openURL(PRIVACY_URL))}
      </View>
    </ScrollView>
    </Screen>
  );
}
