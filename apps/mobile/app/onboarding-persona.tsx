import { router } from 'expo-router';
import { PersonaForm } from '../src/components/PersonaForm';
import { Screen } from '../src/components/Screen';
import { track } from '../src/lib/analytics';

export default function OnboardingPersona() {
  return (
    <Screen>
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
