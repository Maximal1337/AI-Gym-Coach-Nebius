import { router, useLocalSearchParams } from 'expo-router';
import { PlanPasteFlow } from '../src/components/PlanPasteFlow';
import { Screen } from '../src/components/Screen';

export default function PlanEdit() {
  const { mode, planId } = useLocalSearchParams<{ mode: 'add' | 'edit'; planId?: string }>();

  return (
    <Screen>
      <PlanPasteFlow
        mode={mode === 'edit' ? 'edit' : 'add'}
        editPlanId={planId}
        onDone={() => router.back()}
      />
    </Screen>
  );
}
