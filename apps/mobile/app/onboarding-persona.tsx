import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { PersonaForm } from '../src/components/PersonaForm';
import { Screen } from '../src/components/Screen';
import { track } from '../src/lib/analytics';
import { useLanguage } from '../src/lib/language';
import { useTheme, spacing } from '../src/theme';

export default function OnboardingPersona() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();

  return (
    <Screen>
      {/* Reached via replace() from onboarding-plan, not push — no native
          back. Going back to plan choice is a real, meaningful step here
          (unlike consent/onboarding-plan's own root, which have nothing
          sensible before them), so this goes there, not to sign-out. */}
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        <Pressable
          onPress={() => router.replace('/onboarding-plan')}
          style={{ alignSelf: dir === 'rtl' ? 'flex-end' : 'flex-start' }}
        >
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
    </Screen>
  );
}
