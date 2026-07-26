import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { callFn } from '../src/lib/api';
import { useTheme, spacing, radius } from '../src/theme';

export const TERMS_VERSION = '2026-07-26';

export default function Consent() {
  const theme = useTheme();
  const { t } = useTranslation();
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

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, padding: spacing.lg }}>
      <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', marginBottom: spacing.md, textAlign: 'right' }}>
        {t('consentTitle')}
      </Text>
      <ScrollView style={{ flex: 1, backgroundColor: theme.surface, borderRadius: radius.card, padding: spacing.md }}>
        {[t('consentBody1'), t('consentBody2'), t('consentBody3')].map((p, i) => (
          <Text key={i} style={{ color: theme.ink, lineHeight: 22, marginBottom: spacing.sm, textAlign: 'right' }}>
            {p}
          </Text>
        ))}
      </ScrollView>
      <Pressable
        onPress={() => setChecked(!checked)}
        style={{ flexDirection: 'row-reverse', gap: spacing.sm, marginVertical: spacing.md, alignItems: 'flex-start' }}
      >
        <View style={{
          width: 22, height: 22, borderRadius: 5, borderWidth: 2,
          borderColor: checked ? theme.accent : theme.inkSoft,
          backgroundColor: checked ? theme.accent : 'transparent',
          alignItems: 'center', justifyContent: 'center',
        }}>
          {checked && <Text style={{ color: theme.onAccent, fontWeight: '700' }}>✓</Text>}
        </View>
        <Text style={{ color: theme.ink, flex: 1, textAlign: 'right' }}>{t('consentCheckbox')}</Text>
      </Pressable>
      <Pressable
        disabled={!checked || busy}
        onPress={accept}
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
  );
}
