import { router, useLocalSearchParams } from 'expo-router';
import { PlanPasteFlow } from '../src/components/PlanPasteFlow';
import { Screen } from '../src/components/Screen';

export default function PlanEdit() {
  const { mode, planId, initialMode } = useLocalSearchParams<{
    mode: 'add' | 'edit'; planId?: string; initialMode?: 'upload';
  }>();

  return (
    <Screen>
      <PlanPasteFlow
        mode={mode === 'edit' ? 'edit' : 'add'}
        editPlanId={planId}
        onDone={() => router.back()}
        onCancel={initialMode === 'upload' ? () => router.back() : undefined}
        initialMode={initialMode === 'upload' ? 'upload' : 'paste'}
      />
    </Screen>
  );
}
