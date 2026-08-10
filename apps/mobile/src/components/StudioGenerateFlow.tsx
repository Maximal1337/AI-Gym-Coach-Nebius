import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../lib/api';
import { fetchAccessStatus } from '../lib/subscription';
import {
  existingOpenSessionId, openStudioSession, STUDIO_EQUIPMENT_OPTIONS,
  type GenerateStudioIntake, type StudioEquipment,
} from '../lib/studioApi';
import { DismissKeyboardView } from './DismissKeyboardView';
import { SketchLoader } from './SketchLoader';
import { Chip } from './Chip';
import { useLanguage } from '../lib/language';
import { useTheme, spacing, radius } from '../theme';

type FitnessLevel = GenerateStudioIntake['fitnessLevel'];
type Focus = GenerateStudioIntake['focus'];
type Step = 'level' | 'duration' | 'equipment' | 'focus' | 'injuries' | 'generating' | 'error';

const LEVELS: FitnessLevel[] = ['beginner', 'intermediate', 'advanced'];
const DURATIONS = [15, 20, 30, 45, 60];
const FOCUSES: Focus[] = ['conditioning', 'strength', 'mixed'];
const GENERATING_LINES = ['studioGenLine1', 'studioGenLine2', 'studioGenLine3'];
const TOTAL_INTAKE_STEPS = 5;
const PREV_STEP: Partial<Record<Step, Step>> = {
  duration: 'level',
  equipment: 'duration',
  focus: 'equipment',
  injuries: 'focus',
};

/**
 * AI-generated studio workouts — the class-workout sibling of
 * GeneratePlanFlow.tsx. Shorter than the gym intake (no body stats — a
 * studio board rarely prescribes a precise kg number the way a gym plan
 * does) and, unlike the gym flow, has no separate preview/commit step: a
 * generated workout opens as a live studio session exactly like a parsed
 * board does, and the session screen itself is the review/edit surface.
 */
