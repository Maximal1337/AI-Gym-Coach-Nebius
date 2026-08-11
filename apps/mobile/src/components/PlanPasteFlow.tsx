import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { callFn, ApiError } from '../lib/api';
import { supabase } from '../lib/supabase';
import { DismissKeyboardView } from './DismissKeyboardView';
import { PlanPreview, StartingWeightsCelebration, type ParsedPlan } from './PlanPreview';
import type { StartingWeightsPlan } from './StartingWeightsStep';
import { SketchLoader } from './SketchLoader';
import { LoadingOverlay } from './LoadingOverlay';
import { useLanguage } from '../lib/language';
import { useTheme, spacing, radius } from '../theme';

// Base64 inflates a file by ~33%; the server independently caps the
// base64 string itself (see services/agent/src/server.ts), this just
// avoids uploading something that's going to be rejected anyway.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Legacy .doc (pre-2007 binary format) isn't supported — it's a much
// harder format to parse reliably and modern Word/Google Docs both
// default to .docx, so this covers the real-world case.
const UPLOAD_TYPES = ['application/pdf', DOCX_MIME, 'text/plain'];

// expo-document-picker has no cancel API. Backing out of this screen
// (native back gesture, not the in-app Cancel button) while its native
// sheet is still presenting leaves that getDocumentAsync() call
// outstanding — presenting a SECOND native picker while the first's
// completion handler never fired is a known iOS conflict, and the
// second call can silently fail to appear (GYM: "second time doesn't
// work"). Serializing every call through one in-flight promise means a
// fresh attempt always waits for any abandoned prior one to settle
// first, instead of racing it; the timeout below caps how long that
// wait (and the call itself) can possibly hang for.
let pickerInFlight: Promise<unknown> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('document_picker_timed_out')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

async function pickDocument(): Promise<DocumentPicker.DocumentPickerResult> {
  const prior = pickerInFlight;
  const call = (async () => {
    if (prior) await prior;
    return withTimeout(DocumentPicker.getDocumentAsync({ type: UPLOAD_TYPES }), 20000);
  })();
  const settled = call.then(() => {}, () => {});
  pickerInFlight = settled;
  settled.finally(() => {
    if (pickerInFlight === settled) pickerInFlight = null;
  });
  return call;
}

/**
 * Paste-and-parse plan flow (GYM-26), shared between first-run onboarding
 * and adding/editing a training type afterward (GYM-69) — same screen,
 * different commit semantics server-side (see plan-import's `mode`).
 */
