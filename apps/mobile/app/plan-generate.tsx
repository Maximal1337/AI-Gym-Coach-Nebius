import { router, useLocalSearchParams } from 'expo-router';
import { GeneratePlanFlow } from '../src/components/GeneratePlanFlow';
import { Screen } from '../src/components/Screen';

export default function PlanGenerate() {
  const { mode } = useLocalSearchParams<{ mode?: 'onboarding' | 'add' }>();

  return (
    <Screen>
      <GeneratePlanFlow
        mode={mode === 'onboarding' ? 'onboarding' : 'add'}
        onCancel={() => router.back()}
        onDone={() => (mode === 'onboarding' ? router.replace('/') : router.back())}
      />
    </Screen>
  );
}
