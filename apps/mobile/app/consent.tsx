import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { callFn } from '../src/lib/api';
import { supabase } from '../src/lib/supabase';
import { Screen } from '../src/components/Screen';
import { LoadingOverlay } from '../src/components/LoadingOverlay';
import { useLanguage } from '../src/lib/language';
import { track } from '../src/lib/analytics';
import { TERMS_URL } from '../src/lib/webUrl';
import { useTheme, spacing, radius } from '../src/theme';

export const TERMS_VERSION = '2026-07-26';

export default function Consent() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      await callFn('accept-terms', { version: TERMS_VERSION });
      router.replace('/');
    } catch {
      Alert.alert(t('coachUnavailable'));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/sign-in');
  }

  return (
    <Screen>
    <LoadingOverlay visible={busy} object="dumbbell" label={t('saving')} />
    <View style={{ flex: 1, padding: spacing.lg }}>
      {/* No screen before this one to go back to (this is a mandatory,
          replace()-only gate) — the one honest way out is signing out. */}
      <Pressable onPress={() => { track('consent_signout_tapped'); signOut(); }} style={{ alignSelf: dir === 'rtl' ? 'flex-end' : 'flex-start', marginBottom: spacing.sm }}>
        <Text style={{ color: theme.inkSoft, fontSize: 12, fontWeight: '600' }}>{t('signOut')}</Text>
      </Pressable>
      <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', marginBottom: spacing.md, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
        {t('consentTitle')}
      </Text>
      <ScrollView style={{ flex: 1, backgroundColor: theme.surface, borderRadius: radius.card, padding: spacing.md }}>
        {[t('consentBody1'), t('consentBody2'), t('consentBody3')].map((p, i) => (
          <Text key={i} style={{ color: theme.ink, lineHeight: 22, marginBottom: spacing.sm, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {p}
          </Text>
        ))}
      </ScrollView>
      <Pressable onPress={() => { track('consent_read_terms_tapped'); Linking.openURL(TERMS_URL); }} style={{ marginTop: spacing.sm, alignSelf: dir === 'rtl' ? 'flex-end' : 'flex-start' }}>
        <Text style={{ color: theme.accent, fontSize: 12.5, fontWeight: '700' }}>{t('readFullTerms')}</Text>
      </Pressable>
      <Pressable
        onPress={() => { track('consent_checkbox_toggled', { checked: !checked }); setChecked(!checked); }}
        style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: spacing.sm, marginVertical: spacing.md, alignItems: 'flex-start' }}
      >
        <View style={{
          width: 22, height: 22, borderRadius: 5, borderWidth: 2,
          borderColor: checked ? theme.accent : theme.inkSoft,
          backgroundColor: checked ? theme.accent : 'transparent',
          alignItems: 'center', justifyContent: 'center',
        }}>
          {checked && <Text style={{ color: theme.onAccent, fontWeight: '700' }}>✓</Text>}
        </View>
        <Text style={{ color: theme.ink, flex: 1, textAlign: dir === 'rtl' ? 'right' : 'left' }}>{t('consentCheckbox')}</Text>
      </Pressable>
      <Pressable
        disabled={!checked || busy}
        onPress={() => { track('consent_accept_tapped'); accept(); }}
        style={{
          backgroundColor: checked ? theme.accent : theme.rule,
          padding: 14, borderRadius: radius.pill, alignItems: 'center',
        }}
      >
        <Text style={{ color: checked ? theme.onAccent : theme.inkSoft, fontWeight: '700' }}>
          {t('continue')}
        </Text>
      </Pressable>
    </View>
    </Screen>
  );
}