export function StudioGenerateFlow({
  onCancel, onDone,
}: {
  onCancel: () => void;
  onDone: (sessionId: string) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir, language } = useLanguage();

  const [step, setStep] = useState<Step>('level');
  const [fitnessLevel, setFitnessLevel] = useState<FitnessLevel | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [equipment, setEquipment] = useState<StudioEquipment[]>(['bodyweight']);
  const [customEquipment, setCustomEquipment] = useState<string[]>([]);
  const [customEquipmentInput, setCustomEquipmentInput] = useState('');
  const [focus, setFocus] = useState<Focus | null>(null);
  const [injuryNotes, setInjuryNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [lineIdx, setLineIdx] = useState(0);

  // Front-load the entitlement check, same reasoning as GeneratePlanFlow's
  // 'add' case: show the paywall immediately instead of after 5 questions.
  // Studio has no onboarding-mode exception — it's never a mandatory
  // first-run flow the way the gym plan intake can be.
  useEffect(() => {
    fetchAccessStatus().then((s) => {
      if (!s.entitled) {
        setErrorMessage(t('trialExpired'));
        setBlocked(true);
        setStep('error');
      }
    });
  }, [t]);

  function toggleEquipment(opt: StudioEquipment) {
    setEquipment((cur) => (cur.includes(opt) ? cur.filter((e) => e !== opt) : [...cur, opt]));
  }

  function addCustomEquipment() {
    const value = customEquipmentInput.trim();
    if (!value || customEquipment.length >= 5 || customEquipment.includes(value)) return;
    setCustomEquipment((cur) => [...cur, value]);
    setCustomEquipmentInput('');
  }

  function removeCustomEquipment(value: string) {
    setCustomEquipment((cur) => cur.filter((e) => e !== value));
  }

  async function generate() {
    setStep('generating');
    const id = setInterval(() => setLineIdx((i) => (i + 1) % GENERATING_LINES.length), 1800);
    try {
      const intake: GenerateStudioIntake = {
        fitnessLevel: fitnessLevel!,
        durationMin: durationMin!,
        equipment: equipment.length > 0 ? equipment : ['bodyweight'],
        customEquipment,
        focus: focus!,
        injuryNotes: injuryNotes.trim() ? injuryNotes.trim() : null,
        language,
      };
      const res = await openStudioSession({ generate: intake });
      onDone(res.sessionId);
    } catch (e) {
      const existing = await existingOpenSessionId(e);
      if (existing) { onDone(existing); return; }
      const trialExpired = e instanceof ApiError && e.code === 'subscription_required';
      const budgetExhausted = e instanceof ApiError && e.code === 'monthly_budget_exhausted';
      setErrorMessage(trialExpired ? t('trialExpired') : budgetExhausted ? t('budgetExhausted') : t('generateStudioFailed'));
      setBlocked(trialExpired || budgetExhausted);
      setStep('error');
    } finally {
      clearInterval(id);
    }
  }

  const progressStep = { level: 1, duration: 2, equipment: 3, focus: 4, injuries: 5 }[step as string] ?? 0;

  function goBack() {
    const prev = PREV_STEP[step];
    if (prev) setStep(prev);
    else onCancel();
  }

  function Header({ progress }: { progress: number }) {
    return (
      <View style={{ marginBottom: spacing.md }}>
        <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
          <Pressable onPress={goBack} hitSlop={10}>
            <Ionicons name={dir === 'rtl' ? 'chevron-forward' : 'chevron-back'} size={20} color={theme.inkSoft} />
          </Pressable>
          <View style={{ flex: 1, height: 3, borderRadius: 3, backgroundColor: theme.rule, overflow: 'hidden' }}>
            <View style={{ width: `${progress * 20}%`, height: '100%', backgroundColor: theme.accent, borderRadius: 3 }} />
          </View>
        </View>
        <Text style={{ color: theme.inkSoft, fontSize: 11, fontWeight: '700', textAlign: dir === 'rtl' ? 'right' : 'left' }}>
          {t('generateStepOf', { current: progress, total: TOTAL_INTAKE_STEPS })}
        </Text>
      </View>
    );
  }

  function ChoiceCard({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) {
    return (
      <Pressable
        onPress={onPress}
        style={{
          flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'space-between',
          backgroundColor: theme.surface,
          borderWidth: 1.5, borderColor: selected ? theme.accent : 'transparent',
          borderRadius: radius.card, padding: spacing.md, marginBottom: spacing.sm,
        }}
      >
        <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 14 }}>{label}</Text>
        {selected && (
          <View style={{
            width: 18, height: 18, borderRadius: 9, backgroundColor: theme.accent,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: theme.onAccent, fontSize: 11, fontWeight: '900' }}>✓</Text>
          </View>
        )}
      </Pressable>
    );
  }

  if (step === 'level') {
    return (
      <DismissKeyboardView style={{ padding: spacing.lg }}>
        <Header progress={progressStep} />
        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.md }}>
          {t('studioLevelTitle')}
        </Text>
        {LEVELS.map((lvl) => (
          <ChoiceCard
            key={lvl}
            selected={fitnessLevel === lvl}
            label={t(`level_${lvl}`)}
            onPress={() => { setFitnessLevel(lvl); setStep('duration'); }}
          />
        ))}
      </DismissKeyboardView>
    );
  }

  if (step === 'duration') {
    return (
      <DismissKeyboardView style={{ padding: spacing.lg }}>
        <Header progress={progressStep} />
        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.md }}>
          {t('studioDurationTitle')}
        </Text>
        <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {DURATIONS.map((d) => (
            <Pressable
              key={d}
              onPress={() => { setDurationMin(d); setStep('equipment'); }}
              style={{
                width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
                backgroundColor: theme.surface, borderWidth: 1.5,
                borderColor: durationMin === d ? theme.accent : 'transparent',
              }}
            >
              <Text style={{ color: theme.ink, fontWeight: '800', fontSize: 15 }}>{d}</Text>
              <Text style={{ color: theme.inkSoft, fontSize: 10 }}>{t('minutesLabel')}</Text>
            </Pressable>
          ))}
        </View>
      </DismissKeyboardView>
    );
  }

  if (step === 'equipment') {
    return (
      <DismissKeyboardView style={{ padding: spacing.lg }}>
        <Header progress={progressStep} />
        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.xs }}>
          {t('studioEquipmentTitle')}
        </Text>
        <Text style={{ color: theme.inkSoft, textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.md }}>
          {t('studioEquipmentSub')}
        </Text>
        <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
          {STUDIO_EQUIPMENT_OPTIONS.map((opt) => (
            <Chip key={opt} selected={equipment.includes(opt)} onPress={() => toggleEquipment(opt)}>
              {t(`equipment_${opt}`)}
            </Chip>
          ))}
          {customEquipment.map((item) => (
            // A custom item's only interaction is removal — accessible label
            // spells that out since the "×" alone doesn't read aloud.
            <Chip key={item} selected onPress={() => removeCustomEquipment(item)}>
              {`${item} ×`}
            </Chip>
          ))}
        </View>
        {customEquipment.length < 5 && (
          <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: spacing.sm, marginBottom: spacing.lg }}>
            <TextInput
              value={customEquipmentInput}
              onChangeText={setCustomEquipmentInput}
              onSubmitEditing={addCustomEquipment}
              placeholder={t('customEquipmentPlaceholder')}
              placeholderTextColor={theme.inkSoft}
              style={{
                flex: 1, backgroundColor: theme.surface, borderRadius: radius.field,
                paddingHorizontal: 14, paddingVertical: 10, color: theme.ink, textAlign: dir === 'rtl' ? 'right' : 'left',
              }}
            />
            <Pressable
              disabled={!customEquipmentInput.trim()}
              onPress={addCustomEquipment}
              accessibilityLabel={t('customEquipmentAdd')}
              style={{
                width: 44, height: 44, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center',
                backgroundColor: customEquipmentInput.trim() ? theme.accent : theme.rule,
              }}
            >
              <Ionicons name="add" size={20} color={customEquipmentInput.trim() ? theme.onAccent : theme.inkSoft} />
            </Pressable>
          </View>
        )}
        <Pressable
          disabled={equipment.length === 0 && customEquipment.length === 0}
          onPress={() => setStep('focus')}
          style={{
            backgroundColor: equipment.length === 0 && customEquipment.length === 0 ? theme.rule : theme.accent,
            padding: 14, borderRadius: radius.pill, alignItems: 'center',
          }}
        >
          <Text style={{ color: equipment.length === 0 && customEquipment.length === 0 ? theme.inkSoft : theme.onAccent, fontWeight: '700' }}>
            {t('continue')}
          </Text>
        </Pressable>
      </DismissKeyboardView>
    );
  }

  if (step === 'focus') {
    return (
      <DismissKeyboardView style={{ padding: spacing.lg }}>
        <Header progress={progressStep} />
        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.md }}>
          {t('studioFocusTitle')}
        </Text>
        {FOCUSES.map((f) => (
          <ChoiceCard
            key={f}
            selected={focus === f}
            label={t(`focus_${f}`)}
            onPress={() => { setFocus(f); setStep('injuries'); }}
          />
        ))}
      </DismissKeyboardView>
    );
  }

  if (step === 'injuries') {
    return (
      <DismissKeyboardView style={{ padding: spacing.lg }}>
        <Header progress={progressStep} />
        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.xs }}>
          {t('injuriesTitle')}
        </Text>
        <Text style={{ color: theme.inkSoft, textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.md }}>
          {t('injuriesSub')}
        </Text>
        <TextInput
          multiline
          value={injuryNotes}
          onChangeText={setInjuryNotes}
          placeholder={t('injuriesPlaceholder')}
          placeholderTextColor={theme.inkSoft}
          style={{
            minHeight: 100, backgroundColor: theme.surface, borderRadius: radius.card,
            padding: spacing.md, color: theme.ink, textAlign: dir === 'rtl' ? 'right' : 'left', textAlignVertical: 'top',
            marginBottom: spacing.md,
          }}
        />
        <Pressable
          onPress={generate}
          style={{ backgroundColor: theme.accent, padding: 14, borderRadius: radius.pill, alignItems: 'center' }}
        >
          <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{t('finishStudioIntake')}</Text>
        </Pressable>
        {injuryNotes.trim().length > 0 && (
          <Pressable onPress={() => { setInjuryNotes(''); generate(); }} style={{ alignItems: 'center', marginTop: spacing.sm }}>
            <Text style={{
              color: theme.accent, fontWeight: '700', fontSize: 12.5,
              borderWidth: 1.5, borderColor: theme.accent, borderRadius: radius.pill,
              paddingVertical: 9, paddingHorizontal: 16, overflow: 'hidden',
            }}>
              {t('skipStep')}
            </Text>
          </Pressable>
        )}
        <Text style={{ color: theme.inkSoft, fontSize: 10.5, lineHeight: 15, textAlign: dir === 'rtl' ? 'right' : 'left', marginTop: spacing.md }}>
          <Text style={{ fontWeight: '700' }}>{t('aiDisclaimerLabel')} — </Text>
          {t('aiDisclaimerBodyStudio')}
        </Text>
      </DismissKeyboardView>
    );
  }

  if (step === 'generating') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <SketchLoader label={t(GENERATING_LINES[lineIdx])} dir={dir} />
      </View>
    );
  }

  // step === 'error'
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md }}>
      <Text style={{ color: theme.ink, textAlign: 'center', fontWeight: '600' }}>{errorMessage}</Text>
      <Pressable
        onPress={blocked ? () => router.push('/subscribe') : generate}
        style={{ backgroundColor: theme.accent, paddingVertical: 12, paddingHorizontal: 24, borderRadius: radius.pill }}
      >
        <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{blocked ? t('subscription') : t('tryAgain')}</Text>
      </Pressable>
      <Pressable onPress={onCancel}>
        <Text style={{ color: theme.inkSoft, fontWeight: '600' }}>{t('cancel')}</Text>
      </Pressable>
    </View>
  );
}
