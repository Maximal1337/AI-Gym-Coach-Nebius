import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../src/lib/supabase';
import { callFn, ApiError } from '../../src/lib/api';
import { enqueueTurn, setPendingTurnHandlers, type TurnResult } from '../../src/lib/pendingTurn';
import {
  enqueueSessionStart, setPendingSessionStartHandlers, type SessionStartResult,
} from '../../src/lib/pendingSessionStart';
import { Screen } from '../../src/components/Screen';
import { MarkdownText } from '../../src/components/MarkdownText';
import { ConfettiBurst } from '../../src/components/ConfettiBurst';
import { SuggestedActionBar } from '../../src/components/SuggestedActionBar';
import { useTheme, spacing, radius, typography, TAB_BAR_CLEARANCE } from '../../src/theme';

interface Plan { id: string; name: string }
interface Exercise { id: string; name: string; sets: number; order_index: number }
interface SuggestedAction { exerciseId: string; weightKg: number; targetReps: number[] }
interface Msg { id: string; from: 'coach' | 'me' | 'system'; text: string }

/** "58 ק"ג × 8/8/8" when every set shares a weight (the common case), else a per-set list. */
function formatConfirmedSets(sets: Array<{ weightKg: number; reps: number }>): string {
  const sameWeight = sets.every((s) => s.weightKg === sets[0].weightKg);
  return sameWeight
    ? `${sets[0].weightKg} ק"ג × ${sets.map((s) => s.reps).join('/')}`
    : sets.map((s) => `${s.weightKg}×${s.reps}`).join(', ');
}

