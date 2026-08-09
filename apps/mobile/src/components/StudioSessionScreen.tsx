import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, LayoutAnimation, Platform, Pressable, ScrollView, Text, UIManager, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../lib/language';
import { useTheme, spacing, radius } from '../theme';
import {
  addCustomUnit, discardStudioSession, getStudioSession, saveStudioSession, updateStudioSession,
  type StudioBlock, type StudioCustomUnit, type StudioExercise, type StudioFormatType, type StudioLastMap, type StudioTree,
} from '../lib/studioApi';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { LoadingOverlay } from './LoadingOverlay';
import { Card } from './Card';
import { Chip } from './Chip';
import { Field } from './Field';
import { NoticeCard } from './NoticeCard';
import { UndoBar } from './UndoBar';
import { UnitScroller, UNIT_PRESETS } from './UnitScroller';
import { DeltaChip } from './DeltaChip';
import { ScoreEntry } from './ScoreEntry';
import { IntensityPicker } from './IntensityPicker';
import { BottomSheet } from './BottomSheet';

const FORMAT_TYPES: Array<{ type: StudioFormatType; params: Array<{ key: string; unit: string; min: number; max: number }> }> = [
  { type: 'buyin', params: [] },
  { type: 'rounds', params: [{ key: 'count', unit: 'rounds', min: 1, max: 50 }] },
  { type: 'fortime', params: [] },
  { type: 'amrap', params: [{ key: 'cap', unit: 'min', min: 1, max: 120 }] },
  { type: 'emom', params: [{ key: 'every', unit: 'min', min: 1, max: 30 }, { key: 'total', unit: 'min', min: 1, max: 180 }] },
  { type: 'intervals', params: [{ key: 'on', unit: 'sec', min: 5, max: 600 }, { key: 'off', unit: 'sec', min: 5, max: 600 }] },
];
const FORMAT_DEFAULTS: Record<string, number> = { count: 3, cap: 12, every: 1, total: 10, on: 30, off: 30 };
const PRESET_UNIT_KEYS = ['reps', 'kg', 'lbs', 'm', 'cals', 'cm', 'sec', 'min', 'lengths', 'rounds'];

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
/** Every expand/collapse and add/remove in this screen goes through this
 * instead of a bare state update, so a row opening, a block's format
 * editor appearing, or a removed exercise collapsing its space all animate
 * instead of snapping — the thing that read as "two frames, not smooth". */
