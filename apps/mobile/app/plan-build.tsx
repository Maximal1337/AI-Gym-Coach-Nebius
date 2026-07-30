import { router } from 'expo-router';
import { ManualPlanForm } from '../src/components/ManualPlanForm';
import { Screen } from '../src/components/Screen';

export default function PlanBuild() {
  return (
    <Screen>
      <ManualPlanForm onDone={() => router.back()} />
    </Screen>
  );
}
