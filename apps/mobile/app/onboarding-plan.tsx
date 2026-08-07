import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { PlanPasteFlow } from '../src/components/PlanPasteFlow';
import { GeneratePlanFlow } from '../src/components/GeneratePlanFlow';
import { PhotographPlanFlow } from '../src/components/PhotographPlanFlow';
import { Screen } from '../src/components/Screen';
import { ChoiceCard } from '../src/components/ChoiceCard';
import { Badge } from '../src/components/Badge';
import { Button } from '../src/components/Button';
import { supabase } from '../src/lib/supabase';
import { useLanguage } from '../src/lib/language';
import { useTheme, spacing } from '../src/theme';

type Choice = 'generate' | 'photo' | 'paste' | 'upload' | null;

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

  if (choice === 'photo') {
    // No <Screen> wrapper — PhotographPlanFlow wraps its own non-camera
    // steps individually, so the camera step itself can go full-bleed.
    return (
      <PhotographPlanFlow mode="onboarding" onCancel={() => setChoice(null)} onDone={() => router.replace('/')} />
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
      <View style={{ flex: 1 }}>
        {/* Reached via replace() from consent, also replace()'d away — no
            screen behind this one to go back to. Signing out is the one
            honest way out, same reasoning as consent.tsx — positioned on
            the leading side, matching the design system's NavBar
            "exit" convention (and consent.tsx's own placement) rather
            than the trailing corner. */}
        <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', padding: spacing.sm }}>
          <Button variant="quiet" size="sm" onPress={signOut}>{t('signOut')}</Button>
        </View>

        <View style={{ paddingHorizontal: spacing.lg }}>
          <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', letterSpacing: -0.3, textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: 4 }}>
            {t('chooseHowTitle')}
          </Text>
          <Text style={{ color: theme.inkSoft, fontSize: 14.5, lineHeight: 21, textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.lg }}>
            {t('chooseHowSub')}
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
        >
          <ChoiceCard
            emphasis="primary"
            icon="sparkles"
            label={t('generatePlanCta')}
            description={t('goalSub')}
            badge={<Badge>AI</Badge>}
            onPress={() => setChoice('generate')}
          />
          <ChoiceCard
            icon="camera-outline"
            label={t('choosePhoto')}
            description={t('choosePhotoDesc')}
            onPress={() => setChoice('photo')}
          />
          <ChoiceCard
            icon="clipboard-outline"
            label={t('choosePaste')}
            description={t('planSub')}
            onPress={() => setChoice('paste')}
          />
          <ChoiceCard
            icon="document-attach-outline"
            label={t('chooseUpload')}
            onPress={() => setChoice('upload')}
          />
          <ChoiceCard
            icon="construct-outline"
            label={t('chooseManual')}
            description={t('manualPlanSub')}
            onPress={() => router.push({ pathname: '/plan-build', params: { mode: 'onboarding' } })}
          />
          <Text style={{
            color: theme.inkSoft, fontSize: 10.5, lineHeight: 15,
            textAlign: dir === 'rtl' ? 'right' : 'left', marginTop: 4,
          }}>
            {t('generatePlanCaption')}
          </Text>
        </ScrollView>

        <View style={{ padding: spacing.md, paddingBottom: spacing.lg }}>
          <Button variant="quiet" block onPress={skip}>{t('skipForNow')}</Button>
        </View>
      </View>
    </Screen>
  );
}
