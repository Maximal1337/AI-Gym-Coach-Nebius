import { router, useLocalSearchParams } from 'expo-router';
import { PhotographPlanFlow } from '../src/components/PhotographPlanFlow';

// No <Screen> wrapper here — the camera step needs true full-bleed (no
// safe-area padding around a black viewfinder); PhotographPlanFlow wraps
// its own other steps (review/parsing/preview) in Screen individually.
export default function PlanPhoto() {
  const { mode } = useLocalSearchParams<{ mode?: 'onboarding' | 'add' }>();

  return (
    <PhotographPlanFlow
      mode={mode === 'onboarding' ? 'onboarding' : 'add'}
      onCancel={() => router.back()}
      onDone={() => (mode === 'onboarding' ? router.replace('/') : router.back())}
    />
  );
}
