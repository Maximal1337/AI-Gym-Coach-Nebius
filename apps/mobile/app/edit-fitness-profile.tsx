import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { FitnessProfileForm, type FitnessProfileValues } from '../src/components/FitnessProfileForm';
import { Screen } from '../src/components/Screen';
import { useTheme } from '../src/theme';

export default function EditFitnessProfile() {
  const theme = useTheme();
  const [initial, setInitial] = useState<FitnessProfileValues | null>(null);

  useEffect(() => {
    supabase.from('fitness_profiles')
      .select('gender, age, weight_kg, height_cm')
      .maybeSingle()
      .then(({ data }) => setInitial({
        gender: data?.gender ?? null,
        age: data?.age != null ? String(data.age) : '',
        weightKg: data?.weight_kg != null ? String(data.weight_kg) : '',
        heightCm: data?.height_cm != null ? String(data.height_cm) : '',
      }));
  }, []);

  return (
    <Screen>
      {initial ? (
        <FitnessProfileForm initial={initial} onDone={() => router.back()} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      )}
    </Screen>
  );
}
