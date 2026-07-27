import { router } from 'expo-router';
import { PersonaForm } from '../src/components/PersonaForm';
import { Screen } from '../src/components/Screen';

export default function OnboardingPersona() {
  return (
    <Screen>
      <PersonaForm mode="onboarding" onDone={() => router.replace('/')} />
    </Screen>
  );
}