function animateNext() {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

function fmtLabel(block: StudioBlock, t: (k: string, o?: Record<string, unknown>) => string): string {
  const p = block.formatParams;
  switch (block.formatType) {
    case 'rounds': return t('formatRounds', { count: p.count ?? 1 });
    case 'amrap': return t('formatAmrap', { cap: p.cap ?? 12 });
    case 'emom': return t('formatEmom', { every: p.every ?? 1, total: p.total ?? 10 });
    case 'intervals': return t('formatIntervals', { on: p.on ?? 30, off: p.off ?? 30 });
    case 'fortime': return t('formatFortime');
    case 'custom': return block.formatCustom ?? '';
    case 'buyin': return t('formatBuyin');
    // No format was ever chosen for this block — most don't have one, and
    // showing nothing is the honest state, not defaulting to a label.
    case null: return '';
  }
}

function unitLabel(unit: string, customUnits: StudioCustomUnit[], t: (k: string) => string): string {
  const custom = customUnits.find((c) => c.key === unit);
  if (custom) return custom.label;
  const key = `unit_${unit}`;
  const translated = t(key);
  return translated === key ? unit : translated;
}

interface RemovedItem {
  kind: 'exercise' | 'block';
  blockIndex: number;
  exerciseIndex?: number;
  exercise?: StudioExercise;
  block?: StudioBlock;
}

/**
 * Ported from guidelines/studio-workout-entry.html's SessionScreen — one
 * live screen from parse to saved result, no Start/End. Whether the
 * workout has been done is answered by whether it has a result, so the
 * only lifecycle actions here are Save (opens the one post-save question)
 * and Discard (the rare, confirm-gated exit with no result recorded).
 */
export function StudioSessionScreen({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [tree, setTree] = useState<StudioTree | null>(null);
  const [last, setLast] = useState<StudioLastMap>({});
  const [customUnits, setCustomUnits] = useState<StudioCustomUnit[]>([]);
  const plannedRef = useRef<Map<string, number>>(new Map());
  const loadedRef = useRef(false);

  const [openRowKey, setOpenRowKey] = useState<string | null>(null);
  const [openBlockIndex, setOpenBlockIndex] = useState<number | null>(null);
  // metricIndex === the exercise's current metrics.length means "append a
  // new one" (the old "+ unit" behavior); any existing index means "replace
  // that metric's unit" — tapping either label opens the same sheet.
  const [unitSheetFor, setUnitSheetFor] = useState<{ bi: number; ei: number; metricIndex: number } | null>(null);
  const [customUnitForm, setCustomUnitForm] = useState<{ label: string; step: string } | null>(null);
  const [removed, setRemoved] = useState<RemovedItem | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showIntensitySheet, setShowIntensitySheet] = useState(false);
  const [score, setScore] = useState<Record<string, string>>({});
  const [intensity, setIntensity] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getStudioSession(sessionId);
        if (cancelled) return;
        setTree(res.tree);
        setLast(res.last);
        setCustomUnits(res.customUnits);
        setScore(res.score ?? {});
        setIntensity(res.intensity);
        setNote(res.note ?? '');
        const snapshot = new Map<string, number>();
        res.tree.blocks.forEach((b, bi) => b.exercises.forEach((e, ei) => e.metrics.forEach((m, mi) => {
          snapshot.set(`${bi}-${ei}-${mi}`, m.value);
        })));
        plannedRef.current = snapshot;
      } catch {
        Alert.alert(t('coachUnavailable'));
        onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Debounced autosave so the session is resumable server-side mid-edit,
  // not just at parse time and at Save.
  useEffect(() => {
    if (!tree) return;
    if (!loadedRef.current) { loadedRef.current = true; return; }
    // Best-effort: a failed autosave just means the next edit's debounce
    // retries with the latest tree. Swallow rather than surface, but don't
    // leave it as an unhandled rejection either.
    const id = setTimeout(() => { updateStudioSession(sessionId, tree).catch(() => {}); }, 900);
    return () => clearTimeout(id);
  }, [tree, sessionId]);

  function patch(fn: (draft: StudioTree) => StudioTree) {
    setTree((prev) => (prev ? fn(prev) : prev));
  }

  function patchExerciseName(bi: number, ei: number, name: string) {
    patch((d) => ({
      ...d,
      blocks: d.blocks.map((b, i) => i !== bi ? b : {
        ...b, exercises: b.exercises.map((e, j) => j !== ei ? e : { ...e, name }),
      }),
    }));
  }

  function patchMetricValue(bi: number, ei: number, mi: number, value: number) {
    patch((d) => ({
      ...d,
      blocks: d.blocks.map((b, i) => i !== bi ? b : {
        ...b,
        exercises: b.exercises.map((e, j) => j !== ei ? e : {
          ...e,
          metrics: e.metrics.map((m, k) => k !== mi ? m : {
            ...m, value, tierIndex: m.tiers ? m.tiers.indexOf(value) : null,
          }),
        }),
      }),
    }));
  }

  function addExercise(bi: number) {
    animateNext();
    patch((d) => ({
      ...d,
      blocks: d.blocks.map((b, i) => i !== bi ? b : {
        ...b,
        exercises: [...b.exercises, { name: '', parseConfidence: null, metrics: [{ unit: 'reps', value: 10, tiers: null, tierIndex: null }] }],
      }),
    }));
    setOpenRowKey(`${bi}-${(tree?.blocks[bi].exercises.length ?? 0)}`);
  }

  function removeExercise(bi: number, ei: number) {
    const exercise = tree?.blocks[bi].exercises[ei];
    if (!exercise) return;
    animateNext();
    patch((d) => ({
      ...d,
      blocks: d.blocks.map((b, i) => i !== bi ? b : { ...b, exercises: b.exercises.filter((_, j) => j !== ei) }),
    }));
    setOpenRowKey(null);
    showUndo({ kind: 'exercise', blockIndex: bi, exerciseIndex: ei, exercise });
  }

  /** metricIndex within the exercise's current metrics.length replaces that
   * metric's unit (tiers/last-time context reset — they were specific to
   * the old unit, and a scaling ladder for reps doesn't mean anything once
   * the row measures calories); metricIndex === metrics.length appends a
   * new one, the original "+ unit" behavior. */
  function setMetricUnit(bi: number, ei: number, metricIndex: number, unit: string) {
    const preset = customUnits.find((c) => c.key === unit);
    const defaultValue = preset ? preset.step * 4 : (UNIT_PRESETS[unit]?.step ?? 1) * 8;
    const fresh = { unit, value: defaultValue, tiers: null, tierIndex: null };
    patch((d) => ({
      ...d,
      blocks: d.blocks.map((b, i) => i !== bi ? b : {
        ...b,
        exercises: b.exercises.map((e, j) => j !== ei ? e : {
          ...e,
          metrics: metricIndex < e.metrics.length
            ? e.metrics.map((m, k) => k !== metricIndex ? m : fresh)
            : [...e.metrics, fresh],
        }),
      }),
    }));
    setUnitSheetFor(null);
  }

  /** Either metric can go once there are two — removing index 0 promotes
   * the extra to become the new (sole) primary, rather than the primary
   * being permanently fixed. With only one metric left, there's nothing to
   * remove down to (an exercise needs at least one), so the "X" for it
   * only ever renders once a second metric exists. */
  function removeMetric(bi: number, ei: number, metricIndex: number) {
    animateNext();
    // Keep the cached "last time" values index-aligned with the metrics
    // array after the shift — otherwise a promoted extra metric would
    // compare against the old primary's history instead of its own.
    const exerciseName = tree?.blocks[bi]?.exercises[ei]?.name;
    if (exerciseName) {
      setLast((prev) => {
        const rows = prev[exerciseName];
        return rows ? { ...prev, [exerciseName]: rows.filter((_, k) => k !== metricIndex) } : prev;
      });
    }
    patch((d) => ({
      ...d,
      blocks: d.blocks.map((b, i) => i !== bi ? b : {
        ...b,
        exercises: b.exercises.map((e, j) => j !== ei ? e : { ...e, metrics: e.metrics.filter((_, k) => k !== metricIndex) }),
      }),
    }));
  }

  function addBlock() {
    animateNext();
    patch((d) => ({
      ...d,
      blocks: [...d.blocks, { name: '', formatType: null, formatParams: {}, formatCustom: null, exercises: [] }],
    }));
    setOpenBlockIndex(tree?.blocks.length ?? 0);
  }

  function removeBlock(bi: number) {
    const block = tree?.blocks[bi];
    if (!block) return;
    animateNext();
    patch((d) => ({ ...d, blocks: d.blocks.filter((_, i) => i !== bi) }));
    setOpenBlockIndex(null);
    showUndo({ kind: 'block', blockIndex: bi, block });
  }

  function showUndo(item: RemovedItem) {
    setRemoved(item);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setRemoved(null), 6000);
  }

  function undoRemove() {
    if (!removed) return;
    animateNext();
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (removed.kind === 'exercise' && removed.exercise) {
      const { blockIndex, exerciseIndex, exercise } = removed;
      patch((d) => ({
        ...d,
        blocks: d.blocks.map((b, i) => i !== blockIndex ? b : {
          ...b, exercises: [...b.exercises.slice(0, exerciseIndex), exercise, ...b.exercises.slice(exerciseIndex)],
        }),
      }));
    } else if (removed.kind === 'block' && removed.block) {
      const { blockIndex, block } = removed;
      patch((d) => ({ ...d, blocks: [...d.blocks.slice(0, blockIndex), block, ...d.blocks.slice(blockIndex)] }));
    }
    setRemoved(null);
  }

  function patchBlockName(bi: number, name: string) {
    patch((d) => ({ ...d, blocks: d.blocks.map((b, i) => i !== bi ? b : { ...b, name }) }));
  }

  /** Tapping the already-selected chip clears it back to null (genuinely
   * optional — a block isn't stuck with whatever format was last picked
   * once you decide it doesn't have one). */
  function patchBlockFormat(bi: number, formatType: StudioFormatType) {
    animateNext();
    patch((d) => {
      const current = d.blocks[bi].formatType;
      if (current === formatType) {
        return { ...d, blocks: d.blocks.map((b, i) => i !== bi ? b : { ...b, formatType: null, formatParams: {}, formatCustom: null }) };
      }
      const spec = FORMAT_TYPES.find((f) => f.type === formatType)!;
      const params = Object.fromEntries(spec.params.map((p) => [p.key, FORMAT_DEFAULTS[p.key]]));
      return {
        ...d,
        blocks: d.blocks.map((b, i) => i !== bi ? b : { ...b, formatType, formatParams: params, formatCustom: formatType === 'custom' ? (b.formatCustom ?? '') : null }),
      };
    });
  }

  function patchBlockParam(bi: number, key: string, value: number) {
    patch((d) => ({
      ...d,
      blocks: d.blocks.map((b, i) => i !== bi ? b : { ...b, formatParams: { ...b.formatParams, [key]: value } }),
    }));
  }

  async function createCustomUnit() {
    if (!customUnitForm || !unitSheetFor) return;
    const label = customUnitForm.label.trim();
    const step = parseFloat(customUnitForm.step);
    if (!label || !Number.isFinite(step) || step <= 0) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 20) || 'custom';
    try {
      const { customUnit } = await addCustomUnit({ key, label, step, min: 0, max: step * 100 });
      setCustomUnits((prev) => [...prev.filter((c) => c.key !== customUnit.key), customUnit]);
      setMetricUnit(unitSheetFor.bi, unitSheetFor.ei, unitSheetFor.metricIndex, customUnit.key);
      setCustomUnitForm(null);
    } catch {
      Alert.alert(t('coachUnavailable'));
    }
  }

  async function handleSaveTap() {
    setShowIntensitySheet(true);
  }

  async function finishSave() {
    if (!tree) return;
    setSaving(true);
    try {
      await saveStudioSession(sessionId, {
        tree,
        score: tree.scoreType ? score : null,
        intensity,
        note: note.trim() || null,
      });
      onClose();
    } catch {
      Alert.alert(t('coachUnavailable'));
    } finally {
      setSaving(false);
    }
  }

  function confirmDiscard() {
    Alert.alert(t('discardWorkoutTitle'), t('discardWorkoutBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('discardWorkoutCta'), style: 'destructive',
        onPress: async () => {
          setDiscarding(true);
          try {
            await discardStudioSession(sessionId);
            onClose();
          } catch {
            Alert.alert(t('coachUnavailable'));
          } finally {
            setDiscarding(false);
          }
        },
      },
    ]);
  }

  const showBlockHeaders = useMemo(
    () => !!tree && (tree.blocks.length > 1 || tree.blocks[0]?.name !== null),
    [tree],
  );

  if (loading || !tree) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const isRTL = dir === 'rtl';
  const rowDir = isRTL ? 'row-reverse' as const : 'row' as const;
  const align = isRTL ? 'right' as const : 'left' as const;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{
        flexDirection: rowDir, alignItems: 'center', gap: spacing.sm,
        paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm,
      }}>
        <Pressable onPress={onClose} hitSlop={10}>
          <Ionicons name={isRTL ? 'chevron-forward' : 'chevron-back'} size={22} color={theme.inkSoft} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.ink, fontSize: 18, fontWeight: '800', textAlign: align }} numberOfLines={1}>
            {tree.name}
          </Text>
          <Text style={{ color: theme.inkSoft, fontSize: 12, textAlign: align }}>{t('studioSessionSubtitle')}</Text>
        </View>
        <IconButton name="trash-outline" label={t('discardWorkoutCta')} onPress={confirmDiscard} color={theme.critical} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 162 }}>
        {tree.blocks.map((block, bi) => (
          <View key={bi} style={{ marginBottom: spacing.md }}>
            {showBlockHeaders && (
              <Pressable
                onPress={() => { animateNext(); setOpenBlockIndex(openBlockIndex === bi ? null : bi); }}
                style={{
                  flexDirection: rowDir, alignItems: 'center', justifyContent: 'space-between',
                  gap: spacing.sm, minHeight: 40, paddingHorizontal: 2,
                }}
              >
                <Text style={{ color: theme.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' }}>
                  {block.name ? `${block.name} · ${bi + 1}` : `${t('block')} ${bi + 1}`}
                </Text>
                <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 5 }}>
                  {block.formatType != null && (
                    <Text style={{ color: theme.inkSoft, fontSize: 11 }} numberOfLines={1}>{fmtLabel(block, t)}</Text>
                  )}
                  <Ionicons name={openBlockIndex === bi ? 'chevron-up' : 'chevron-down'} size={13} color={theme.inkSoft} />
                </View>
              </Pressable>
            )}

            {openBlockIndex === bi && (
              <Card style={{ marginTop: spacing.sm, marginBottom: spacing.sm }}>
                <Field
                  surface="sunken" value={block.name ?? ''} placeholder={t('blockName')}
                  onChangeText={(v) => patchBlockName(bi, v)} style={{ marginBottom: spacing.sm }}
                />
                <Text style={{ color: theme.inkSoft, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6, textAlign: align }}>
                  {t('howItRuns')}
                </Text>
                <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm }}>
                  {FORMAT_TYPES.map((f) => (
                    <Chip key={f.type} selected={block.formatType === f.type} onPress={() => patchBlockFormat(bi, f.type)}>
                      {t(`format_${f.type}_label`)}
                    </Chip>
                  ))}
                </View>
                {(FORMAT_TYPES.find((f) => f.type === block.formatType)?.params ?? []).map((p) => (
                  <View key={p.key} style={{ marginBottom: spacing.sm }}>
                    <Text style={{ color: theme.inkSoft, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 2, textAlign: align }}>
                      {t(`formatParam_${p.key}`)} · {unitLabel(p.unit, customUnits, t)}
                    </Text>
                    <UnitScroller
                      compact value={block.formatParams[p.key] ?? FORMAT_DEFAULTS[p.key]} unit={p.unit}
                      min={p.min} max={p.max} onChange={(v) => patchBlockParam(bi, p.key, v)}
                    />
                  </View>
                ))}
                <View style={{ flexDirection: rowDir, justifyContent: 'flex-end', marginTop: spacing.xs }}>
                  <Button variant="destructive" size="md" onPress={() => removeBlock(bi)}>{t('removeBlock')}</Button>
                </View>
              </Card>
            )}

            <Card inset>
              {block.exercises.map((exercise, ei) => {
                const key = `${bi}-${ei}`;
                const open = openRowKey === key;
                const primary = exercise.metrics[0];
                const extra = exercise.metrics[1];
                const lastMetrics = last[exercise.name] ?? null;
                const lastPrimary = lastMetrics?.[0]?.value ?? null;
                const plannedValue = plannedRef.current.get(`${bi}-${ei}-0`);
                const changed = plannedValue != null && primary.value !== plannedValue;

                return (
                  <View key={ei} style={{ borderBottomWidth: ei === block.exercises.length - 1 ? 0 : 1, borderBottomColor: theme.rule }}>
                    <Pressable
                      onPress={() => { animateNext(); setOpenRowKey(open ? null : key); }}
                      style={{ flexDirection: rowDir, alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingVertical: 10, paddingHorizontal: 12 }}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: exercise.name ? theme.ink : theme.inkSoft, fontSize: 14.5, fontWeight: '700', textAlign: align }} numberOfLines={1}>
                          {exercise.name || t('nameThisExercise')}
                        </Text>
                        <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 5, marginTop: 3 }}>
                          {exercise.parseConfidence === 'low' && (
                            <Ionicons name="alert-circle" size={12} color={theme.warning} />
                          )}
                          {lastPrimary == null ? (
                            <Text style={{ color: theme.inkSoft, fontSize: 11.5 }}>{t('firstTime')}</Text>
                          ) : primary.value === lastPrimary ? (
                            <>
                              <View style={{ width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: theme.ink }} />
                              <Text style={{ color: theme.inkSoft, fontSize: 11.5 }}>{t('sameAsLastTime')}</Text>
                            </>
                          ) : (
                            <DeltaChip value={Math.round((primary.value - lastPrimary) * 100) / 100} unit={unitLabel(primary.unit, customUnits, t)} />
                          )}
                        </View>
                      </View>
                      {changed && (
                        <View style={{ backgroundColor: theme.accent, borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: 8 }}>
                          <Text style={{ color: theme.onAccent, fontSize: 10, fontWeight: '800' }}>{t('changedBadge')}</Text>
                        </View>
                      )}
                      <Text style={{ color: theme.ink, fontSize: 18, fontWeight: '800' }}>
                        {primary.value}
                        <Text style={{ fontSize: 11.5, color: theme.inkSoft, fontWeight: '600' }}> {unitLabel(primary.unit, customUnits, t)}</Text>
                        {extra && (
                          <Text style={{ fontSize: 13, color: theme.inkSoft, fontWeight: '600' }}>
                            {' · '}{extra.value} {unitLabel(extra.unit, customUnits, t)}
                          </Text>
                        )}
                      </Text>
                      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={theme.inkSoft} />
                    </Pressable>

                    {open && (
                      <View style={{ paddingHorizontal: 10, paddingBottom: 12 }}>
                        <View style={{ flexDirection: rowDir, alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
                          <Field
                            surface="sunken" value={exercise.name} placeholder={t('exerciseName')}
                            onChangeText={(v) => patchExerciseName(bi, ei, v)} style={{ flex: 1 }}
                          />
                          <IconButton
                            name="trash-outline" size={18} label={t('removeExercise')} color={theme.critical}
                            onPress={() => removeExercise(bi, ei)}
                          />
                        </View>
                        <View style={{ flexDirection: rowDir, alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                          <Pressable
                            onPress={() => setUnitSheetFor({ bi, ei, metricIndex: 0 })} hitSlop={6}
                            style={{ flexDirection: rowDir, alignItems: 'center', gap: 3 }}
                          >
                            <Text style={{ color: theme.inkSoft, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>
                              {unitLabel(primary.unit, customUnits, t)}
                            </Text>
                            <Ionicons name="chevron-down" size={10} color={theme.inkSoft} />
                          </Pressable>
                          {/* Only removable once a second metric exists to
                              take over as the (sole) remaining one — an
                              exercise can't drop to zero metrics. */}
                          {extra && (
                            <IconButton name="close" size={14} label={t('remove')} color={theme.inkSoft} onPress={() => removeMetric(bi, ei, 0)} />
                          )}
                        </View>
                        <UnitScroller
                          value={primary.value} unit={primary.unit} tiers={primary.tiers} last={lastPrimary}
                          onChange={(v) => patchMetricValue(bi, ei, 0, v)}
                        />
                        {extra && (
                          <View style={{ marginTop: spacing.sm }}>
                            <View style={{ flexDirection: rowDir, alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                              <Pressable
                                onPress={() => setUnitSheetFor({ bi, ei, metricIndex: 1 })} hitSlop={6}
                                style={{ flexDirection: rowDir, alignItems: 'center', gap: 3 }}
                              >
                                <Text style={{ color: theme.inkSoft, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>
                                  {unitLabel(extra.unit, customUnits, t)}
                                </Text>
                                <Ionicons name="chevron-down" size={10} color={theme.inkSoft} />
                              </Pressable>
                              <IconButton name="close" size={14} label={t('remove')} color={theme.inkSoft} onPress={() => removeMetric(bi, ei, 1)} />
                            </View>
                            <UnitScroller
                              compact value={extra.value} unit={extra.unit} last={last[exercise.name]?.[1]?.value ?? null}
                              onChange={(v) => patchMetricValue(bi, ei, 1, v)}
                            />
                          </View>
                        )}
                        {!extra && (
                          <View style={{ marginTop: spacing.sm, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.rule }}>
                            <Button variant="dashed" size="md" block onPress={() => setUnitSheetFor({ bi, ei, metricIndex: exercise.metrics.length })}
                              icon={<Ionicons name="add" size={15} color={theme.inkSoft} />}>
                              {t('addUnitButton')}
                            </Button>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
              {/* Flush to the card's own bottom edge, not a separate dashed
                  pill floating below it — containment reads as "this adds
                  to the block" in a way two peer buttons couldn't. Card's
                  own overflow:'hidden' + rounded corners clip this row's
                  bottom edge to match automatically. */}
              <Pressable
                onPress={() => addExercise(bi)}
                style={{
                  flexDirection: rowDir, alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
                  minHeight: 44, padding: 12, borderTopWidth: 1, borderTopColor: theme.rule,
                }}
              >
                <Ionicons name="add" size={16} color={theme.accent} />
                <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '700' }}>{t('addExercise')}</Text>
              </Pressable>
            </Card>
          </View>
        ))}

        <Button variant="dashed" size="md" block onPress={addBlock} icon={<Ionicons name="add" size={15} color={theme.inkSoft} />} style={{ marginBottom: spacing.md }}>
          {t('addBlock')}
        </Button>

        {tree.scoreType && (
          <ScoreEntry
            type={tree.scoreType} value={score}
            onChange={(k, v) => setScore((s) => ({ ...s, [k]: v }))}
            style={{ marginBottom: spacing.md }}
          />
        )}

        <NoticeCard>{t('savesAsPlanned')}</NoticeCard>
      </ScrollView>

      {removed && (
        <UndoBar
          message={t('removedX', { name: (removed.exercise?.name || removed.block?.name) || t('exercise') })}
          // This is a pushed route, not a tab screen — no floating tab bar
          // sits under it, so dock relative to the Save button itself
          // (spacing.md from the bottom, Button's default "lg" height 50)
          // rather than TAB_BAR_CLEARANCE, which was reserving phantom
          // space for a tab bar that's never there and floating this way
          // too high as a result.
          bottom={spacing.md + 50 + spacing.sm}
          onUndo={undoRemove}
        />
      )}

      <View style={{ position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md }}>
        <Button block busy={saving} onPress={handleSaveTap}>{t('saveSession')}</Button>
      </View>

      <BottomSheet
        visible={unitSheetFor !== null}
        title={
          unitSheetFor && (tree.blocks[unitSheetFor.bi]?.exercises[unitSheetFor.ei]?.metrics.length ?? 0) > unitSheetFor.metricIndex
            ? t('changeUnit')
            : t('addUnit')
        }
        onClose={() => { setUnitSheetFor(null); setCustomUnitForm(null); }}
      >
        {customUnitForm ? (
          <View style={{ gap: spacing.sm }}>
            <Field label={t('customUnitLabel')} value={customUnitForm.label} onChangeText={(v) => setCustomUnitForm({ ...customUnitForm, label: v })} placeholder={t('customUnitPlaceholder')} />
            <Field label={t('customUnitStep')} value={customUnitForm.step} onChangeText={(v) => setCustomUnitForm({ ...customUnitForm, step: v })} keyboardType="decimal-pad" />
            <Button block onPress={createCustomUnit}>{t('done')}</Button>
          </View>
        ) : (
          <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: spacing.sm }}>
            {PRESET_UNIT_KEYS.map((u) => (
              <Chip key={u} onPress={() => unitSheetFor && setMetricUnit(unitSheetFor.bi, unitSheetFor.ei, unitSheetFor.metricIndex, u)}>
                {unitLabel(u, customUnits, t)}
              </Chip>
            ))}
            {customUnits.map((c) => (
              <Chip key={c.key} onPress={() => unitSheetFor && setMetricUnit(unitSheetFor.bi, unitSheetFor.ei, unitSheetFor.metricIndex, c.key)}>
                {c.label}
              </Chip>
            ))}
            <Pressable
              onPress={() => setCustomUnitForm({ label: '', step: '1' })}
              style={{
                minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderStyle: 'dashed', borderColor: theme.rule,
              }}
            >
              <Text style={{ color: theme.inkSoft, fontSize: 13, fontWeight: '700' }}>{t('customUnitCta')}</Text>
            </Pressable>
          </View>
        )}
      </BottomSheet>

      <BottomSheet visible={showIntensitySheet} title={t('howHardWasThat')} onClose={() => setShowIntensitySheet(false)}>
        <Text style={{ color: theme.inkSoft, fontSize: 12.5, marginBottom: spacing.md, textAlign: align }}>
          {t('intensitySubtitle')}
        </Text>
        <IntensityPicker value={intensity} onChange={setIntensity} />
        {!noteOpen ? (
          <Button variant="dashed" size="md" block onPress={() => setNoteOpen(true)} style={{ marginTop: spacing.md }}
            icon={<Ionicons name="create-outline" size={15} color={theme.inkSoft} />}>
            {t('addANote')}
          </Button>
        ) : (
          <View style={{ marginTop: spacing.md }}>
            <Field value={note} onChangeText={setNote} placeholder={t('notePlaceholder')} />
          </View>
        )}
        <Button block busy={saving} onPress={finishSave} style={{ marginTop: spacing.md }}>
          {intensity ? t('done') : t('skip')}
        </Button>
      </BottomSheet>

      <LoadingOverlay visible={saving} object="stopwatch" label={t('savingSession')} />
      <LoadingOverlay visible={discarding} object="stopwatch" label={t('discardingSession')} />
    </View>
  );
}
