import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ApiError, callFn } from '../lib/api';
import { supabase } from '../lib/supabase';
import { DismissKeyboardView } from './DismissKeyboardView';
import { PlanPreview, type ParsedPlan } from './PlanPreview';
import { SketchLoader } from './SketchLoader';
import { Field } from './Field';
import { useLanguage } from '../lib/language';
import { useUnits, parseWeightToKg, parseHeightToCm, weightUnitLabel } from '../lib/units';
import { useTheme, spacing, radius } from '../theme';

type PrimaryGoal = 'strength' | 'hypertrophy' | 'general_fitness' | 'fat_loss';
type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
type Gender = 'male' | 'female' | 'other';
type Step = 'goal' | 'experience' | 'days' | 'about' | 'injuries' | 'generating' | 'error' | 'preview';

interface LinterCheck {
  pattern: 'push' | 'pull' | 'squat' | 'hinge';
  covered: boolean;
  exampleExercise: string | null;
}

const GOALS: PrimaryGoal[] = ['strength', 'hypertrophy', 'general_fitness', 'fat_loss'];
const LEVELS: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced'];
const DAY_OPTIONS = [1, 2, 3, 4, 5, 6];
const GENERATING_LINES = ['genLine1', 'genLine2', 'genLine3'];
const TOTAL_INTAKE_STEPS = 5;
// Feedback from early beta testers: no way to go back and fix an earlier
// answer without abandoning the whole intake. Each step now knows the one
// before it; stepping back from 'goal' (nothing before it) exits instead.
const PREV_STEP: Partial<Record<Step, Step>> = {
  experience: 'goal',
  days: 'experience',
  about: 'days',
  injuries: 'about',
};

/**
 * AI-generated training plans (System Design §21): a short structured
 * intake — deliberately a fixed sequence the app controls, not a chat,
 * since every input here is a small enumerable fact — followed by one
 * generation call and the same editable preview a pasted plan gets.
 */
