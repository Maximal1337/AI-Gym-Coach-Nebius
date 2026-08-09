import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { StudioSessionScreen } from '../src/components/StudioSessionScreen';

/** Route wrapper — expo-router equivalent of plan-edit.tsx's pattern. The
 * screen itself always fetches its own state via `sessionId`, whether it
 * just came from a fresh parse, "do one again," or is being resumed from
 * the Studio tab's "Continue" card. */
export default function StudioSessionRoute() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  return (
    <Screen>
      <StudioSessionScreen sessionId={sessionId} onClose={() => router.back()} />
    </Screen>
  );
}
