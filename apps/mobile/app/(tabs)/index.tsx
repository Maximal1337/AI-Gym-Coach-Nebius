import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, Text, TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../src/lib/supabase';
import { callFn, ApiError } from '../../src/lib/api';
import { enqueueTurn, setPendingTurnHandlers, type TurnResult } from '../../src/lib/pendingTurn';
import {
  enqueueSessionStart, setPendingSessionStartHandlers, type SessionStartResult,
} from '../../src/lib/pendingSessionStart';
import { fetchResumableSession, fetchMessages, generateMessageId, type DbMessage } from '../../src/lib/messages';
import { splitCoachReply } from '../../src/lib/messageChunks';
import { Screen } from '../../src/components/Screen';
import { MarkdownText } from '../../src/components/MarkdownText';
import { ConfettiBurst } from '../../src/components/ConfettiBurst';
import { SuggestedActionBar } from '../../src/components/SuggestedActionBar';
import { RestTimer } from '../../src/components/RestTimer';
import { useRestTimer } from '../../src/lib/restTimer';
import { IconButton } from '../../src/components/IconButton';
import { useLanguage } from '../../src/lib/language';
import { useUnits, formatWeightKg, weightUnitLabel, type UnitSystem } from '../../src/lib/units';
import { fetchUsageSnapshot } from '../../src/lib/usage';
import { useUnread } from '../../src/lib/unread';
import { track } from '../../src/lib/analytics';
import { useTheme, spacing, radius, typography, TAB_BAR_CLEARANCE } from '../../src/theme';

interface Plan { id: string; name: string }
interface SuggestedAction {
  exerciseId: string;
  weightKg: number | null;
  targetReps: number[] | null;
  /** Per-set weight — the real source of truth when a set carried its own track (e.g. a fatigue drop kept at a lower weight); weightKg alone can't express that. */
  targetWeights: number[] | null;
  sets: number;
  /** Seconds to rest before this exercise's next set — see RestTimerProvider.start. */
  restSec: number | null;
}
interface Msg {
  id: string;
  from: 'coach' | 'me' | 'system';
  text: string;
  /** Only ever set on 'me' messages — lets a durable catch-up fetch recognize a message already shown optimistically instead of re-appending it (see catchUp()). */
  clientMessageId?: string;
  /** Only set on a request-specific error bubble (e.g. "coachUnavailable" from send()'s own catch) — names the 'me' message it was reacting to, so catchUp() can retroactively remove it once that same exchange's real reply turns out to have landed durably after all (see the race this guards against in send()/confirmSets()). */
  relatedClientMessageId?: string;
}

/** A 'me' row's payload carries the raw confirmedSets (see confirmExerciseSets in supabase/functions/_shared/mod.ts) rather than pre-formatted text, since formatting is unit-aware and units live client-side. */
function messageText(row: DbMessage, units: UnitSystem): string {
  const confirmedSets = (row.payload as { confirmedSets?: Array<{ weightKg: number; reps: number }> } | null)?.confirmedSets;
  if (row.from_role === 'me' && Array.isArray(confirmedSets)) return formatConfirmedSets(confirmedSets, units);
  return row.text;
}

/** "58kg × 8/8/8" when every set shares a weight (the common case), else a per-set list. Weights are always stored in kg; this is the one boundary that converts to whatever the user has chosen to see (guidelines/units-setting.html). */
function formatConfirmedSets(sets: Array<{ weightKg: number; reps: number }>, units: UnitSystem): string {
  const sameWeight = sets.every((s) => s.weightKg === sets[0].weightKg);
  const unitLabel = weightUnitLabel(units);
  return sameWeight
    ? `${formatWeightKg(sets[0].weightKg, units)} ${unitLabel} × ${sets.map((s) => s.reps).join('/')}`
    : sets.map((s) => `${formatWeightKg(s.weightKg, units)}${unitLabel}×${s.reps}`).join(', ');
}

