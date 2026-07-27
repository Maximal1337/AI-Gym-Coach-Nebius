import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { PersonaForm, type PersonaValues } from '../src/components/PersonaForm';
import { Screen } from '../src/components/Screen';
import { useTheme } from '../src/theme';

export default function EditPersona() {
  const theme = useTheme();
  const [initial, setInitial] = useState<Partial<PersonaValues> | null>(null);

  useEffect(() => {
    supabase.from('coach_profiles')
      .select('coach_name, tone_preset, accountability_style, persona_freeform')
      .maybeSingle()
      .then(({ data }) => setInitial(data ? {
        coachName: data.coach_name,
        tone: data.tone_preset,
        acc: data.accountability_style,
        freeform: data.persona_freeform ?? '',
      } : {}));
  }, []);

  return (
    <Screen>
      {initial ? (
        <PersonaForm mode="edit" initial={initial} onDone={() => router.back()} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      )}
    </Screen>
  );
}
