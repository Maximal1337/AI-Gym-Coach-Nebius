import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../src/lib/supabase';
import { callFn } from '../src/lib/api';
import { Screen } from '../src/components/Screen';
import { LoadingOverlay } from '../src/components/LoadingOverlay';
import { BottomSheet } from '../src/components/BottomSheet';
import { Field } from '../src/components/Field';
import { useLanguage } from '../src/lib/language';
import { useLanguagePicker } from '../src/lib/useLanguagePicker';
import {
  useUnits, formatWeightKg, formatHeightCm, formatHeightForEntry,
  parseWeightToKg, parseHeightToCm, weightUnitLabel,
} from '../src/lib/units';
import { TERMS_URL, PRIVACY_URL } from '../src/lib/webUrl';
import { fetchAccessStatus, type AccessStatus, SUBSCRIPTION_PAUSED } from '../src/lib/subscription';
import { track } from '../src/lib/analytics';
import { useTheme, spacing, radius, TAB_BAR_CLEARANCE } from '../src/theme';

const SUBSCRIPTION_UI_ENABLED = !SUBSCRIPTION_PAUSED;

type Gender = 'male' | 'female' | 'other';
type CoachProfile = { coach_name: string; persona_freeform: string | null };
type FitnessProfile = { gender: Gender | null; age: number | null; weight_kg: number | null; height_cm: number | null };
// Each editable field opens its own one-field sheet on the same screen
// (design: guidelines/settings-edit-affordance.html — "one sheet per field,
// so every chevron leads somewhere of its own").
type EditField = 'name' | 'notes' | 'gender' | 'age' | 'weight' | 'height';