export function GeneratePlanFlow({
  mode, onCancel, onDone,
}: {
  mode: 'onboarding' | 'add';
  onCancel: () => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir, language } = useLanguage();
  const { units } = useUnits();

  const [step, setStep] = useState<Step>('goal');
  const [primaryGoal, setPrimaryGoal] = useState<PrimaryGoal | null>(null);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | null>(null);
  const [daysPerWeek, setDaysPerWeek] = useState<number | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const [age, setAge] = useState('');
  // Typed in whatever the units toggle on this step is currently set to,
  // converted to kg/cm only at save time — never assumed to already be
  // metric.
  const [weightInput, setWeightInput] = useState('');
  const [heightInput, setHeightInput] = useState('');
  const [injuryNotes, setInjuryNotes] = useState('');

  const [preview, setPreview] = useState<ParsedPlan[] | null>(null);
  // See DismissKeyboardView's `active` prop doc — the starting-weights
  // step's ScrollView doesn't reliably scroll nested under this screen's
  // TouchableWithoutFeedback, so that wrapper drops out once PlanPreview
  // signals it's showing that step.
  const [startingWeightsActive, setStartingWeightsActive] = useState(false);
  const [linterChecks, setLinterChecks] = useState<LinterCheck[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [budgetExhausted, setBudgetExhausted] = useState(false);
  const [lineIdx, setLineIdx] = useState(0);

  useEffect(() => {
    if (step !== 'generating') return;
    const id = setInterval(() => setLineIdx((i) => (i + 1) % GENERATING_LINES.length), 1800);
    return () => clearInterval(id);
  }, [step]);

  // Saved as soon as the user moves past this step (System Design §21) —
  // goal/experience/days are already chosen by now, so the row is valid
  // even if generation never runs. Direct client write (fitness_profiles
  // is client-writable, same as coach_profiles), not the generate call.
  async function saveAboutYouAndContinue() {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (userId && primaryGoal && experienceLevel && daysPerWeek) {
      await supabase.from('fitness_profiles').upsert({
        user_id: userId,
        primary_goal: primaryGoal,
        experience_level: experienceLevel,
        days_per_week: daysPerWeek,
        gender,
        age: age.trim() ? parseInt(age, 10) : null,
        weight_kg: weightInput.trim() ? parseWeightToKg(weightInput, units) : null,
        height_cm: heightInput.trim() ? parseHeightToCm(heightInput, units) : null,
      });
    }
    setStep('injuries');
  }

  async function generate() {
    setStep('generating');
    try {
      const res = await callFn<{ plans: ParsedPlan[]; linterChecks: LinterCheck[] }>('plan-generate', {
        primaryGoal,
        experienceLevel,
        daysPerWeek,
        gender,
        age: age.trim() ? parseInt(age, 10) : null,
        weightKg: weightInput.trim() ? parseWeightToKg(weightInput, units) : null,
        heightCm: heightInput.trim() ? parseHeightToCm(heightInput, units) : null,
        injuryNotes: injuryNotes.trim() ? injuryNotes.trim() : null,
        language,
      });
      setPreview(res.plans);
      setLinterChecks(res.linterChecks);
      setStep('preview');
    } catch (e) {
      const exhausted = e instanceof ApiError && e.code === 'monthly_budget_exhausted';
      setErrorMessage(exhausted ? t('budgetExhausted') : t('generateFailed'));
      setBudgetExhausted(exhausted);
      setStep('error');
    }
  }

  const progressStep = { goal: 1, experience: 2, days: 3, about: 4, injuries: 5 }[step as string] ?? 0;

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

  function ChoiceCard({ selected, label, onPress }: {
    selected: boolean; label: string; onPress: () => void;
  }) {
    return (
      <Pressable
        onPress={onPress}
        style={{
          flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'space-between',
          backgroundColor: selected ? theme.surface : theme.surface,
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

  if (step === 'goal') {
    return (
      <DismissKeyboardView style={{ padding: spacing.lg }}>
        <Header progress={progressStep} />
        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.xs }}>
          {t('goalTitle')}
        </Text>
        <Text style={{ color: theme.inkSoft, textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.md }}>{t('goalSub')}</Text>
        {GOALS.map((g) => (
          <ChoiceCard
            key={g}
            selected={primaryGoal === g}
            label={t(`goal_${g}`)}
            onPress={() => {
              setPrimaryGoal(g);
              setStep('experience');
            }}
          />
        ))}
      </DismissKeyboardView>
    );
  }

  if (step === 'experience') {
    return (
      <DismissKeyboardView style={{ padding: spacing.lg }}>
        <Header progress={progressStep} />
        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.md }}>
          {t('experienceTitle')}
        </Text>
        {LEVELS.map((lvl) => (
          <ChoiceCard
            key={lvl}
            selected={experienceLevel === lvl}
            label={t(`level_${lvl}`)}
            onPress={() => {
              setExperienceLevel(lvl);
              setStep('days');
            }}
          />
        ))}
      </DismissKeyboardView>
    );
  }

  if (step === 'days') {
    return (
      <DismissKeyboardView style={{ padding: spacing.lg }}>
        <Header progress={progressStep} />
        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.xs }}>
          {t('daysTitle')}
        </Text>
        <Text style={{ color: theme.inkSoft, textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.md }}>{t('daysSub')}</Text>
        <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {DAY_OPTIONS.map((d) => (
            <Pressable
              key={d}
              onPress={() => {
                setDaysPerWeek(d);
                setStep('about');
              }}
              style={{
                width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
                backgroundColor: theme.surface, borderWidth: 1.5,
                borderColor: daysPerWeek === d ? theme.accent : 'transparent',
              }}
            >
              <Text style={{ color: theme.ink, fontWeight: '800', fontSize: 16 }}>{d}</Text>
            </Pressable>
          ))}
        </View>
      </DismissKeyboardView>
    );
  }

  if (step === 'about') {
    return (
      <DismissKeyboardView style={{ padding: spacing.lg }}>
        <Header progress={progressStep} />
        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.xs }}>
          {t('aboutTitle')}
        </Text>
        <Text style={{ color: theme.inkSoft, textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.md }}>{t('aboutSub')}</Text>

        {/* Units (kg/cm vs lb/ft) follow the app's language now — no picker
            here anymore, just the fields themselves, labelled in whichever
            unit that implies (guidelines/units-setting.html). */}
        <Text style={{ color: theme.inkSoft, fontSize: 11, fontWeight: '600', textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: 6 }}>
          {t('genderLabel')}
        </Text>
        <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: 6, marginBottom: spacing.md }}>
          {(['male', 'female', 'other'] as Gender[]).map((g) => (
            <Pressable
              key={g}
              onPress={() => setGender(gender === g ? null : g)}
              style={{
                flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.field,
                backgroundColor: theme.surface, borderWidth: 1.5,
                borderColor: gender === g ? theme.accent : 'transparent',
              }}
            >
              <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 12.5 }}>{t(`gender_${g}`)}</Text>
            </Pressable>
          ))}
        </View>

        <Field
          label={t('ageLabel')}
          placeholder={t('agePlaceholder')}
          value={age}
          onChangeText={setAge}
          keyboardType="number-pad"
          style={{ marginBottom: spacing.sm }}
        />
        <Field
          label={t('weightLabel')}
          placeholder={units === 'metric' ? t('weightPlaceholder') : t('weightPlaceholderImperial')}
          value={weightInput}
          onChangeText={setWeightInput}
          keyboardType="decimal-pad"
          unit={weightUnitLabel(units)}
          style={{ marginBottom: spacing.sm }}
        />
        <Field
          label={t('heightLabel')}
          placeholder={units === 'metric' ? t('heightPlaceholder') : t('heightPlaceholderImperial')}
          value={heightInput}
          onChangeText={setHeightInput}
          keyboardType="decimal-pad"
          unit={units === 'metric' ? t('cmLabel') : t('inLabel')}
          style={{ marginBottom: spacing.sm }}
        />

        <Pressable
          onPress={saveAboutYouAndContinue}
          style={{ backgroundColor: theme.accent, padding: 14, borderRadius: radius.pill, alignItems: 'center', marginTop: spacing.sm }}
        >
          <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{t('continue')}</Text>
        </Pressable>
        <Pressable onPress={saveAboutYouAndContinue} style={{ alignItems: 'center', marginTop: spacing.sm }}>
          <Text style={{
            color: theme.accent, fontWeight: '700', fontSize: 12.5,
            borderWidth: 1.5, borderColor: theme.accent, borderRadius: radius.pill,
            paddingVertical: 9, paddingHorizontal: 16, overflow: 'hidden',
          }}>
            {t('skipStep')}
          </Text>
        </Pressable>
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
        <Text style={{ color: theme.inkSoft, textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.md }}>{t('injuriesSub')}</Text>
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
          <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{t('finishIntake')}</Text>
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

  if (step === 'error') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md }}>
        <Text style={{ color: theme.ink, textAlign: 'center', fontWeight: '600' }}>{errorMessage}</Text>
        <Pressable
          onPress={budgetExhausted ? () => router.push('/subscribe') : generate}
          style={{ backgroundColor: theme.accent, paddingVertical: 12, paddingHorizontal: 24, borderRadius: radius.pill }}
        >
          <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{budgetExhausted ? t('subscription') : t('tryAgain')}</Text>
        </Pressable>
        <Pressable onPress={onCancel}>
          <Text style={{ color: theme.inkSoft, fontWeight: '600' }}>{t('cancel')}</Text>
        </Pressable>
      </View>
    );
  }

  // step === 'preview'
  if (!preview) return null;
  const uncovered = linterChecks.filter((c) => !c.covered);
  return (
    <DismissKeyboardView style={{ padding: spacing.lg }} active={!startingWeightsActive}>
      <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: 4 }}>
        {t('generatedTitle')}
      </Text>
      <Text style={{ color: theme.inkSoft, fontSize: 12.5, marginBottom: spacing.sm, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
        {t('tapToChangeHint')}
      </Text>
      <PlanPreview
        preview={preview}
        setPreview={setPreview}
        mode={mode === 'onboarding' ? 'onboarding' : 'add'}
        onDone={onDone}
        showTryAgain={false}
        onEnterStartingWeights={() => setStartingWeightsActive(true)}
        extraNote={
          <View style={{ marginBottom: spacing.sm }}>
            {uncovered.map((c) => (
              <Text key={c.pattern} style={{ color: theme.warning, fontSize: 12, textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: 4 }}>
                {t('linterWarning', { pattern: t(`pattern_${c.pattern}`) })}
              </Text>
            ))}
            <View style={{ borderWidth: 1, borderColor: theme.rule, borderRadius: radius.card, padding: spacing.sm }}>
              <Text style={{ textAlign: dir === 'rtl' ? 'right' : 'left' }}>
                <Text style={{ color: theme.accent, fontWeight: '700' }}>{t('aiDisclaimerLabel')} — </Text>
                <Text style={{ color: theme.ink }}>{t('aiDisclaimerBody')}</Text>
              </Text>
            </View>
          </View>
        }
      />
    </DismissKeyboardView>
  );
}