/** The core screen: free-text chat, single complete coach messages (GYM-28/61/67). */
export default function Chat() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentExerciseId, setCurrentExerciseId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [pendingAction, setPendingAction] = useState<SuggestedAction | null>(null);
  const list = useRef<FlatList>(null);
  const nextId = useRef(0);

  // useFocusEffect, not a plain mount-only effect: a plan added/edited/
  // archived via Settings > Manage Training Plans must show up here
  // without needing a full app reload.
  useFocusEffect(
    useCallback(() => {
      supabase.from('training_plans').select('id, name').eq('status', 'active')
        .then(({ data }) => setPlans(data ?? []));
    }, []),
  );

  function push(from: Msg['from'], text: string) {
    setMsgs((m) => [...m, { id: String(nextId.current++), from, text }]);
    setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  }

  function coachError(e: unknown) {
    if (e instanceof ApiError && e.code === 'monthly_budget_exhausted') push('system', t('budgetExhausted'));
    else if (e instanceof ApiError && e.code === 'session_expired') push('system', t('sessionExpired'));
    else push('system', t('coachUnavailable'));
  }

  // The LLM composes messages in prose and can occasionally mistranscribe
  // a number while doing so — appending the deterministic target (from
  // progression.ts, never touched by the LLM) guarantees the number the
  // user actually sees is correct, regardless of what the prose says.
  function withTarget(message: string, weightKg: number | null, reps: number[] | null) {
    if (weightKg == null || !reps || reps.length === 0) return message;
    return `${message}\n\n${t('targetLine', { weight: weightKg, reps: reps.join('/') })}`;
  }

  function handleTurnResult(res: TurnResult) {
    // The server always computes the *next* exercise's target so it's ready
    // if the turn advances, but a turn that stays on the current exercise
    // (e.g. a note, a question) shouldn't show a target for a different
    // exercise the user isn't even being introduced to yet.
    const text = res.advance
      ? withTarget(res.message, res.nextSuggestedWeightKg, res.nextTargetReps)
      : res.message;
    push('coach', text);
    if (!res.advance) return; // same exercise still in play — leave pendingAction as-is
    if (res.sessionComplete) {
      setPendingAction(null);
      void finish();
      return;
    }
    setCurrentExerciseId(res.nextExerciseId);
    setPendingAction(
      res.nextExerciseId && res.nextSuggestedWeightKg != null &&
        res.nextTargetReps && res.nextTargetReps.length > 0
        ? { exerciseId: res.nextExerciseId, weightKg: res.nextSuggestedWeightKg, targetReps: res.nextTargetReps }
        : null,
    );
  }

  function handleSessionStartResult(res: SessionStartResult) {
    setSessionId(res.sessionId);
    setCurrentExerciseId(res.exerciseId);
    push('coach', withTarget(res.message, res.suggestedWeightKg, res.targetReps));
    setPendingAction(
      res.suggestedWeightKg != null && res.targetReps && res.targetReps.length > 0
        ? { exerciseId: res.exerciseId, weightKg: res.suggestedWeightKg, targetReps: res.targetReps }
        : null,
    );
  }

  // Generative-UI confirm action (System Design §19): deterministic on the
  // server (no LLM call) — logs the given sets and advances, same shape as
  // a parsed free-text confirmation. Echoes what was confirmed as the
  // user's own message first, same as send() does for free text — without
  // it the transcript looked like the coach replying to itself.
  // pendingAction is only cleared on success, so a network failure leaves
  // the bar in place, tappable again.
  async function confirmSets(exerciseId: string, sets: Array<{ weightKg: number; reps: number }>) {
    if (!sessionId || busy) return;
    push('me', formatConfirmedSets(sets));
    setBusy(true);
    try {
      const res = await callFn<TurnResult>('coach-turn', { sessionId, exerciseId, confirmedSets: sets });
      handleTurnResult(res);
    } catch (e) {
      coachError(e);
    } finally {
      setBusy(false);
    }
  }

  // A message that failed to send over the network retries automatically
  // on reconnect (pendingTurn.ts) — wire its outcome back into this chat.
  useEffect(() => {
    setPendingTurnHandlers({ onDelivered: handleTurnResult, onFailed: coachError });
    return () => setPendingTurnHandlers(null);
  }, [sessionId, currentExerciseId]);

  // Same resilience for starting a workout — the call most likely to still
  // be in flight when the app gets backgrounded (Fly.io cold starts).
  useEffect(() => {
    setPendingSessionStartHandlers({ onDelivered: handleSessionStartResult, onFailed: coachError });
    return () => setPendingSessionStartHandlers(null);
  }, []);

  async function start(plan: Plan) {
    setBusy(true);
    push('me', plan.name);
    try {
      const { data } = await supabase
        .from('exercises').select('id, name, sets, order_index')
        .eq('plan_id', plan.id).order('order_index');
      setExercises(data ?? []);
      handleSessionStartResult(
        await callFn<SessionStartResult>('session-start', { planId: plan.id }),
      );
    } catch (e) {
      if (e instanceof ApiError) {
        coachError(e);
      } else {
        // A network-level failure, not a server rejection — queue it and
        // retry on reconnect instead of just giving up (pendingSessionStart.ts).
        // session-start is idempotent server-side, so retrying is safe.
        await enqueueSessionStart({ planId: plan.id });
        push('system', t('queuedOffline'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || !sessionId || !currentExerciseId || busy) return;
    setDraft('');
    push('me', text);
    setBusy(true);
    // Last few turns, so the coach has short-term memory of this
    // exchange (e.g. a target it just agreed to change).
    const recentHistory = msgs
      .filter((m) => m.from !== 'system')
      .slice(-10)
      .map((m) => ({ from: m.from as 'coach' | 'me', text: m.text }));
    const turn = { sessionId, exerciseId: currentExerciseId, userMessage: text, recentHistory };
    try {
      handleTurnResult(await callFn<TurnResult>('coach-turn', turn));
    } catch (e) {
      if (e instanceof ApiError) {
        setDraft(text); // server rejected it outright — let the user retry
        coachError(e);
      } else {
        // A network-level failure, not a server rejection — queue it
        // instead of losing the report; pendingTurn.ts retries on reconnect.
        await enqueueTurn(turn);
        push('system', t('queuedOffline'));
      }
    } finally {
      setBusy(false);
    }
  }

  // A tap on "Finish Workout" always goes through here first — if
  // exercises remain, confirm before actually ending, since nothing else
  // stops an accidental early finish (e.g. an ambiguous coach message
  // after the previous exercise reading like a wrap-up).
  function confirmFinish() {
    // currentExPos is 1-based and points at the exercise not yet
    // reported, so it counts toward "remaining" too.
    const remaining = exercises.length - currentExPos + 1;
    if (remaining <= 0) {
      void finish();
      return;
    }
    Alert.alert(
      t('finishEarlyTitle'),
      t('finishEarlySub', { count: remaining, name: currentEx?.name ?? '' }),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('finishWorkout'), style: 'destructive', onPress: () => void finish() },
      ],
    );
  }

  async function finish() {
    if (!sessionId) return;
    setBusy(true);
    try {
      const res = await callFn<{ exercises: Array<{ name: string; sets: string[] }> }>(
        'session-complete', { sessionId },
      );
      const lines = res.exercises.map((e) => `${e.name}: ${e.sets.join(', ')}`).join('\n');
      push('coach', `${t('workoutSummary')}\n${lines}`);
      setSessionId(null);
      setCurrentExerciseId(null);
      setPendingAction(null);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 2600);
    } catch (e) {
      // Keep the session so "finish" can be retried once back online —
      // clearing it here would strand an in_progress session server-side.
      coachError(e);
    } finally {
      setBusy(false);
    }
  }

  const inWorkout = sessionId !== null;
  const currentEx = exercises.find((e) => e.id === currentExerciseId);
  const currentExPos = currentEx ? exercises.findIndex((e) => e.id === currentEx.id) + 1 : 0;

  return (
    <Screen>
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        padding: spacing.md, borderBottomWidth: 1, borderBottomColor: theme.rule,
      }}>
        {inWorkout && (
          <Pressable disabled={busy} onPress={confirmFinish}>
            <Text style={{ color: theme.critical, fontWeight: '600', fontSize: 13 }}>{t('finishWorkout')}</Text>
          </Pressable>
        )}
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={{ color: theme.ink, fontWeight: '800', fontSize: 16, textAlign: 'right' }}>
            {t('chatTitle')}
          </Text>
          {inWorkout && currentEx && (
            <Text style={{ color: theme.inkSoft, fontSize: 12, textAlign: 'right' }}>
              {currentEx.name} · {currentExPos}/{exercises.length}
            </Text>
          )}
        </View>
      </View>

      <FlatList
        ref={list}
        data={msgs}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
        renderItem={({ item }) => (
          <View style={{ alignItems: item.from === 'me' ? 'flex-start' : 'flex-end' }}>
            <View style={{
              maxWidth: '82%',
              backgroundColor: item.from === 'me' ? theme.accent
                : item.from === 'system' ? theme.bg : theme.surface,
              borderWidth: item.from === 'system' ? 1 : 0,
              borderColor: theme.rule,
              borderRadius: radius.bubble,
              padding: 12,
            }}>
              {(() => {
                const messageStyle = {
                  color: item.from === 'me' ? theme.onAccent : item.from === 'system' ? theme.inkSoft : theme.ink,
                  fontSize: typography.message.size,
                  lineHeight: typography.message.lineHeight,
                  textAlign: 'right' as const,
                };
                // Only actual coach replies are LLM output — 'me' is the
                // user's own raw text and 'system' is static app copy,
                // neither needs (or should get) markdown parsing.
                return item.from === 'coach'
                  ? <MarkdownText style={messageStyle}>{item.text}</MarkdownText>
                  : <Text style={messageStyle}>{item.text}</Text>;
              })()}
            </View>
          </View>
        )}
      />

      {busy && (
        <View style={{ flexDirection: 'row-reverse', gap: 8, padding: spacing.sm, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={theme.inkSoft} />
          <Text style={{ color: theme.inkSoft, fontSize: 12 }}>{t('typing')}</Text>
        </View>
      )}

      {inWorkout && pendingAction && (
        <SuggestedActionBar
          weightKg={pendingAction.weightKg}
          targetReps={pendingAction.targetReps}
          disabled={busy}
          onConfirmExact={() => {
            const action = pendingAction;
            void confirmSets(
              action.exerciseId,
              action.targetReps.map((reps) => ({ weightKg: action.weightKg, reps })),
            );
          }}
          onSubmitSets={(sets) => void confirmSets(pendingAction.exerciseId, sets)}
        />
      )}

      {!inWorkout ? (
        <View style={{ padding: spacing.md, paddingBottom: TAB_BAR_CLEARANCE }}>
          <Text style={{ color: theme.inkSoft, textAlign: 'right', marginBottom: spacing.sm }}>
            {t('startWorkout')}
          </Text>
          <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 }}>
            {plans.map((p) => (
              <Pressable
                key={p.id}
                disabled={busy}
                onPress={() => start(p)}
                style={{ backgroundColor: theme.accent, paddingVertical: 10, paddingHorizontal: 16, borderRadius: radius.pill }}
              >
                <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{p.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <View style={{ padding: spacing.md, paddingBottom: TAB_BAR_CLEARANCE, borderTopWidth: 1, borderTopColor: theme.rule }}>
          <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
            <TextInput
              placeholder={t('messagePlaceholder')}
              placeholderTextColor={theme.inkSoft}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={200}
              style={{
                flex: 1, backgroundColor: theme.surface, borderRadius: radius.field,
                padding: 10, color: theme.ink, textAlign: 'right', maxHeight: 100,
              }}
            />
            <Pressable
              disabled={busy || !draft.trim()}
              onPress={send}
              style={{
                backgroundColor: draft.trim() ? theme.accent : theme.rule,
                borderRadius: radius.pill, paddingHorizontal: 16, justifyContent: 'center',
              }}
            >
              <Text style={{ color: draft.trim() ? theme.onAccent : theme.inkSoft, fontWeight: '700' }}>
                {t('send')}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
    <ConfettiBurst active={showConfetti} />
    </Screen>
  );
}
