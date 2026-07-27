import { router } from 'expo-router';
import { PlanPasteFlow } from '../src/components/PlanPasteFlow';
import { Screen } from '../src/components/Screen';

export default function OnboardingPlan() {
  return (
    <Screen>
      <PlanPasteFlow mode="onboarding" onDone={() => router.replace('/')} />
    </Screen>
  );
}
