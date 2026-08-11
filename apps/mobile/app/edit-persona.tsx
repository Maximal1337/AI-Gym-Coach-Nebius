import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../src/lib/supabase';
import { PersonaForm, type PersonaValues } from '../src/components/PersonaForm';
import { Screen } from '../src/components/Screen';
import { useLanguage } from '../src/lib/language';
import { track } from '../src/lib/analytics';
import { useTheme, spacing } from '../src/theme';

export default function EditPersona() {
  const theme = useTheme();
  const { dir } = useLanguage();
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
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        <Pressable onPress={() => { track('edit_persona_back_tapped'); router.back(); }} hitSlop={12} style={{ alignSelf: dir === 'rtl' ? 'flex-end' : 'flex-start' }}>
          <Ionicons name={dir === 'rtl' ? 'chevron-forward' : 'chevron-back'} size={24} color={theme.inkSoft} />
        </Pressable>
      </View>
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
