import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { PlanPasteFlow } from '../src/components/PlanPasteFlow';
import { GeneratePlanFlow } from '../src/components/GeneratePlanFlow';
import { Screen } from '../src/components/Screen';
import { supabase } from '../src/lib/supabase';
import { useLanguage } from '../src/lib/language';
import { useTheme, spacing, radius } from '../src/theme';

type Choice = 'generate' | 'paste' | 'upload' | null;

/**
 * First-run entry point (System Design §21): a brand-new user has nothing
 * to paste yet, so "generate for me" is the primary path — paste/manual
 * are secondary, for someone who already has a real program to bring.
 */
export default function OnboardingPlan() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const [choice, setChoice] = useState<Choice>(null);

  if (choice === 'generate') {
    return (
      <Screen>
        <GeneratePlanFlow mode="onboarding" onCancel={() => setChoice(null)} onDone={() => router.replace('/')} />
      </Screen>
    );
  }

  if (choice === 'paste' || choice === 'upload') {
    return (
      <Screen>
        <PlanPasteFlow
          mode="onboarding"
          onDone={() => router.replace('/')}
          onCancel={() => setChoice(null)}
          initialMode={choice === 'upload' ? 'upload' : 'paste'}
        />
      </Screen>
    );
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/sign-in');
  }

  // Persisted (not just a local skip) — the gate in app/index.tsx checks
  // this on every launch, so without it the user would just land right
  // back here every time instead of reaching the app. Chat nudges them
  // back to plans.tsx (the real "add a plan" surface) when they're ready.
  async function skip() {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (uid) await supabase.from('users').update({ plan_setup_skipped_at: new Date().toISOString() }).eq('id', uid);
    router.replace('/');
  }

  return (
    <Screen>
      <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center' }}>
        {/* Reached via replace() from consent, also replace()'d away — no
            screen behind this one to go back to. Signing out is the one
            honest way out, same reasoning as consent.tsx. */}
        <Pressable onPress={signOut} style={{ position: 'absolute', top: spacing.lg, [dir === 'rtl' ? 'left' : 'right']: spacing.lg }}>
          <Text style={{ color: theme.inkSoft, fontSize: 12, fontWeight: '600' }}>{t('signOut')}</Text>
        </Pressable>
        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.xs }}>
          {t('chooseHowTitle')}
        </Text>
        <Text style={{ color: theme.inkSoft, textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.lg }}>{t('chooseHowSub')}</Text>

        <Pressable
          onPress={() => setChoice('generate')}
          style={{ backgroundColor: theme.accent, borderRadius: radius.pill, padding: spacing.md, alignItems: 'center' }}
        >
          <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{t('generatePlanCta')}</Text>
        </Pressable>
        <Text style={{ color: theme.inkSoft, fontSize: 10.5, textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 15 }}>
          {t('generatePlanCaption')}
        </Text>

        <Pressable
          onPress={() => setChoice('paste')}
          style={{
            borderWidth: 1, borderColor: theme.accent, borderStyle: 'dashed', borderRadius: radius.card,
            padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm,
          }}
        >
          <Text style={{ color: theme.accent, fontWeight: '700' }}>{t('choosePaste')}</Text>
        </Pressable>

        <Pressable
          onPress={() => setChoice('upload')}
          style={{
            borderWidth: 1, borderColor: theme.rule, borderStyle: 'dashed', borderRadius: radius.card,
            padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm,
          }}
        >
          <Text style={{ color: theme.inkSoft, fontWeight: '700' }}>{t('chooseUpload')}</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push({ pathname: '/plan-build', params: { mode: 'onboarding' } })}
          style={{
            borderWidth: 1, borderColor: theme.rule, borderStyle: 'dashed', borderRadius: radius.card,
            padding: spacing.md, alignItems: 'center',
          }}
        >
          <Text style={{ color: theme.inkSoft, fontWeight: '700' }}>{t('chooseManual')}</Text>
        </Pressable>

        <Pressable onPress={skip} style={{ alignItems: 'center', marginTop: spacing.lg }}>
          <Text style={{ color: theme.inkSoft, fontSize: 13, fontWeight: '600' }}>{t('skipPlanForNow')}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}
