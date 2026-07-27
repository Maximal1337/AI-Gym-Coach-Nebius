import { useCallback, useEffect, useState } from 'react';
import {
  Alert, FlatList, Keyboard, Modal, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../src/lib/supabase';
import { callFn } from '../../src/lib/api';
import { DismissKeyboardView } from '../../src/components/DismissKeyboardView';
import { LineChart } from '../../src/components/LineChart';
import { useTheme, spacing, radius } from '../../src/theme';

interface SessionRow {
  id: string; started_at: string; source: string;
  training_plans: { name: string } | null;
  set_logs: { id: string }[];
}
interface Plan { id: string; name: string }
interface ExerciseRow { id: string; name: string; order_index: number }
interface RawLog {
  session_id: string;
  exercise_id: string;
  weight_kg: number;
  workout_sessions: { started_at: string } | null;
}

/** Last N completed sessions plotted per exercise — enough to see a trend, small enough to stay a sparkline. */
const MAX_POINTS = 15;

async function fetchExerciseSeries(planId: string): Promise<Record<string, number[]>> {
  const { data } = await supabase
    .from('set_logs')
    .select('session_id, exercise_id, weight_kg, workout_sessions!inner(started_at, status, plan_id)')
    .eq('workout_sessions.plan_id', planId)
    .eq('workout_sessions.status', 'completed');
  const rows = (data ?? []) as unknown as RawLog[];

  const byExercise = new Map<string, Map<string, { startedAt: string; maxWeight: number }>>();
  for (const row of rows) {
    const startedAt = row.workout_sessions?.started_at;
    if (!startedAt) continue;
    const perSession = byExercise.get(row.exercise_id) ?? new Map();
    const existing = perSession.get(row.session_id);
    if (!existing || row.weight_kg > existing.maxWeight) {
      perSession.set(row.session_id, { startedAt, maxWeight: row.weight_kg });
    }
    byExercise.set(row.exercise_id, perSession);
  }

  const result: Record<string, number[]> = {};
  for (const [exerciseId, sessions] of byExercise) {
    result[exerciseId] = [...sessions.values()]
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .slice(-MAX_POINTS)
      .map((s) => s.maxWeight);
  }
  return result;
}

function PlanTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1,
        borderColor: active ? theme.accent : theme.rule,
        backgroundColor: active ? theme.accent : 'transparent',
      }}
    >
      <Text style={{ color: active ? theme.onAccent : theme.inkSoft, fontWeight: '700', fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function ExerciseProgress({ name, values }: { name: string; values: number[] }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const last = values[values.length - 1];
  return (
    <View style={{
      flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: theme.surface, borderRadius: radius.card, padding: spacing.sm, marginBottom: spacing.sm, gap: spacing.sm,
    }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 13, textAlign: 'right' }}>{name}</Text>
        <Text style={{ color: theme.inkSoft, fontSize: 11, textAlign: 'right' }}>
          {values.length === 0 ? t('noData') : values.length === 1 ? `${last} ק"ג · ${t('needOneMore')}` : `${last} ק"ג`}
        </Text>
      </View>
      {values.length > 0 && <LineChart values={values} />}
    </View>
  );
}

export default function Progress() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [monthCount, setMonthCount] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState<{ sessions: unknown[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [exercises, setExercises] = useState<ExerciseRow[]>([]);
  const [series, setSeries] = useState<Record<string, number[]>>({});

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const { data } = await supabase
          .from('workout_sessions')
          .select('id, started_at, source, training_plans(name), set_logs(id)')
          .eq('status', 'completed')
          .order('started_at', { ascending: false })
          .limit(30);
        const rows = (data ?? []) as unknown as SessionRow[];
        setSessions(rows);
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        setMonthCount(rows.filter((s) => new Date(s.started_at) >= monthStart).length);
      })();
      (async () => {
        const { data } = await supabase.from('training_plans').select('id, name').eq('status', 'active');
        const rows = (data ?? []) as Plan[];
        setPlans(rows);
        setSelectedPlanId((current) => current ?? rows[0]?.id ?? null);
      })();
    }, []),
  );

  useEffect(() => {
    if (!selectedPlanId) {
      setExercises([]);
      setSeries({});
      return;
    }
    let current = true;
    (async () => {
      const [{ data }, seriesData] = await Promise.all([
        supabase.from('exercises').select('id, name, order_index')
          .eq('plan_id', selectedPlanId).order('order_index'),
        fetchExerciseSeries(selectedPlanId),
      ]);
      // A faster-resolving later tab switch may have already landed —
      // don't let this stale response overwrite it.
      if (!current) return;
      setExercises((data ?? []) as ExerciseRow[]);
      setSeries(seriesData);
    })();
    return () => { current = false; };
  }, [selectedPlanId]);

  async function importParse() {
    setBusy(true);
    try {
      const res = await callFn<{ sessions: unknown[] }>('history-import', { action: 'parse', text: importText });
      setImportPreview(res);
    } catch {
      Alert.alert(t('parseFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function importCommit() {
    if (!importPreview) return;
    setBusy(true);
    try {
      const res = await callFn<{ imported: number }>('history-import', {
        action: 'commit', sessions: importPreview.sessions,
      });
      Alert.alert(t('imported', { count: res.imported }));
      setImportOpen(false);
      setImportPreview(null);
      setImportText('');
      if (selectedPlanId) setSeries(await fetchExerciseSeries(selectedPlanId));
    } catch {
      Alert.alert(t('coachUnavailable'));
    } finally {
      setBusy(false);
    }
  }

  const stat = (num: string | number, label: string) => (
    <View style={{ flex: 1, backgroundColor: theme.surface, borderRadius: radius.card, padding: spacing.md, alignItems: 'center' }}>
      <Text style={{ color: theme.ink, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{num}</Text>
      <Text style={{ color: theme.inkSoft, fontSize: 11, marginTop: 2 }}>{label}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, padding: spacing.md }}>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        ListHeaderComponent={
          <View>
            <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: 'right', marginBottom: spacing.md }}>
              {t('progressTitle')}
            </Text>
            <View style={{ flexDirection: 'row-reverse', gap: spacing.sm, marginBottom: spacing.md }}>
              {stat(sessions.length, t('totalWorkouts'))}
              {stat(monthCount, t('thisMonth'))}
            </View>

            <Pressable
              onPress={() => setImportOpen(true)}
              style={{ backgroundColor: theme.surface, borderRadius: radius.card, padding: spacing.md, marginBottom: spacing.md }}
            >
              <Text style={{ color: theme.accent, fontWeight: '700', textAlign: 'right' }}>{t('importHistory')}</Text>
              <Text style={{ color: theme.inkSoft, fontSize: 12, textAlign: 'right' }}>{t('importHistorySub')}</Text>
            </Pressable>

            {plans.length > 0 && (
              <View style={{ marginBottom: spacing.lg }}>
                <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 14, textAlign: 'right', marginBottom: spacing.sm }}>
                  {t('exerciseProgress')}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
                  <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                    {plans.map((p) => (
                      <PlanTab key={p.id} label={p.name} active={p.id === selectedPlanId} onPress={() => setSelectedPlanId(p.id)} />
                    ))}
                  </View>
                </ScrollView>
                {exercises.map((e) => (
                  <ExerciseProgress key={e.id} name={e.name} values={series[e.id] ?? []} />
                ))}
              </View>
            )}

            <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 14, textAlign: 'right', marginBottom: spacing.sm }}>
              {t('recentWorkouts')}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={{ color: theme.inkSoft, textAlign: 'right' }}>{t('noData')}</Text>
        }
        renderItem={({ item }) => (
          <View style={{
            flexDirection: 'row-reverse', justifyContent: 'space-between',
            paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.rule,
          }}>
            <View>
              <Text style={{ color: theme.ink, fontWeight: '600', textAlign: 'right' }}>
                {item.training_plans?.name ?? '—'}{item.source === 'imported' ? ' ⤵' : ''}
              </Text>
              <Text style={{ color: theme.inkSoft, fontSize: 11, textAlign: 'right' }}>
                {new Date(item.started_at).toLocaleDateString('he-IL')}
              </Text>
            </View>
            <Text style={{ color: theme.inkSoft, fontSize: 12, alignSelf: 'center', fontVariant: ['tabular-nums'] }}>
              {item.set_logs.length} sets
            </Text>
          </View>
        )}
      />

      <Modal visible={importOpen} animationType="slide" onRequestClose={() => setImportOpen(false)}>
        <DismissKeyboardView style={{ backgroundColor: theme.bg, padding: spacing.lg }}>
          <Text style={{ color: theme.ink, fontSize: 18, fontWeight: '800', textAlign: 'right', marginBottom: spacing.md }}>
            {t('importHistory')}
          </Text>
          <TextInput
            multiline
            value={importText}
            onChangeText={setImportText}
            placeholder={t('planPlaceholder')}
            placeholderTextColor={theme.inkSoft}
            style={{
              flex: 1, backgroundColor: theme.surface, borderRadius: radius.card,
              padding: spacing.md, color: theme.ink, textAlign: 'right', textAlignVertical: 'top',
            }}
          />
          {!importPreview ? (
            <Pressable
              disabled={busy || importText.length < 10}
              onPress={() => { Keyboard.dismiss(); importParse(); }}
              style={{ backgroundColor: theme.accent, padding: 14, borderRadius: radius.pill, alignItems: 'center', marginTop: spacing.md }}
            >
              <Text style={{ color: theme.onAccent, fontWeight: '700' }}>
                {busy ? t('parsing') : t('importParse')}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              disabled={busy}
              onPress={importCommit}
              style={{ backgroundColor: theme.success, padding: 14, borderRadius: radius.pill, alignItems: 'center', marginTop: spacing.md }}
            >
              <Text style={{ color: theme.bg, fontWeight: '700' }}>
                {t('importCommit', { count: importPreview.sessions.length })}
              </Text>
            </Pressable>
          )}
          <Pressable onPress={() => { setImportOpen(false); setImportPreview(null); }} style={{ padding: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: theme.inkSoft }}>{t('cancel')}</Text>
          </Pressable>
        </DismissKeyboardView>
      </Modal>
    </View>
  );
}
