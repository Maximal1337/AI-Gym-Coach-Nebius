import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { hasChosenLanguage } from '../src/lib/language';
import { registerPush } from '../src/lib/push';
import { initPurchases } from '../src/lib/subscription';
import { Screen } from '../src/components/Screen';
import { useTheme } from '../src/theme';

/**
 * Entry router: resume the user at the right step —
 * signed out -> sign-in; no explicit language choice on this device ->
 * choose language; no consent -> consent; no plan -> paste plan;
 * no persona -> persona; otherwise the app.
 */
export default function Entry() {
  const theme = useTheme();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (cancelled) return;
      if (!user) return router.replace('/sign-in');

      // Checked first (guidelines/language-discovery.html's "explicit
      // step"), on every fresh install/device — a device-local flag, not
      // a DB column, since a different device can have a different
      // system language even for the same account.
      if (!(await hasChosenLanguage())) return router.replace('/onboarding-language');
      if (cancelled) return;

      const loadState = () => Promise.all([
        supabase.from('users').select('terms_accepted_at, plan_setup_skipped_at').eq('id', user.id).maybeSingle(),
        supabase.from('coach_profiles').select('user_id').eq('user_id', user.id).maybeSingle(),
        supabase
          .from('training_plans')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active'),
      ]);
      // On a fresh install the first queries can flake (cold start, network),
      // and onboarding re-runs this router several times (after language, plan,
      // persona). A single flaky pass used to bounce an already-consented user
      // back to consent (terms live server-side in users.terms_accepted_at),
      // so it appeared more than once — retry before falling back to the gate.
      let [userRes, profileRes, planRes] = await loadState();
      for (let attempt = 1; attempt < 3 && (userRes.error || profileRes.error || planRes.error); attempt++) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        if (cancelled) return;
        [userRes, profileRes, planRes] = await loadState();
      }
      if (cancelled) return;
      // Only after retries: a transient query error must not silently re-route
      // an onboarded user backwards; consent is the one safe (and legally
      // conservative) fallback, and accept-terms is idempotent.
      if (userRes.error || profileRes.error || planRes.error) {
        return router.replace('/consent');
      }
      if (!userRes.data?.terms_accepted_at) return router.replace('/consent');
      if (!planRes.count && !userRes.data.plan_setup_skipped_at) return router.replace('/onboarding-plan');
      if (!profileRes.data) return router.replace('/onboarding-persona');
      // Durable coach replies (Linear doc): registerPush previously only
      // ran once, during onboarding — anyone who'd already onboarded
      // before that existed (or whose token went stale) never got one.
      // Fire-and-forget on every launch instead: idempotent (upsert),
      // permission is only ever actually prompted once by iOS regardless
      // of how many times this runs, and it must never block navigation.
      void registerPush(user.id);
      initPurchases(user.id);
      router.replace('/(tabs)');
    })().finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {checking && <ActivityIndicator color={theme.accent} />}
      </View>
    </Screen>
  );
}
