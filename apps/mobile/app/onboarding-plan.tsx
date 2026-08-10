import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { PlanPasteFlow } from '../src/components/PlanPasteFlow';
import { GeneratePlanFlow } from '../src/components/GeneratePlanFlow';
import { PhotographPlanFlow } from '../src/components/PhotographPlanFlow';
import { Screen } from '../src/components/Screen';
import { ChoiceCard } from '../src/components/ChoiceCard';
import { BottomSheet } from '../src/components/BottomSheet';
import { Badge } from '../src/components/Badge';
import { Button } from '../src/components/Button';
import { LoadingOverlay } from '../src/components/LoadingOverlay';
import { supabase } from '../src/lib/supabase';
import { ApiError } from '../src/lib/api';
import { existingOpenSessionId, openStudioSession } from '../src/lib/studioApi';
import { fetchAccessStatus } from '../src/lib/subscription';
import { useLanguage } from '../src/lib/language';
import { useTheme, spacing } from '../src/theme';

type Choice = 'generate' | 'photo' | 'paste' | 'upload' | null;
/** Same five methods as the post-onboarding "Add a new workout" sheet
 * (app/(tabs)/index.tsx) — kept as a separate type from Choice since
 * 'build' never renders inline here the way generate/photo/paste/upload
 * do (gym's manual build pushes a route; studio's opens a live session). */
type AddMethod = 'generate' | 'photo' | 'paste' | 'upload' | 'build';

/**
 * First-run entry point (System Design §21): a brand-new user has nothing
 * to paste yet, so "generate for me" is the primary path — paste/manual
 * are secondary, for someone who already has a real program to bring.
 * Kind (gym vs. studio) is asked right after the method, same two-step
 * shape as the post-onboarding add-workout flow — onboarding was gym-only
 * until studio's kind-chooser existed, this brings it to parity.
 */
export default function OnboardingPlan() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const [choice, setChoice] = useState<Choice>(null);
  const [pendingMethod, setPendingMethod] = useState<AddMethod | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [studioBusy, setStudioBusy] = useState(false);

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
    setSkipping(true);
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (uid) await supabase.from('users').update({ plan_setup_skipped_at: new Date().toISOString() }).eq('id', uid);
      router.replace('/');
    } catch {
      Alert.alert(t('coachUnavailable'));
      setSkipping(false);
    }
  }

  // A blank studio board opens a LIVE session directly (no separate
  // plan-creation step the way gym's manual build has) — studio-session.tsx
  // reads the `onboarding` param to land on '/' when it closes instead of
  // router.back()ing into this screen.
  async function buildOwnStudio() {
    setStudioBusy(true);
    try {
      const res = await openStudioSession({ blank: true });
      router.replace({ pathname: '/studio-session', params: { sessionId: res.sessionId, onboarding: '1' } });
    } catch (e) {
      const existing = await existingOpenSessionId(e);
      if (existing) {
        router.replace({ pathname: '/studio-session', params: { sessionId: existing, onboarding: '1' } });
      } else if (e instanceof ApiError && e.code === 'subscription_required') {
        router.push('/subscribe');
      } else {
        Alert.alert(t('coachUnavailable'));
      }
    } finally {
      setStudioBusy(false);
    }
  }

  // Gym's methods stay exactly as they were (inline `choice` rendering,
  // or a pushed route for manual build) — only studio's routing and the
  // entitlement pre-check are new. A brand-new onboarding account is
  // always within its fresh trial, so this check is defense in depth
  // (matching every other AI entry point in the app) rather than
  // something expected to actually fire here.
  async function resolveMethod(method: AddMethod, kind: 'gym' | 'studio') {
    setPendingMethod(null);

    if (!(kind === 'gym' && method === 'build')) {
      const access = await fetchAccessStatus();
      if (!access.entitled) {
        router.push('/subscribe');
        return;
      }
    }

    if (kind === 'gym') {
      if (method === 'build') router.push({ pathname: '/plan-build', params: { mode: 'onboarding' } });
      else setChoice(method as Exclude<AddMethod, 'build'>);
      return;
    }

    if (method === 'build') { void buildOwnStudio(); return; }
    if (method === 'generate') router.push({ pathname: '/studio-generate', params: { onboarding: '1' } });
    else if (method === 'photo') router.push({ pathname: '/studio-photo', params: { onboarding: '1' } });
    else if (method === 'paste') router.push({ pathname: '/studio-paste', params: { onboarding: '1' } });
    else router.push({ pathname: '/studio-paste', params: { onboarding: '1', initialMode: 'upload' } });
  }

  return (
    <Screen>
      <LoadingOverlay visible={skipping || studioBusy} object="plate" label={t('loading')} />
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
            icon="sparkles-outline"
            label={t('generatePlanCta')}
            description={t('goalSub')}
            badge={<Badge>AI</Badge>}
            onPress={() => setPendingMethod('generate')}
          />
          <ChoiceCard
            icon="camera-outline"
            label={t('choosePhoto')}
            description={t('choosePhotoDesc')}
            onPress={() => setPendingMethod('photo')}
          />
          <ChoiceCard
            icon="clipboard-outline"
            label={t('choosePaste')}
            description={t('planSub')}
            onPress={() => setPendingMethod('paste')}
          />
          <ChoiceCard
            icon="document-attach-outline"
            label={t('chooseUpload')}
            onPress={() => setPendingMethod('upload')}
          />
          <ChoiceCard
            icon="construct-outline"
            label={t('chooseManual')}
            description={t('manualPlanSub')}
            onPress={() => setPendingMethod('build')}
          />
          <Text style={{
            color: theme.inkSoft, fontSize: 10.5, lineHeight: 15,
            textAlign: dir === 'rtl' ? 'right' : 'left', marginTop: 4,
          }}>
            {t('generatePlanCaption')}
          </Text>
        </ScrollView>

        <View style={{ padding: spacing.md, paddingBottom: spacing.xl }}>
          <Button variant="quiet" block disabled={skipping} onPress={skip}>{t('skipForNow')}</Button>
        </View>
      </View>

      <BottomSheet visible={pendingMethod !== null} title={t('chooseKindTitle')} onClose={() => setPendingMethod(null)}>
        <View style={{ gap: spacing.sm }}>
          <ChoiceCard
            icon="barbell-outline"
            label={t('kindGym')}
            onPress={() => pendingMethod && resolveMethod(pendingMethod, 'gym')}
          />
          <ChoiceCard
            icon="flame-outline"
            label={t('kindStudio')}
            onPress={() => pendingMethod && resolveMethod(pendingMethod, 'studio')}
          />
        </View>
      </BottomSheet>
    </Screen>
  );
}
