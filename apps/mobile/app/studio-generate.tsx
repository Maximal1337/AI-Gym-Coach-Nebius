import { router } from 'expo-router';
import { StudioGenerateFlow } from '../src/components/StudioGenerateFlow';
import { Screen } from '../src/components/Screen';

export default function StudioGenerate() {
  return (
    <Screen>
      <StudioGenerateFlow
        onCancel={() => router.back()}
        onDone={(sessionId) => router.replace({ pathname: '/studio-session', params: { sessionId } })}
      />
    </Screen>
  );
}
