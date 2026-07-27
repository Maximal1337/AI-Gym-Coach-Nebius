import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { registerPush } from '../lib/push';
import { useTheme, spacing, radius } from '../theme';

const TONES = ['motivational_energetic', 'calm_precise', 'tough_love', 'friendly_casual'] as const;
const ACCS = ['gentle', 'no_excuses'] as const;

export interface PersonaValues {
  coachName: string;
  tone: (typeof TONES)[number];
  acc: (typeof ACCS)[number];
  freeform: string;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1,
        borderColor: active ? theme.accent : theme.rule,
        backgroundColor: active ? theme.accent : 'transparent',
      }}
    >
      <Text style={{ color: active ? theme.onAccent : theme.inkSoft, fontWeight: '600', fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Coach persona form (GYM-27), shared between first-run onboarding and
 * editing the persona afterward (GYM-70) — coach_profiles is the one
 * fully client-writable table (System Design §4), so both are a plain
 * upsert, just with different pre-fill and navigation on save.
 */
export function PersonaForm({
  mode, initial, onDone,
}: {
  mode: 'onboarding' | 'edit';
  initial?: Partial<PersonaValues>;
  onDone: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [coachName, setCoachName] = useState(initial?.coachName ?? '');
  const [tone, setTone] = useState<PersonaValues['tone']>(initial?.tone ?? 'motivational_energetic');
  const [acc, setAcc] = useState<PersonaValues['acc']>(initial?.acc ?? 'gentle');
  const [freeform, setFreeform] = useState(initial?.freeform ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!coachName.trim()) return;
    setBusy(true);
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return;
    const { error } = await supabase.from('coach_profiles').upsert({
      user_id: userId,
      coach_name: coachName.trim(),
      language: 'he',
      tone_preset: tone,
      accountability_style: acc,
      persona_freeform: freeform.trim() || null,
    });
    setBusy(false);
    if (error) return Alert.alert(t('coachUnavailable'));
    if (mode === 'onboarding') void registerPush(userId);
    onDone();
  }

  const label = (s: string) => ({ color: theme.ink, fontWeight: '700' as const, fontSize: 13, marginBottom: 8, textAlign: 'right' as const });

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: spacing.lg }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {mode === 'onboarding' && (
        <Text style={{ color: theme.inkSoft, fontSize: 12, fontWeight: '700', textAlign: 'right' }}>
          {t('personaStep')}
        </Text>
      )}
      <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', marginVertical: spacing.sm, textAlign: 'right' }}>
        {mode === 'onboarding' ? t('personaTitle') : t('editPersonaTitle')}
      </Text>

      <Text style={label('coachName')}>{t('coachName')}</Text>
      <TextInput
        value={coachName}
        onChangeText={setCoachName}
        style={{
          borderWidth: 1, borderColor: theme.rule, borderRadius: radius.field,
          padding: 12, color: theme.ink, marginBottom: spacing.md, textAlign: 'right',
        }}
      />

      <Text style={label('tone')}>{t('tone')}</Text>
      <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md }}>
        {TONES.map((v) => (
          <Chip key={v} label={t(`tone_${v}`)} active={tone === v} onPress={() => setTone(v)} />
        ))}
      </View>

      <Text style={label('acc')}>{t('accountability')}</Text>
      <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md }}>
        {ACCS.map((v) => (
          <Chip key={v} label={t(`acc_${v}`)} active={acc === v} onPress={() => setAcc(v)} />
        ))}
      </View>

      <Text style={label('freeform')}>{t('personaFreeform')}</Text>
      <TextInput
        multiline
        value={freeform}
        onChangeText={setFreeform}
        style={{
          borderWidth: 1, borderColor: theme.rule, borderRadius: radius.field, minHeight: 64,
          padding: 12, color: theme.ink, marginBottom: spacing.lg, textAlign: 'right', textAlignVertical: 'top',
        }}
      />

      <Pressable
        disabled={busy || !coachName.trim()}
        onPress={save}
        style={{
          backgroundColor: coachName.trim() ? theme.accent : theme.rule,
          padding: 14, borderRadius: radius.pill, alignItems: 'center',
        }}
      >
        <Text style={{ color: coachName.trim() ? theme.onAccent : theme.inkSoft, fontWeight: '700' }}>
          {mode === 'onboarding' ? t('finishSetup') : t('save')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
