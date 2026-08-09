import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/lib/supabase';
import { callFn } from '../../src/lib/api';
import { Screen } from '../../src/components/Screen';
import { NavBar } from '../../src/components/NavBar';
import { CoachMark } from '../../src/components/CoachMark';
import { LoadingOverlay } from '../../src/components/LoadingOverlay';
import { Button } from '../../src/components/Button';
import { BottomSheet } from '../../src/components/BottomSheet';
import { ChoiceCard } from '../../src/components/ChoiceCard';
import { AddWorkoutSheet, type AddWorkoutMethod } from '../../src/components/AddWorkoutSheet';
import { WorkoutCard, type WorkoutCardData } from '../../src/components/WorkoutCard';
import { Badge } from '../../src/components/Badge';
import { listStudioSessions, openStudioSession } from '../../src/lib/studioApi';
import { useLanguage } from '../../src/lib/language';
import { useTheme, spacing, TAB_BAR_CLEARANCE } from '../../src/theme';

interface PlanRow {
  id: string;
  name: string;
  exercises: { id: string; name: string; order_index: number }[];
  workout_sessions: { started_at: string; status: string }[];
}

/** The four "add a workout" methods a top-level tap can start, per
 * studio-implementation-brief.md §3.1 — resolved to a gym-or-studio route by
 * the second sheet below, since the real classifier (§2.0) is Phase 3. */
type AddMethod = 'generate' | 'photo' | 'paste' | 'upload' | 'build';