export function PlanPasteFlow({
  mode, editPlanId, onDone, onCancel, initialMode = 'paste',
}: {
  mode: 'onboarding' | 'add' | 'edit';
  editPlanId?: string;
  onDone: () => void;
  /** Only meaningful where there's no real screen to navigate back to (onboarding's local-state flow) — 'add'/'edit' are pushed routes with native back already. */
  onCancel?: () => void;
  /** 'upload' opens the file picker immediately instead of showing the paste textbox first — used when the caller's own entry point was explicitly "upload a file", not "paste text". */
  initialMode?: 'paste' | 'upload';
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();

  function handleParseError(e: unknown) {
    if (e instanceof ApiError && e.code === 'subscription_required') {
      Alert.alert(t('trialExpired'));
      router.push('/subscribe');
    } else {
      Alert.alert(t('parseFailed'));
    }
  }

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ParsedPlan[] | null>(null);
  // Rendered as a sibling to this screen's own DismissKeyboardView, not
  // inside it — see StartingWeightsCelebration's doc comment (PlanPreview.tsx)
  // for why owning this here (rather than letting DismissKeyboardView's
  // `active` prop toggle around an internally-rendered step) is required.
  const [startingWeightsPlans, setStartingWeightsPlans] = useState<StartingWeightsPlan[] | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(mode === 'edit');
  // Shows the "Choose a file" launcher screen instead of the paste
  // textbox for initialMode === 'upload'.
  const [showUploadLauncher] = useState(initialMode === 'upload');
  // True only while a pick+parse is actually in flight, for the "Reading
  // your file" loading screen — distinct from showUploadLauncher, which
  // stays true for the whole upload path so a failed/canceled pick falls
  // back to the launcher (with its own "choose a file" button) rather
  // than to the wrong-mode paste textbox.
  const [picking, setPicking] = useState(false);
  // Which path actually produced the current preview — "Try again" (in
  // PlanPreview) needs this to know whether to re-open the file picker or
  // fall back to the paste textbox; initialMode alone isn't enough, since
  // a failed initial upload can still fall through to a typed-text parse.
  const [previewSource, setPreviewSource] = useState<'upload' | 'paste' | null>(null);

  // Editing an existing plan skips the paste-and-parse step entirely —
  // load its current exercises straight into the review/edit screen.
  useEffect(() => {
    if (mode !== 'edit' || !editPlanId) return;
    let cancelled = false;
    (async () => {
      setLoadingExisting(true);
      const [{ data: planRow }, { data: exRows }] = await Promise.all([
        supabase.from('training_plans').select('name').eq('id', editPlanId).single(),
        supabase
          .from('exercises')
          .select('order_index, name, sets, rep_range, rest_sec, intensity, warmup, equipment_type')
          .eq('plan_id', editPlanId)
          .eq('source', 'plan') // exclude session-only substitutions (System Design §20)
          .order('order_index'),
      ]);
      if (cancelled) return;
      if (planRow) {
        setPreview([
          {
            name: planRow.name,
            exercises: (exRows ?? []).map((e) => ({
              orderIndex: e.order_index,
              name: e.name,
              sets: e.sets,
              repRange: e.rep_range,
              restSec: e.rest_sec,
              intensity: e.intensity,
              warmup: e.warmup,
              equipmentType: e.equipment_type,
            })),
          },
        ]);
      } else {
        Alert.alert(t('coachUnavailable'));
      }
      setLoadingExisting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, editPlanId, t]);

  async function parse() {
    setBusy(true);
    try {
      const res = await callFn<{ plans: ParsedPlan[] }>('plan-import', { action: 'parse', text });
      setPreview(res.plans);
      setPreviewSource('paste');
    } catch (e) {
      handleParseError(e);
    } finally {
      setBusy(false);
    }
  }

  // "Try again" only clears the preview by default (PlanPreview.tsx),
  // which always drops back to the paste textbox — fine for a typed-text
  // preview, but wrong for an uploaded one: re-open the picker instead so
  // "try again" actually retries the same action the user took. This is
  // itself a direct continuation of the user's tap on "Try again", not a
  // mount-time auto-trigger, so it doesn't have the transition-race issue
  // the old useEffect had.
  function handleTryAgain() {
    setPreview(null);
    if (previewSource === 'upload') void pickAndParseFile();
  }

  async function pickAndParseFile() {
    // getDocumentAsync itself must be inside the try — left bare, a
    // rejection here (the native picker failing to present, a permission
    // denial, anything) was an unhandled promise rejection that never
    // reset picking, leaving the screen stuck on the loading state
    // forever with no error shown.
    setPicking(true);
    try {
      const picked = await pickDocument();
      if (picked.canceled || !picked.assets?.[0]) {
        // Falls back to the "Choose a file" launcher (still showing, since
        // showUploadLauncher never changes) rather than leaving the whole
        // flow — canceling the native sheet should land back on the
        // screen that opened it, and lets the user immediately retry with
        // a fresh tap.
        return;
      }
      const asset = picked.assets[0];
      if (asset.size && asset.size > MAX_UPLOAD_BYTES) {
        Alert.alert(t('uploadTooLarge'));
        return;
      }
      setBusy(true);
      const file = new File(asset.uri);
      const isPdf = asset.mimeType === 'application/pdf' || asset.name.toLowerCase().endsWith('.pdf');
      const isDocx = asset.mimeType === DOCX_MIME || asset.name.toLowerCase().endsWith('.docx');
      const payload = isPdf
        ? { pdfBase64: await file.base64(), filename: asset.name }
        : isDocx
          ? { docxBase64: await file.base64(), filename: asset.name }
          : { text: await file.text() };
      const res = await callFn<{ plans: ParsedPlan[] }>('plan-import', { action: 'parse', ...payload });
      setPreview(res.plans);
      setPreviewSource('upload');
    } catch (e) {
      handleParseError(e);
    } finally {
      setBusy(false);
      setPicking(false);
    }
  }

  const stepLabel = mode === 'onboarding' ? t('planStep') : mode === 'edit' ? t('editPlanStep') : t('addPlanStep');

  if (startingWeightsPlans) {
    return (
      <View style={{ flex: 1, padding: spacing.lg }}>
        <StartingWeightsCelebration plans={startingWeightsPlans} onDone={onDone} />
      </View>
    );
  }

  return (
    <DismissKeyboardView style={{ padding: spacing.lg }}>
      <LoadingOverlay visible={busy && !picking} object="plate" label={t('parsing')} />
      {onCancel && !preview && (
        <Pressable onPress={onCancel} style={{ marginBottom: spacing.md, alignSelf: dir === 'rtl' ? 'flex-end' : 'flex-start' }}>
          <Text style={{ color: theme.inkSoft, fontSize: 12, fontWeight: '600' }}>{t('cancel')}</Text>
        </Pressable>
      )}
      <Text style={{ color: theme.inkSoft, fontSize: 12, fontWeight: '700', textAlign: dir === 'rtl' ? 'right' : 'left' }}>
        {stepLabel}
      </Text>
      <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', marginVertical: spacing.sm, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
        {preview ? t('confirmPlanTitle') : picking ? t('uploadTitle') : showUploadLauncher ? t('uploadChooseTitle') : t('planTitle')}
      </Text>
      {preview && (
        <Text style={{ color: theme.inkSoft, fontSize: 12.5, marginBottom: spacing.sm, marginTop: -spacing.xs, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
          {t('tapToChangeHint')}
        </Text>
      )}

      {loadingExisting ? (
        <ActivityIndicator color={theme.accent} style={{ marginTop: spacing.lg }} />
      ) : picking ? (
        <>
          <Text style={{ color: theme.inkSoft, marginBottom: spacing.md, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {t('uploadSub')}
          </Text>
          <SketchLoader
            size={88} objects={['plate']} orbit={false} stroke={3.2} dir={dir}
            style={{ marginTop: spacing.lg, alignSelf: 'center' }}
          />
        </>
      ) : showUploadLauncher && !preview ? (
        <>
          <Text style={{ color: theme.inkSoft, marginBottom: spacing.md, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {t('uploadChooseSub')}
          </Text>
          {/* A direct tap, not a mount-time auto-trigger — presenting the
              native picker only in response to a settled screen's own
              button press avoids racing this screen's push-transition
              animation, which silently swallowed the picker presentation
              on a repeat attempt (GYM: "second time doesn't work"). */}
          <Pressable
            onPress={() => void pickAndParseFile()}
            style={{
              backgroundColor: theme.accent, padding: 14, borderRadius: radius.pill, alignItems: 'center', marginTop: spacing.md,
            }}
          >
            <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{t('uploadChooseCta')}</Text>
          </Pressable>
        </>
      ) : !preview ? (
        <>
          <Text style={{ color: theme.inkSoft, marginBottom: spacing.md, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {t('planSub')}
          </Text>
          <TextInput
            multiline
            placeholder={t('planPlaceholder')}
            placeholderTextColor={theme.inkSoft}
            value={text}
            onChangeText={setText}
            blurOnSubmit={false}
            style={{
              flex: 1, backgroundColor: theme.surface, borderRadius: radius.card,
              padding: spacing.md, color: theme.ink, textAlign: dir === 'rtl' ? 'right' : 'left', textAlignVertical: 'top',
            }}
          />
          <Pressable
            disabled={busy || text.length < 10}
            onPress={() => {
              Keyboard.dismiss();
              parse();
            }}
            style={{
              backgroundColor: text.length >= 10 ? theme.accent : theme.rule,
              padding: 14, borderRadius: radius.pill, alignItems: 'center', marginTop: spacing.md,
            }}
          >
            <Text style={{ color: text.length >= 10 ? theme.onAccent : theme.inkSoft, fontWeight: '700' }}>
              {busy ? t('parsing') : t('parsePlan')}
            </Text>
          </Pressable>
        </>
      ) : (
        <PlanPreview
          preview={preview}
          setPreview={setPreview}
          mode={mode}
          editPlanId={editPlanId}
          onDone={onDone}
          onTryAgain={handleTryAgain}
          onEnterStartingWeights={setStartingWeightsPlans}
        />
      )}
    </DismissKeyboardView>
  );
}