export default function Settings() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir, language } = useLanguage();
  const { open: openLanguagePicker } = useLanguagePicker();
  const { units } = useUnits();
  const [userId, setUserId] = useState<string | null>(null);
  const [coach, setCoach] = useState<CoachProfile | null>(null);
  const [access, setAccess] = useState<AccessStatus | null>(null);
  // null = not loaded yet / no row at all — the section only renders once
  // this is a real row (System Design §21: appears only if the user
  // actually typed something in "קצת עליך", never as an empty prompt).
  const [fitnessProfile, setFitnessProfile] = useState<FitnessProfile | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Which field's edit sheet is open, and the working text/number for it.
  const [editing, setEditing] = useState<EditField | null>(null);
  const [draft, setDraft] = useState('');

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [{ data: auth }, { data: profile }, accessStatus, { data: fitness }] = await Promise.all([
          supabase.auth.getUser(),
          supabase.from('coach_profiles').select('coach_name, persona_freeform').maybeSingle(),
          fetchAccessStatus(),
          supabase.from('fitness_profiles').select('gender, age, weight_kg, height_cm').maybeSingle(),
        ]);
        setUserId(auth.user?.id ?? null);
        setCoach(profile);
        setAccess(accessStatus);
        setFitnessProfile((fitness as FitnessProfile | null) ?? null);
      })();
    }, []),
  );

  // Optimistic per-field write: the row updates as the sheet closes, and on
  // a rare failure we revert and surface it — a spinner would cost more than
  // the revert at this size (design: "Optimistic update").
  async function persistCoach(patch: Partial<CoachProfile>) {
    const prev = coach;
    setCoach((c) => (c ? { ...c, ...patch } : c));
    if (!userId) return;
    const { error } = await supabase.from('coach_profiles').update(patch).eq('user_id', userId);
    if (error) { setCoach(prev); Alert.alert(t('coachUnavailable')); }
  }

  async function persistFitness(patch: Partial<FitnessProfile>) {
    const prev = fitnessProfile;
    setFitnessProfile((f) => (f ? { ...f, ...patch } : f));
    if (!userId) return;
    const { error } = await supabase.from('fitness_profiles')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) { setFitnessProfile(prev); Alert.alert(t('coachUnavailable')); }
  }

  function openField(field: EditField) {
    track('settings_edit_field_opened', { field });
    if (field === 'name') setDraft(coach?.coach_name ?? '');
    else if (field === 'notes') setDraft(coach?.persona_freeform ?? '');
    else if (field === 'age') setDraft(fitnessProfile?.age != null ? String(fitnessProfile.age) : '');
    else if (field === 'weight') setDraft(fitnessProfile?.weight_kg != null ? String(formatWeightKg(fitnessProfile.weight_kg, units)) : '');
    else if (field === 'height') setDraft(fitnessProfile?.height_cm != null ? formatHeightForEntry(fitnessProfile.height_cm, units) : '');
    else setDraft(''); // gender commits on tap, no text draft
    setEditing(field);
  }

  function saveField() {
    switch (editing) {
      case 'name': {
        const v = draft.trim();
        if (!v) return; // coach name is required — keep the sheet open
        void persistCoach({ coach_name: v });
        break;
      }
      case 'notes':
        void persistCoach({ persona_freeform: draft.trim() || null });
        break;
      case 'age': {
        const n = parseInt(draft, 10);
        void persistFitness({ age: draft.trim() && Number.isFinite(n) ? n : null });
        break;
      }
      case 'weight':
        void persistFitness({ weight_kg: draft.trim() ? parseWeightToKg(draft, units) : null });
        break;
      case 'height':
        void persistFitness({ height_cm: draft.trim() ? parseHeightToCm(draft, units) : null });
        break;
    }
    setEditing(null);
  }

  async function signOut() {
    track('settings_signout_tapped');
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
      router.replace('/sign-in');
    } finally {
      setSigningOut(false);
    }
  }

  function confirmDelete() {
    track('settings_delete_account_tapped');
    Alert.alert(t('deleteConfirmTitle'), t('deleteConfirmBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          track('settings_delete_account_confirmed');
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

  function subscriptionValue(): string {
    if (!access) return '—';
    const localeDate = (iso: string) => new Date(iso).toLocaleDateString(language);
    if (access.status === 'active') {
      return access.subscriptionExpiresAt
        ? t('subscriptionRenewsOn', { date: localeDate(access.subscriptionExpiresAt) })
        : t('subscriptionActive');
    }
    if (access.status === 'canceled' && access.entitled) {
      return access.subscriptionExpiresAt
        ? t('subscriptionActiveUntil', { date: localeDate(access.subscriptionExpiresAt) })
        : t('subscriptionActive');
    }
    if (access.status === 'trialing' && access.entitled) {
      return t('trialDaysRemainingShort', { count: access.daysLeftInTrial });
    }
    return t('subscriptionExpiredShort');
  }

  // chevron defaults to on for any tappable row — a chevron is a promise of a
  // destination, and every tappable settings row now leads somewhere of its
  // own (a field sheet, a picker, a screen, an external page). Actions that
  // "do a thing" rather than navigate pass chevron={false}.
  const row = (
    label: string, value?: string, onPress?: () => void, destructive = false,
    icon?: keyof typeof Ionicons.glyphMap, chevron = true,
  ) => (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={{
        flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', justifyContent: 'space-between',
        alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: theme.rule,
      }}
    >
      <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {icon && <Ionicons name={icon} size={19} color={destructive ? theme.critical : theme.inkSoft} />}
        <Text style={{ color: destructive ? theme.critical : theme.ink, fontSize: 16, fontWeight: destructive ? '700' : '400' }}>
          {label}
        </Text>
      </View>
      <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0 }}>
        {value && (
          <Text
            style={{ color: theme.inkSoft, fontSize: 16, flexShrink: 1, marginStart: spacing.sm, textAlign: dir === 'rtl' ? 'left' : 'right' }}
            numberOfLines={1}
          >
            {value}
          </Text>
        )}
        {onPress && chevron && (
          <Ionicons name={dir === 'rtl' ? 'chevron-back' : 'chevron-forward'} size={16} color={theme.inkSoft} />
        )}
      </View>
    </Pressable>
  );

  const sectionTitle = (label: string) => (
    <Text style={{
      color: theme.inkSoft, fontSize: 12, fontWeight: '700',
      textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: 6,
    }}>
      {label}
    </Text>
  );

  const sheetTitle: Record<EditField, string> = {
    name: t('coachName'), notes: t('coachNote'), gender: t('genderLabel'),
    age: t('ageLabel'), weight: t('weightLabel'), height: t('heightLabel'),
  };

  const saveButton = (
    <Pressable
      onPress={saveField}
      style={{ backgroundColor: theme.accent, padding: 14, borderRadius: radius.pill, alignItems: 'center', marginTop: spacing.md }}
    >
      <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{t('save')}</Text>
    </Pressable>
  );

  return (
    <Screen>
    <LoadingOverlay
      visible={signingOut || deleting}
      object="dumbbell"
      label={deleting ? t('deletingAccount') : t('signingOut')}
    />
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.md, paddingBottom: TAB_BAR_CLEARANCE }}>
      {/* headerShown is false app-wide — pushed routes get no native back
          button, only the swipe/hardware gesture, which isn't a visible
          affordance (same reasoning as plan-build.tsx's back chevron). */}
      <Pressable
        onPress={() => { track('settings_back_tapped'); router.back(); }}
        hitSlop={12}
        style={{ alignSelf: dir === 'rtl' ? 'flex-end' : 'flex-start', marginBottom: spacing.sm }}
      >
        <Ionicons name={dir === 'rtl' ? 'chevron-forward' : 'chevron-back'} size={24} color={theme.inkSoft} />
      </Pressable>

      <Text style={{
        color: theme.ink, fontSize: 20, fontWeight: '800',
        textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.md,
      }}>
        {t('settingsTitle')}
      </Text>

      {sectionTitle(t('myCoach'))}
      <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, marginBottom: spacing.md, overflow: 'hidden' }}>
        {row(t('coachName'), coach?.coach_name ?? '—', () => openField('name'))}
        {row(t('coachNote'), coach?.persona_freeform || '—', () => openField('notes'))}
      </View>

      {fitnessProfile && (
        <>
          {sectionTitle(t('profileSection'))}
          <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, marginBottom: spacing.md, overflow: 'hidden' }}>
            {row(t('genderLabel'), fitnessProfile.gender ? t(`gender_${fitnessProfile.gender}`) : '—', () => openField('gender'))}
            {row(t('ageLabel'), fitnessProfile.age != null ? String(fitnessProfile.age) : '—', () => openField('age'))}
            {row(
              t('weightLabel'),
              fitnessProfile.weight_kg != null ? `${formatWeightKg(fitnessProfile.weight_kg, units)} ${weightUnitLabel(units)}` : '—',
              () => openField('weight'),
            )}
            {row(
              t('heightLabel'),
              fitnessProfile.height_cm != null ? formatHeightCm(fitnessProfile.height_cm, units) : '—',
              () => openField('height'),
            )}
          </View>
        </>
      )}

      {sectionTitle(t('account'))}
      <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, marginBottom: spacing.md, overflow: 'hidden' }}>
        {SUBSCRIPTION_UI_ENABLED && row(t('subscription'), subscriptionValue(), () => { track('settings_subscription_tapped'); router.push('/subscribe'); }, false, 'star-outline')}
        {row(t('language'), t(`lang_${language}`), () => { track('settings_language_tapped'); openLanguagePicker(); }, false, 'globe-outline')}
      </View>

      {sectionTitle(t('legalSection'))}
      <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, marginBottom: spacing.md, overflow: 'hidden' }}>
        {row(t('termsOfUse'), undefined, () => { track('settings_terms_tapped'); Linking.openURL(TERMS_URL); })}
        {row(t('privacyPolicy'), undefined, () => { track('settings_privacy_tapped'); Linking.openURL(PRIVACY_URL); })}
      </View>

      {/* Destructive account actions live last (design:
          guidelines/settings-edit-affordance.html) — they do a thing rather
          than navigating, so no chevron, and they sit at the bottom. */}
      <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, overflow: 'hidden' }}>
        {row(t('signOut'), undefined, signOut, false, undefined, false)}
        {row(t('deleteAccount'), undefined, confirmDelete, true, undefined, false)}
      </View>
    </ScrollView>

    {/* One sheet, one field. Choice fields commit on tap; typed fields save. */}
    <BottomSheet visible={editing !== null} title={editing ? sheetTitle[editing] : ''} onClose={() => setEditing(null)}>
      {editing === 'name' && (
        <>
          <Field value={draft} onChangeText={setDraft} autoFocus autoCapitalize="words" surface="outline" />
          {saveButton}
        </>
      )}

      {editing === 'notes' && (
        <>
          <TextInput
            multiline
            autoFocus
            value={draft}
            onChangeText={setDraft}
            placeholder={t('personaFreeform')}
            placeholderTextColor={theme.inkSoft}
            style={{
              borderWidth: 1, borderColor: theme.rule, borderRadius: radius.field, minHeight: 96,
              padding: 12, color: theme.ink, textAlign: dir === 'rtl' ? 'right' : 'left', textAlignVertical: 'top',
            }}
          />
          {saveButton}
        </>
      )}

      {editing === 'gender' && (
        <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: 6 }}>
          {(['male', 'female', 'other'] as Gender[]).map((g) => (
            <Pressable
              key={g}
              onPress={() => {
                track('settings_gender_selected', { gender: g });
                void persistFitness({ gender: g });
                setEditing(null);
              }}
              style={{
                flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.field,
                backgroundColor: theme.bg, borderWidth: 1.5,
                borderColor: fitnessProfile?.gender === g ? theme.accent : 'transparent',
              }}
            >
              <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 13 }}>{t(`gender_${g}`)}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {editing === 'age' && (
        <>
          <Field value={draft} onChangeText={setDraft} keyboardType="number-pad" placeholder={t('agePlaceholder')} autoFocus surface="outline" />
          {saveButton}
        </>
      )}

      {editing === 'weight' && (
        <>
          <Field
            value={draft} onChangeText={setDraft} keyboardType="decimal-pad" autoFocus surface="outline"
            unit={weightUnitLabel(units)}
            placeholder={units === 'metric' ? t('weightPlaceholder') : t('weightPlaceholderImperial')}
          />
          {saveButton}
        </>
      )}

      {editing === 'height' && (
        <>
          <Field
            value={draft} onChangeText={setDraft} keyboardType="decimal-pad" autoFocus surface="outline"
            unit={units === 'metric' ? t('cmLabel') : t('inLabel')}
            placeholder={units === 'metric' ? t('heightPlaceholder') : t('heightPlaceholderImperial')}
          />
          {saveButton}
        </>
      )}
    </BottomSheet>
    </Screen>
  );
}
