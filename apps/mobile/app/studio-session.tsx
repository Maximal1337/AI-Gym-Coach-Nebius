import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { StudioSessionScreen } from '../src/components/StudioSessionScreen';

/** Route wrapper — expo-router equivalent of plan-edit.tsx's pattern. The
 * screen itself always fetches its own state via `sessionId`, whether it
 * just came from a fresh parse, "do one again," or is being resumed from
 * the Studio tab's "Continue" card. */
export default function StudioSessionRoute() {
  const { sessionId, onboarding } = useLocalSearchParams<{ sessionId: string; onboarding?: string }>();
  // Reached from onboarding-plan.tsx (studio-generate/photo/paste, or the
  // blank "build it yourself" path): there's no gym-plan-style screen
  // behind this one to go back to — same as GeneratePlanFlow/
  // PhotographPlanFlow/PlanPasteFlow's onDone, closing here means
  // onboarding is complete, land in the main app.
  return (
    <Screen>
      <StudioSessionScreen
        sessionId={sessionId}
        onClose={() => (onboarding ? router.replace('/') : router.back())}
      />
    </Screen>
  );
}
