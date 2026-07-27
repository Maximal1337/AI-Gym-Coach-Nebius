import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../src/lib/supabase';
import { callFn, ApiError } from '../../src/lib/api';
import { enqueueTurn, setPendingTurnHandlers, type TurnResult } from '../../src/lib/pendingTurn';
import { Screen } from '../../src/components/Screen';
import { useTheme, spacing, radius, typography } from '../../src/theme';

interface Plan { id: string; name: string }
interface Exercise { id: string; name: string; sets: number; order_index: number }
interface Msg { id: string; from: 'coach' | 'me' | 'system'; text: string }

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
  const list = useRef<FlatList>(null);
  const nextId = useRef(0);

  useEffect(() => {
    supabase.from('training_plans').select('id, name').eq('status', 'active')
      .then(({ data }) => setPlans(data ?? []));
  }, []);

  function push(from: Msg['from'], text: string) {
    setMsgs((m) => [...m, { id: String(nextId.current++), from, text }]);
    setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  }

  function coachError(e: unknown) {
    if (e instanceof ApiError && e.code === 'monthly_budget_exhausted') push('system', t('budgetExhausted'));
    else if (e instanceof ApiError && e.code === 'session_expired') push('system', t('sessionExpired'));
    else push('system', t('coachUnavailable'));
  }

  function handleTurnResult(res: TurnResult) {
    push('coach', res.message);
    if (res.advance) {
      if (res.sessionComplete) void finish();
      else setCurrentExerciseId(res.nextExerciseId);
    }
  }

  // A message that failed to send over the network retries automatically
  // on reconnect (pendingTurn.ts) — wire its outcome back into this chat.
  useEffect(() => {
    setPendingTurnHandlers({ onDelivered: handleTurnResult, onFailed: coachError });
    return () => setPendingTurnHandlers(null);
  }, [sessionId, currentExerciseId]);

  async function start(plan: Plan) {
    setBusy(true);
    push('me', plan.name);
    try {
      const { data } = await supabase
        .from('exercises').select('id, name, sets, order_index')
        .eq('plan_id', plan.id).order('order_index');
      setExercises(data ?? []);
      const res = await callFn<{ sessionId: string; exerciseId: string; message: string }>(
        'session-start', { planId: plan.id },
      );
      setSessionId(res.sessionId);
      setCurrentExerciseId(res.exerciseId);
      push('coach', res.message);
    } catch (e) {
      coachError(e);
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
      <View style={{ padding: spacing.md, borderBottomWidth: 1, borderBottomColor: theme.rule }}>
        <Text style={{ color: theme.ink, fontWeight: '800', fontSize: 16, textAlign: 'right' }}>
          {t('chatTitle')}
        </Text>
        {inWorkout && currentEx && (
          <Text style={{ color: theme.inkSoft, fontSize: 12, textAlign: 'right' }}>
            {currentEx.name} · {currentExPos}/{exercises.length}
          </Text>
        )}
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
              <Text style={{
                color: item.from === 'me' ? theme.onAccent : item.from === 'system' ? theme.inkSoft : theme.ink,
                fontSize: typography.message.size,
                lineHeight: typography.message.lineHeight,
                textAlign: 'right',
              }}>
                {item.text}
              </Text>
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

      {!inWorkout ? (
        <View style={{ padding: spacing.md }}>
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
        <View style={{ padding: spacing.md, borderTopWidth: 1, borderTopColor: theme.rule }}>
          <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
            <TextInput
              placeholder={t('messagePlaceholder')}
              placeholderTextColor={theme.inkSoft}
              value={draft}
              onChangeText={setDraft}
              multiline
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
          <Pressable disabled={busy} onPress={finish} style={{ padding: spacing.sm, alignItems: 'center' }}>
            <Text style={{ color: theme.critical, fontWeight: '600', fontSize: 13 }}>{t('finishWorkout')}</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
    </Screen>
  );
}