/** A single row inside the plan-actions sheet (guidelines/plan-actions.html's ActionRow). */
function ActionRow({
  icon, label, sub, warn, onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  warn?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { dir } = useLanguage();
  const fg = warn ? theme.warning : theme.ink;
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: spacing.md,
        paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.rule,
      }}
    >
      <Ionicons name={icon} size={19} color={warn ? theme.warning : theme.accent} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: fg, fontSize: 15, fontWeight: '600', textAlign: dir === 'rtl' ? 'right' : 'left' }}>
          {label}
        </Text>
        {sub && (
          <Text style={{ color: theme.inkSoft, fontSize: 12, marginTop: 2, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {sub}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

/**
 * The merged Plans tab (studio-implementation-brief.md §3) — durable gym
 * plans and one-off studio boards live in one screen, split by lifespan
 * (§3.0) rather than by category: "Your plans" (repeat-worthy, sorted by
 * last done) and "Recent sessions" (decaying, time-ordered). A photographed
 * board only ever becomes a plan if the trainee explicitly saves it as one
 * — nothing here promotes a session into "Your plans" on its own.
 */
export default function Plans() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<WorkoutCardData[]>([]);
  const [recent, setRecent] = useState<WorkoutCardData[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionsFor, setActionsFor] = useState<{ id: string; name: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingMethod, setPendingMethod] = useState<AddMethod | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      supabase
        .from('training_plans')
        .select('id, name, exercises(id, name, order_index), workout_sessions(started_at, status)')
        .eq('status', 'active'),
      listStudioSessions(),
    ])
      .then(([{ data }, studio]) => {
        const rows = (data ?? []) as unknown as PlanRow[];
        const cards: WorkoutCardData[] = rows.map((r) => {
          const exercises = [...r.exercises].sort((a, b) => a.order_index - b.order_index);
          const completedAt = r.workout_sessions
            .filter((s) => s.status === 'completed')
            .map((s) => s.started_at)
            .sort()
            .pop() ?? null;
          return {
            id: r.id,
            kind: 'gym',
            name: r.name,
            meta: t('exercisesCount', { count: exercises.length }),
            movements: exercises.slice(0, 4).map((e) => e.name),
            movementsMore: Math.max(0, exercises.length - 4),
            lastDoneAt: completedAt,
            intensity: null,
          };
        });
        // Last done, never creation order (§3.0) — never-done plans sort last.
        cards.sort((a, b) => (b.lastDoneAt ?? '').localeCompare(a.lastDoneAt ?? ''));
        setPlans(cards);

        setRecent(studio.recent.map((w) => ({
          id: w.id,
          kind: 'studio',
          name: w.name,
          meta: w.blockCount > 0
            ? t('blocksAndExercises', { blocks: w.blockCount, exercises: w.exerciseCount })
            : t('exercisesCount', { count: w.exerciseCount }),
          movements: w.movements,
          movementsMore: w.movementsMore,
          lastDoneAt: w.savedAt,
          intensity: w.intensity,
        })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [t]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Closing a Modal and pushing the next screen in the same tick races the
  // sheet's own dismiss animation against expo-router's push on iOS (see
  // the original comment this was ported from) — 300ms matches the sheet's
  // own slide-down duration.
  function navigateAfterSheetCloses(to: () => void) {
    setTimeout(to, 300);
  }

  function editGymPlan(planId: string, planName: string) {
    router.push({ pathname: '/plan-edit', params: { mode: 'edit', planId, planName } });
  }

  // Tapping a "Your plans" card starts it (studio-implementation-brief.md
  // §1.1 — Train is where a plan actually runs), not plan-edit — editing
  // stays reachable via the long-press action sheet's own "Edit plan" row.
  function startGymPlan(planId: string, planName: string) {
    router.push({ pathname: '/(tabs)/train', params: { startPlanId: planId, startPlanName: planName } });
  }

  function openStudioCard(sessionId: string) {
    router.push({ pathname: '/studio-session', params: { sessionId } });
  }

  async function archive(planId: string) {
    setActionsFor(null);
    setBusyLabel(t('archiving'));
    setBusyId(planId);
    try {
      await callFn('plan-import', { action: 'archive', planId });
      load();
    } catch {
      Alert.alert(t('coachUnavailable'));
    } finally {
      setBusyId(null);
    }
  }

  async function doOneAgainStudio(sessionId: string) {
    setBusy(true);
    try {
      const res = await openStudioSession({ sourceSessionId: sessionId });
      openStudioCard(res.sessionId);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'session_already_open') load();
      else Alert.alert(t('coachUnavailable'));
    } finally {
      setBusy(false);
    }
  }

  async function buildOwnStudio() {
    setBusy(true);
    try {
      const res = await openStudioSession({ blank: true });
      setAddOpen(false);
      setPendingMethod(null);
      navigateAfterSheetCloses(() => openStudioCard(res.sessionId));
    } catch {
      Alert.alert(t('coachUnavailable'));
    } finally {
      setBusy(false);
    }
  }

  // Closing the top "Add a new workout" sheet before opening the kind-
  // chooser one — two overlapping Modals otherwise leaves the second one
  // unresponsive (same race navigateAfterSheetCloses guards elsewhere).
  function openKindChooser(method: AddMethod) {
    setAddOpen(false);
    navigateAfterSheetCloses(() => setPendingMethod(method));
  }

  function resolveMethod(method: AddMethod, kind: 'gym' | 'studio') {
    setPendingMethod(null);
    setAddOpen(false);
    if (kind === 'studio' && method === 'build') { void buildOwnStudio(); return; }
    navigateAfterSheetCloses(() => {
      if (kind === 'gym') {
        if (method === 'generate') router.push({ pathname: '/plan-generate', params: { mode: 'add' } });
        else if (method === 'photo') router.push({ pathname: '/plan-photo', params: { mode: 'add' } });
        else if (method === 'paste') router.push({ pathname: '/plan-edit', params: { mode: 'add' } });
        else if (method === 'upload') router.push({ pathname: '/plan-edit', params: { mode: 'add', initialMode: 'upload' } });
        else router.push('/plan-build');
      } else {
        if (method === 'generate') router.push('/studio-generate');
        else if (method === 'photo') router.push('/studio-photo');
        else if (method === 'paste') router.push('/studio-paste');
        else router.push({ pathname: '/studio-paste', params: { initialMode: 'upload' } });
      }
    });
  }

  const addMethods: AddWorkoutMethod[] = [
    {
      emphasis: 'primary', icon: 'sparkles-outline', label: t('generateWithAiCta'), description: t('generateWithAiDesc'),
      badge: <Badge>AI</Badge>,
      onPress: () => openKindChooser('generate'),
    },
    { icon: 'camera-outline', label: t('choosePhoto'), description: t('choosePhotoDesc'), onPress: () => openKindChooser('photo') },
    { icon: 'clipboard-outline', label: t('choosePasteWorkout'), onPress: () => openKindChooser('paste') },
    { icon: 'document-attach-outline', label: t('chooseUpload'), onPress: () => openKindChooser('upload') },
    { icon: 'construct-outline', label: t('buildOwnWorkout'), onPress: () => openKindChooser('build') },
  ];

  return (
    <Screen>
      <LoadingOverlay visible={busyId !== null} object="plate" label={busyLabel} />
      <LoadingOverlay visible={busy} object="plate" label={t('parsing')} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.md, paddingBottom: TAB_BAR_CLEARANCE }}>
        <NavBar title={t('plansTab')} trailing={<CoachMark />} />

        <Button
          variant="primary" size="md" block
          icon={<Ionicons name="add" size={16} color={theme.onAccent} />}
          onPress={() => setAddOpen(true)}
          style={{ marginBottom: spacing.lg }}
        >
          {t('addNewWorkout')}
        </Button>

        {loading ? (
          <ActivityIndicator color={theme.accent} style={{ marginTop: spacing.xl }} />
        ) : (
          <>
            <Text style={{ color: theme.inkSoft, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: spacing.sm, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
              {t('yourPlans')}
            </Text>
            {plans.length === 0 ? (
              <Text style={{ color: theme.inkSoft, textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.lg }}>
                {t('noActivePlans')}
              </Text>
            ) : (
              <View style={{ gap: spacing.sm, marginBottom: spacing.lg, opacity: 1 }}>
                {plans.map((p) => (
                  <View key={p.id} style={{ opacity: busyId === p.id ? 0.5 : 1 }}>
                    <WorkoutCard
                      workout={p}
                      onPress={() => startGymPlan(p.id, p.name)}
                      onLongPress={() => setActionsFor({ id: p.id, name: p.name })}
                    />
                  </View>
                ))}
              </View>
            )}

            {recent.length > 0 && (
              <>
                <Text style={{ color: theme.inkSoft, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: spacing.sm, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
                  {t('recentSessions')}
                </Text>
                <View style={{ gap: spacing.sm }}>
                  {recent.map((w) => (
                    <WorkoutCard key={w.id} workout={w} onPress={() => void doOneAgainStudio(w.id)} />
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      <AddWorkoutSheet
        visible={addOpen}
        title={t('addNewWorkout')}
        onClose={() => setAddOpen(false)}
        methods={addMethods}
      />

      {/* Which kind this source is — a stand-in for the real parse-time
          classifier (studio-implementation-brief.md §2.0), deferred to a
          later pass. Only shown for photo/paste/upload/build, never for
          AI-generate (unambiguously a gym plan). Delete this sheet once the
          classifier lands and route addMethods directly instead. */}
      <BottomSheet visible={pendingMethod !== null} title={t('addNewWorkout')} onClose={() => setPendingMethod(null)}>
        <View style={{ gap: spacing.sm }}>
          <ChoiceCard
            icon="barbell-outline"
            label={t('kindGym')}
            onPress={() => pendingMethod && resolveMethod(pendingMethod, 'gym')}
          />
          <ChoiceCard
            icon="flame-outline"
            label={t('kindStudio')}
            onPress={() => pendingMethod && resolveMethod(pendingMethod, 'studio')}
          />
        </View>
      </BottomSheet>

      <BottomSheet visible={actionsFor !== null} title={actionsFor?.name ?? ''} onClose={() => setActionsFor(null)}>
        <ActionRow
          icon="create-outline"
          label={t('editPlan')}
          onPress={() => { if (actionsFor) editGymPlan(actionsFor.id, actionsFor.name); setActionsFor(null); }}
        />
        <ActionRow
          icon="archive-outline" warn
          label={t('archivePlan')}
          sub={t('archiveConfirmBody')}
          onPress={() => actionsFor && void archive(actionsFor.id)}
        />
      </BottomSheet>
    </Screen>
  );
}
