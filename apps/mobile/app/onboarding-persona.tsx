import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { PersonaForm } from '../src/components/PersonaForm';
import { Screen } from '../src/components/Screen';
import { Button } from '../src/components/Button';
import { supabase } from '../src/lib/supabase';
import { track } from '../src/lib/analytics';
import { useLanguage } from '../src/lib/language';
import { useTheme, spacing } from '../src/theme';

export default function OnboardingPersona() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir, language } = useLanguage();

  // Persona setup is skippable too — but unlike a missing plan, a missing
  // coach_profiles row is a hard 409 for every chat/session call
  // server-side (services/agent's prompt has no defaults to fall back
  // to), so "skip" here means inserting a real row with sensible
  // defaults rather than leaving it absent. Editable anytime from
  // Settings > coach persona.
  async function skip() {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return;
    await supabase.from('coach_profiles').upsert({
      user_id: userId,
      coach_name: t('defaultCoachName'),
      language,
      tone_preset: 'friendly_casual',
      accountability_style: 'gentle',
      persona_freeform: null,
    });
    track('onboarding_completed');
    router.replace('/');
  }

  return (
    <Screen>
      {/* Reached via replace() from onboarding-plan, not push — no native
          back. Going back to plan choice is a real, meaningful step here
          (unlike consent/onboarding-plan's own root, which have nothing
          sensible before them), so this goes there, not to sign-out. */}
      <View style={{
        flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', justifyContent: 'flex-start',
        paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
      }}>
        <Pressable onPress={() => router.replace('/onboarding-plan')}>
          <Text style={{ color: theme.inkSoft, fontSize: 12, fontWeight: '600' }}>{t('cancel')}</Text>
        </Pressable>
      </View>
      <PersonaForm
        mode="onboarding"
        onDone={() => {
          track('onboarding_completed');
          router.replace('/');
        }}
      />
      {/* Bottom, matching onboarding-plan's own "Skip for now" placement,
          not a corner text link next to Cancel. */}
      <View style={{ padding: spacing.md, paddingBottom: spacing.lg }}>
        <Button variant="quiet" block onPress={skip}>{t('skipForNow')}</Button>
      </View>
    </Screen>
  );
}
