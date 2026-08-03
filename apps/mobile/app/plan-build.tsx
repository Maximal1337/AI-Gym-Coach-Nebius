import { router, useLocalSearchParams } from 'expo-router';
import { ManualPlanForm } from '../src/components/ManualPlanForm';
import { Screen } from '../src/components/Screen';

export default function PlanBuild() {
  const { mode } = useLocalSearchParams<{ mode?: 'onboarding' }>();

  return (
    <Screen>
      <ManualPlanForm onDone={() => (mode === 'onboarding' ? router.replace('/') : router.back())} />
    </Screen>
  );
}