/** The core screen: free-text chat, single complete coach messages (GYM-28/61/67). */
export default function Chat() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const { units } = useUnits();
  const { setChatFocused } = useUnread();
  const restTimer = useRestTimer();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentExerciseId, setCurrentExerciseId] = useState<string | null>(null);
  // Server-provided (System Design §20): the current exercise may be a
  // session-only substitution the client never fetched, and its position
  // can't be a fixed order_index lookup once the flow can reorder/defer —
  // both come from the turn response, not derived from a local list.
  const [currentExerciseName, setCurrentExerciseName] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [pendingAction, setPendingAction] = useState<SuggestedAction | null>(null);
  // Proactive low-balance signal (Subscription Pricing & Monetization
  // Strategy doc, §4.2): tell the user before they hit the hard paywall,
  // not only after — same budgetRemaining()-equivalent data the settings/
  // subscribe screens already read, just surfaced earlier. Dismissed is
  // per-app-open only (not persisted) — a light nudge, not a nag.
  const [remainingWorkouts, setRemainingWorkouts] = useState<number | null>(null);
  const [lowBalanceDismissed, setLowBalanceDismissed] = useState(false);
  // The composer's bottom padding needs to clear the floating tab bar
  // when it's showing, but that same padding becomes a dead gap above
  // the keyboard once KeyboardAvoidingView has already shifted everything
  // up to sit right on top of it.
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const list = useRef<FlatList>(null);
  const nextId = useRef(0);
  // Watermark for the durable catch-up fetch (see catchUp()) — anything
  // already reflected in `msgs` via the live path updates this so a later
  // fetch only ever asks for what's genuinely new, never re-fetching what
  // was already shown live.
  const lastMessageAt = useRef<string | null>(null);
  // clientMessageIds the durable path has already delivered a real answer
  // for — guards against the original live request settling (successfully
  // or with an error) *after* catchUp()/resume already handled it, which
  // would otherwise show a stale "coachUnavailable" (or a duplicate reply)
  // right after the real one. Covers the reverse timing too: if the stale
  // error shows first, catchUp() finds and removes it once the real
  // answer for the same id turns up (see catchUp()).
  const resolvedMessageIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // useFocusEffect, not a plain mount-only effect: a plan added/edited/
  // archived via Settings > Manage Training Plans must show up here
  // without needing a full app reload.
  useFocusEffect(
    useCallback(() => {
      supabase.from('training_plans').select('id, name').eq('status', 'active')
        .then(({ data }) => setPlans(data ?? []));
      fetchUsageSnapshot().then((s) => setRemainingWorkouts(s.remaining));
      // Viewing this tab is itself "seen it" — same as any messaging app's
      // unread badge (see unread.tsx / NotificationBridge in _layout.tsx).
      // Cleared on the way out too, so a badge from a push that arrives
      // the instant after leaving isn't suppressed by a stale "focused" flag.
      setChatFocused(true);
      return () => setChatFocused(false);
    }, [setChatFocused]),
  );

  function push(from: Msg['from'], text: string, clientMessageId?: string) {
    setMsgs((m) => [...m, { id: clientMessageId ?? String(nextId.current++), from, text, clientMessageId }]);
    setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  }

  /** Like push('system', ...), but tags the bubble to a specific outgoing message so catchUp() can retroactively remove it if that exchange turns out to have actually succeeded (see resolvedMessageIds). */
  function pushError(text: string, relatedClientMessageId?: string) {
    setMsgs((m) => [...m, { id: String(nextId.current++), from: 'system', text, relatedClientMessageId }]);
    setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  }

  // A reply covering more than one topic gets a blank line between them
  // from the model itself (prompt.ts's FORMATTING_GUIDE — a real signal,
  // not a guess) — split on that and stagger the bubbles in, rather than
  // rendering one long block. A single-topic reply (the common case) is
  // one chunk, pushed immediately, unchanged from before.
  function pushCoachMessage(text: string) {
    // A coach message is the one thing that outranks an open rest dial —
    // collapse it back so the new reply isn't hidden behind the composer-
    // sized dial (guidelines/rest-timer.html: "collapses ... on any coach
    // message arriving"). The docked collapsed bar itself stays up.
    restTimer.setExpanded(false);
    const chunks = splitCoachReply(text);
    chunks.forEach((chunk, i) => {
      if (i === 0) push('coach', chunk);
      else setTimeout(() => push('coach', chunk), i * 550);
    });
  }

  function coachError(e: unknown, relatedClientMessageId?: string) {
    if (e instanceof ApiError && e.code === 'monthly_budget_exhausted') {
      push('system', t('budgetExhausted'));
      router.push('/subscribe');
    } else if (e instanceof ApiError && e.code === 'session_expired') push('system', t('sessionExpired'));
    else pushError(t('coachUnavailable'), relatedClientMessageId);
  }

  // The LLM composes messages in prose and can occasionally mistranscribe
  // a number while doing so — appending the deterministic target (from
  // progression.ts, never touched by the LLM) guarantees the number the
  // user actually sees is correct, regardless of what the prose says.
  // Most sets share one weight, so that stays the terse "Xkg x Y/Y/Y"
  // line — but a set that carried its own track (see progression.ts) has
  // a genuinely different weight, and collapsing it back into one number
  // would misstate the actual target, so that case spells out each set.
  function withTarget(
    message: string, weightKg: number | null, reps: number[] | null, targetWeights: number[] | null,
  ) {
    if (weightKg == null || !reps || reps.length === 0) return message;
    const unitLabel = weightUnitLabel(units);
    const uniform = !targetWeights || targetWeights.every((w) => w === targetWeights[0]);
    const line = uniform
      ? t('targetLine', { weight: `${formatWeightKg(weightKg, units)}${unitLabel}`, reps: reps.join('/') })
      : t('targetLinePerSet', {
          sets: reps.map((r, i) => `${formatWeightKg(targetWeights![i], units)}${unitLabel}×${r}`).join(', '),
        });
    return `${message}\n\n${line}`;
  }

  // State-only half of handleTurnResult, reused by the durable catch-up
  // path (resume-on-mount, AppState 'active') — never pushes a chat
  // bubble (already covered by messagesFromRow), but DOES still trigger
  // finish() on sessionComplete: the workout is just as genuinely done
  // whether the client learned that live or caught up on it later, and
  // finish()/session-complete is idempotent (sessionId already cleared
  // after the first successful call), so calling it from both paths in
  // the rare case they'd both fire is harmless. Skipping this here was
  // an earlier mistake — it meant a session finished while backgrounded
  // never got its summary printed at all (GYM feedback).
  function applyTurnState(res: TurnResult, sessionIdOverride?: string) {
    setProgress(res.progress ?? null);
    if (!res.advance) return; // same exercise still in play — leave pendingAction as-is
    if (res.sessionComplete) {
      setPendingAction(null);
      void finish(sessionIdOverride);
      return;
    }
    setCurrentExerciseId(res.nextExerciseId);
    setCurrentExerciseName(res.nextExerciseName);
    setPendingAction(
      res.nextExerciseId
        ? {
            exerciseId: res.nextExerciseId,
            weightKg: res.nextSuggestedWeightKg,
            targetReps: res.nextTargetReps,
            targetWeights: res.nextTargetWeights,
            sets: res.nextExerciseSets ?? 1,
            restSec: res.nextExerciseRestSec,
          }
        : null,
    );
  }

  function handleTurnResult(res: TurnResult) {
    // The server always computes the *next* exercise's target so it's ready
    // if the turn advances, but a turn that stays on the current exercise
    // (e.g. a note, a question) shouldn't show a target for a different
    // exercise the user isn't even being introduced to yet.
    const text = res.advance
      ? withTarget(res.message, res.nextSuggestedWeightKg, res.nextTargetReps, res.nextTargetWeights)
      : res.message;
    pushCoachMessage(text);
    lastMessageAt.current = new Date().toISOString();
    applyTurnState(res); // also triggers finish() on sessionComplete — see applyTurnState's own note
  }

  function handleSessionStartResult(res: SessionStartResult) {
    track('workout_started');
    setSessionId(res.sessionId);
    setCurrentExerciseId(res.exerciseId);
    pushCoachMessage(withTarget(res.message, res.suggestedWeightKg, res.targetReps, res.targetWeights));
    lastMessageAt.current = new Date().toISOString();
    setPendingAction({
      exerciseId: res.exerciseId,
      weightKg: res.suggestedWeightKg,
      targetReps: res.targetReps,
      targetWeights: res.targetWeights,
      sets: res.exerciseSets ?? 1,
      restSec: res.exerciseRestSec,
    });
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
    const clientMessageId = generateMessageId();
    push('me', formatConfirmedSets(sets, units), clientMessageId);
    setBusy(true);
    try {
      const res = await callFn<TurnResult>('coach-turn', {
        sessionId, exerciseId, confirmedSets: sets, clientMessageId,
      });
      // Confirming a set is the one deterministic "a set was just logged"
      // signal in this app (free-text set-logging has no equivalent flag
      // on TurnResult) — so this is the only place rest auto-starts
      // (guidelines/rest-timer.html: "confirming a set starts the rest").
      // Skipped on sessionComplete: there's no next set to rest before.
      if (!res.sessionComplete) restTimer.start(res.nextExerciseRestSec);
      // The durable path (catchUp()/resume) may have already delivered
      // this exact reply while this request was stuck backgrounded —
      // showing it again here would duplicate the bubble.
      if (!resolvedMessageIds.current.has(clientMessageId)) handleTurnResult(res);
    } catch (e) {
      // Don't just trust that this genuinely failed — check the durable
      // record fresh first. Otherwise a request that actually succeeded
      // while backgrounded (but whose own suspended fetch settles with an
      // error on resume) flashes "coachUnavailable" before the real reply
      // replaces it a moment later; checking here avoids the flash rather
      // than just cleaning it up after the fact.
      await catchUp();
      if (resolvedMessageIds.current.has(clientMessageId)) return;
      coachError(e, clientMessageId);
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

  // Turns a fetched row into one or more bubbles — shared by resume-on-mount
  // and catchUp() below so a durably-fetched message formats identically to
  // its live counterpart. A coach reply covering more than one topic is
  // stored as a single row (one blank-line-separated `text`), same as the
  // live path receives it — pushCoachMessage() splits that into separate
  // bubbles for the live path, so this does the same split here, or a
  // multi-topic reply that only arrived via resume/catch-up renders as one
  // undivided block instead of matching what a live reply looks like.
  function messagesFromRow(row: DbMessage): Msg[] {
    if (row.from_role !== 'coach') {
      return [{
        id: row.client_message_id ?? row.id,
        from: row.from_role,
        text: messageText(row, units),
        clientMessageId: row.client_message_id ?? undefined,
      }];
    }
    const chunks = splitCoachReply(messageText(row, units));
    return chunks.map((chunk, i) => ({ id: i === 0 ? row.id : `${row.id}-${i}`, from: 'coach' as const, text: chunk }));
  }

  // Applies whatever TurnResult/SessionStartResult-shaped payload rode
  // along with the most recent coach row among `rows` — state-only, same
  // as applyTurnState, so resuming/catching-up never re-triggers a chat
  // bubble (already covered by messagesFromRow) or finish().
  async function applyLatestPayload(rows: DbMessage[], sessionIdOverride?: string) {
    const lastCoach = [...rows].reverse().find((r) => r.from_role === 'coach' && r.payload);
    if (!lastCoach?.payload) return;
    const payload = lastCoach.payload as Record<string, unknown>;
    if ('advance' in payload) {
      applyTurnState(payload as unknown as TurnResult, sessionIdOverride);
      return;
    }
    if ('exerciseId' in payload) {
      // SessionStartResult shape — its own reply, before any turn has
      // happened yet. Unlike TurnResult it carries no exercise name, so
      // that's the one extra lookup this branch needs.
      const exId = payload.exerciseId as string;
      setCurrentExerciseId(exId);
      setPendingAction({
        exerciseId: exId,
        weightKg: (payload.suggestedWeightKg as number | null) ?? null,
        targetReps: (payload.targetReps as number[] | null) ?? null,
        targetWeights: (payload.targetWeights as number[] | null) ?? null,
        sets: (payload.exerciseSets as number | undefined) ?? 1,
        restSec: (payload.exerciseRestSec as number | null) ?? null,
      });
      const { data } = await supabase.from('exercises').select('name').eq('id', exId).maybeSingle();
      setCurrentExerciseName(data?.name ?? null);
    }
  }

  // Cold-launch recovery: if the app was killed mid-turn, there's no
  // in-memory state left at all to resume from — this is the only path
  // back to it, rebuilding the transcript and current-exercise state from
  // what was durably recorded (see the Linear doc "Durable Coach Replies").
  useEffect(() => {
    (async () => {
      const session = await fetchResumableSession();
      if (!session) return;
      const rows = await fetchMessages(session.id);
      if (rows.length === 0) return;
      setSessionId(session.id);
      setMsgs(rows.flatMap(messagesFromRow));
      lastMessageAt.current = rows[rows.length - 1].created_at;
      for (const r of rows) if (r.client_message_id) resolvedMessageIds.current.add(r.client_message_id);
      await applyLatestPayload(rows, session.id);
      setTimeout(() => list.current?.scrollToEnd({ animated: false }), 50);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warm-resume recovery: the app was only backgrounded, not evicted —
  // msgs/sessionId already survived in memory, this just catches up on
  // whatever landed durably while the direct response had nowhere to go.
  async function catchUp() {
    if (!sessionId) return;
    const rows = await fetchMessages(sessionId, lastMessageAt.current ?? undefined);
    if (rows.length === 0) return;
    const newlyResolved = rows.map((r) => r.client_message_id).filter((id): id is string => !!id);
    setMsgs((m) => {
      const known = new Set(m.map((x) => x.clientMessageId ?? x.id));
      const additions = rows.filter((r) => !known.has(r.client_message_id ?? r.id)).flatMap(messagesFromRow);
      // The stale-request race can resolve either order: if send()'s own
      // catch already showed "coachUnavailable" for one of these exchanges
      // before this fetch landed, that error is now known-wrong — drop it
      // rather than leave it sitting next to the real answer.
      const cleaned = m.filter((x) => !(x.relatedClientMessageId && newlyResolved.includes(x.relatedClientMessageId)));
      return additions.length > 0 || cleaned.length !== m.length ? [...cleaned, ...additions] : m;
    });
    for (const id of newlyResolved) resolvedMessageIds.current.add(id);
    lastMessageAt.current = rows[rows.length - 1].created_at;
    await applyLatestPayload(rows, sessionId);
    setBusy(false);
    setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  }

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void catchUp();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function start(plan: Plan) {
    setBusy(true);
    push('me', plan.name);
    try {
      // session-start (unchanged by §20 — see the design doc's open
      // questions) always begins at the first plan exercise, so its name
      // is safe to read positionally here.
      const { data } = await supabase
        .from('exercises').select('name')
        .eq('plan_id', plan.id).eq('source', 'plan').order('order_index').limit(1);
      setCurrentExerciseName(data?.[0]?.name ?? null);
      handleSessionStartResult(
        await callFn<SessionStartResult>('session-start', { planId: plan.id }),
      );
    } catch (e) {
      if (e instanceof ApiError) {
        coachError(e);
      } else {
        // A network-level failure, not a server rejection. The common
        // cause is the OS reporting a just-resumed connection as failed
        // right after backgrounding — not a real outage — so retry once
        // immediately before assuming we're genuinely offline; showing
        // "queuedOffline" for what was actually a momentary blip, right
        // before the real reply arrives seconds later, is more confusing
        // than useful. session-start is idempotent, so this retry is safe.
        try {
          handleSessionStartResult(
            await callFn<SessionStartResult>('session-start', { planId: plan.id }),
          );
        } catch (e2) {
          // A real server rejection on retry (rate-limited, budget
          // exhausted, etc.) is not "offline" — show what actually
          // happened instead of a misleading "saved on device" message.
          if (e2 instanceof ApiError) {
            coachError(e2);
          } else {
            // Still failing at the network level — queue it and retry on
            // reconnect instead of just giving up (pendingSessionStart.ts).
            await enqueueSessionStart({ planId: plan.id });
            push('system', t('queuedOffline'));
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || !sessionId || !currentExerciseId || busy) return;
    setDraft('');
    const clientMessageId = generateMessageId();
    push('me', text, clientMessageId);
    setBusy(true);
    // Last few turns, so the coach has short-term memory of this
    // exchange (e.g. a target it just agreed to change).
    const recentHistory = msgs
      .filter((m) => m.from !== 'system')
      .slice(-10)
      .map((m) => ({ from: m.from as 'coach' | 'me', text: m.text }));
    const turn = { sessionId, exerciseId: currentExerciseId, userMessage: text, recentHistory, clientMessageId };
    try {
      const res = await callFn<TurnResult>('coach-turn', turn);
      // The durable path (catchUp()/resume) may have already delivered
      // this exact reply while this request was stuck backgrounded —
      // showing it again here would duplicate the bubble.
      if (!resolvedMessageIds.current.has(clientMessageId)) handleTurnResult(res);
    } catch (e) {
      // Don't just trust that this genuinely failed — check the durable
      // record fresh first (see confirmSets()'s identical comment for why
      // this avoids a "coachUnavailable" flash rather than just cleaning
      // one up after the fact).
      await catchUp();
      if (resolvedMessageIds.current.has(clientMessageId)) return;
      if (e instanceof ApiError) {
        setDraft(text); // server rejected it outright — let the user retry
        coachError(e, clientMessageId);
      } else {
        // A network-level failure, not a server rejection. As in start()
        // above: the common cause right after backgrounding is the OS
        // reporting a stale connection as failed, not a real outage — try
        // once more immediately (safe: clientMessageId means a retry
        // reuses the same server-side row, never a second LLM call)
        // before queuing and showing "queuedOffline" for what's likely
        // about to succeed anyway.
        try {
          const res = await callFn<TurnResult>('coach-turn', turn);
          if (!resolvedMessageIds.current.has(clientMessageId)) handleTurnResult(res);
        } catch (e2) {
          // A real server rejection on retry (rate-limited, budget
          // exhausted, etc.) is not "offline" — show what actually
          // happened instead of a misleading "saved on device" message.
          if (e2 instanceof ApiError) {
            setDraft(text);
            coachError(e2, clientMessageId);
          } else {
            await enqueueTurn(turn);
            push('system', t('queuedOffline'));
          }
        }
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
    // §20: "remaining" is derived from the server's attempted-count
    // (progress), not a fixed order_index position — the flow can defer
    // or reorder exercises, so a position-based count would drift.
    const remaining = progress ? progress.total - progress.done : 0;
    if (remaining <= 0) {
      void finish();
      return;
    }
    Alert.alert(
      t('finishEarlyTitle'),
      t('finishEarlySub', { count: remaining, name: currentExerciseName ?? '' }),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('finishWorkout'), style: 'destructive', onPress: () => void finish() },
      ],
    );
  }

  // Accepts an explicit id, rather than only ever reading the sessionId
  // state, for callers that just determined it themselves in the same
  // tick as calling setSessionId() (resume-on-mount) — a state setter
  // doesn't update the current closure synchronously, so relying on the
  // `sessionId` variable right after setting it would silently no-op here.
  async function finish(targetSessionId?: string) {
    const id = targetSessionId ?? sessionId;
    if (!id) return;
    setBusy(true);
    try {
      const res = await callFn<{ exercises: Array<{ name: string; sets: string[] }> }>(
        'session-complete', { sessionId: id },
      );
      track('workout_completed');
      const lines = res.exercises.map((e) => `${e.name}: ${e.sets.join(', ')}`).join('\n');
      push('coach', `${t('workoutSummary')}\n${lines}`);
      setSessionId(null);
      setCurrentExerciseId(null);
      setCurrentExerciseName(null);
      setProgress(null);
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

  return (
    <Screen>
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <View style={{
        // Inverted from the usual dir ternary elsewhere in this file: DOM
        // order here is [action button, title block], so RTL needs plain
        // 'row' (button leading/right... i.e. button first = visually
        // rightmost only under row-reverse — here 'row' already puts the
        // button on the left and the title flush right, which is the
        // correct RTL reading, so LTR is the one that needs reversing).
        flexDirection: dir === 'rtl' ? 'row' : 'row-reverse', alignItems: 'center', gap: spacing.sm,
        paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
        borderBottomWidth: 1, borderBottomColor: theme.rule,
      }}>
        {inWorkout && (
          <Pressable disabled={busy} onPress={confirmFinish}>
            <Text style={{ color: theme.critical, fontWeight: '600', fontSize: 13 }}>{t('finishWorkout')}</Text>
          </Pressable>
        )}
        <View style={{ flex: 1, alignItems: dir === 'rtl' ? 'flex-end' : 'flex-start' }}>
          <Text style={{ color: theme.ink, fontWeight: '800', fontSize: 16, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {t('chatTitle')}
          </Text>
          {inWorkout && currentExerciseName && (
            <Text style={{ color: theme.inkSoft, fontSize: 12, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
              {currentExerciseName}
              {progress ? ` · ${Math.min(progress.done + 1, progress.total)}/${progress.total}` : ''}
            </Text>
          )}
        </View>
      </View>

      {remainingWorkouts != null && remainingWorkouts > 0 && remainingWorkouts <= 2 && !lowBalanceDismissed && (
        <Pressable
          onPress={() => router.push('/subscribe')}
          style={{
            flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: spacing.sm,
            backgroundColor: theme.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
            borderBottomWidth: 1, borderBottomColor: theme.rule,
          }}
        >
          <Text style={{ flex: 1, color: theme.ink, fontSize: 12.5, fontWeight: '600', textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {t('freeWorkoutsRemaining', { count: remainingWorkouts })}
          </Text>
          <Pressable hitSlop={8} onPress={(e) => { e.stopPropagation(); setLowBalanceDismissed(true); }}>
            <Text style={{ color: theme.inkSoft, fontSize: 12, fontWeight: '700' }}>{t('dismiss')}</Text>
          </Pressable>
        </Pressable>
      )}

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
                  textAlign: (dir === 'rtl' ? 'right' : 'left') as 'right' | 'left',
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
        <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: 8, padding: spacing.sm, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={theme.inkSoft} />
          <Text style={{ color: theme.inkSoft, fontSize: 12 }}>{t('typing')}</Text>
        </View>
      )}

      {inWorkout && pendingAction && (
        // Rest timer and this bar share one slot and are mutually
        // exclusive (guidelines/rest-timer.html) — but this stays MOUNTED
        // throughout a rest (display:none, not unmounted) so any
        // in-progress weight/reps edit the user made survives and is
        // still there when the bar reappears, rather than resetting.
        <View style={{ display: restTimer.phase === 'idle' ? 'flex' : 'none' }}>
          <SuggestedActionBar
            // Keyed by exercise, not just by its suggested numbers: two
            // consecutive baseline (no-history) exercises can share the same
            // weightKg/targetReps/sets shape (all null/null/N), so the
            // internal rows state wouldn't otherwise reset and the next
            // exercise would inherit whatever the user typed for the last one.
            key={pendingAction.exerciseId}
            exerciseName={currentExerciseName}
            targetWeights={pendingAction.targetWeights}
            targetReps={pendingAction.targetReps}
            sets={pendingAction.sets}
            disabled={busy}
            onSubmitSets={(sets) => void confirmSets(pendingAction.exerciseId, sets)}
          />
        </View>
      )}
      {inWorkout && <RestTimer variant="docked" />}

      {!inWorkout ? (
        <View style={{ padding: spacing.md, paddingBottom: keyboardVisible ? spacing.md : TAB_BAR_CLEARANCE }}>
          {plans.length === 0 ? (
            // Reachable whenever onboarding-plan was skipped (its
            // plan_setup_skipped_at flag is what let the user in here
            // without a plan in the first place) — this is the ongoing
            // nudge back to plans.tsx, the real "add a plan" surface.
            <>
              <Text style={{ color: theme.inkSoft, textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.sm }}>
                {t('noPlanYetChat')}
              </Text>
              <Pressable
                onPress={() => router.push('/(tabs)/plans')}
                style={{ backgroundColor: theme.accent, paddingVertical: 10, paddingHorizontal: 16, borderRadius: radius.pill, alignSelf: dir === 'rtl' ? 'flex-end' : 'flex-start' }}
              >
                <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{t('addPlanCta')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={{ color: theme.inkSoft, textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.sm }}>
                {t('startWorkout')}
              </Text>
              <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 8 }}>
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
            </>
          )}
        </View>
      ) : !(restTimer.expanded && (restTimer.phase === 'running' || restTimer.phase === 'paused')) ? (
        // The expanded rest dial takes this same space instead (design:
        // "someone adjusting rest time isn't typing") — collapsing it
        // (tap the dial, or a coach message arriving) brings this back.
        <View style={{
          paddingHorizontal: spacing.sm, paddingTop: spacing.md,
          paddingBottom: keyboardVisible ? spacing.md : TAB_BAR_CLEARANCE, borderTopWidth: 1, borderTopColor: theme.rule,
        }}>
          <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: spacing.md, alignItems: 'center' }}>
            <IconButton
              name="timer-outline"
              label={t('startRestTimer')}
              size={21}
              color={theme.accent}
              onPress={() => restTimer.start(pendingAction?.restSec ?? null)}
              style={{ width: 46, height: 46, backgroundColor: theme.surface, borderRadius: radius.pill }}
            />
            <TextInput
              placeholder={t('messagePlaceholder')}
              placeholderTextColor={theme.inkSoft}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={200}
              textAlignVertical="center"
              style={{
                flex: 1, backgroundColor: theme.surface, borderRadius: radius.field,
                paddingHorizontal: 10, paddingVertical: 8, color: theme.ink,
                textAlign: dir === 'rtl' ? 'right' : 'left', maxHeight: 100,
              }}
            />
            <Pressable
              disabled={busy || !draft.trim()}
              onPress={send}
              style={{
                backgroundColor: draft.trim() ? theme.accent : theme.rule,
                borderRadius: radius.pill, paddingHorizontal: 16, minHeight: 46, alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ color: draft.trim() ? theme.onAccent : theme.inkSoft, fontWeight: '700' }}>
                {t('send')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
    <ConfettiBurst active={showConfetti} />
    </Screen>
  );
}
