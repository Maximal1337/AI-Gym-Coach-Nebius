import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Pressable, Text, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { callFn } from '../lib/api';
import { supabase } from '../lib/supabase';
import { DismissKeyboardView } from './DismissKeyboardView';
import { PlanPreview, type ParsedPlan } from './PlanPreview';
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
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ParsedPlan[] | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(mode === 'edit');
  // Hides the paste textbox while the picker sheet is being auto-opened
  // for initialMode === 'upload' — otherwise it flashes underneath the
  // native picker for a frame before either a file comes back or onCancel
  // navigates away.
  const [openingPicker, setOpeningPicker] = useState(initialMode === 'upload');
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
    } catch {
      Alert.alert(t('parseFailed'));
    } finally {
      setBusy(false);
    }
  }

  // "Try again" only clears the preview by default (PlanPreview.tsx),
  // which always drops back to the paste textbox — fine for a typed-text
  // preview, but wrong for an uploaded one: re-open the picker instead so
  // "try again" actually retries the same action the user took.
  function handleTryAgain() {
    setPreview(null);
    if (previewSource === 'upload') {
      setOpeningPicker(true);
      void pickAndParseFile();
    }
  }

  // initialMode === 'upload' means the caller's own entry point was
  // already "upload a file" (a peer choice next to generate/paste/manual,
  // not a link buried inside the paste screen) — open the picker
  // immediately, and if the user backs out of it, there's nothing useful
  // to fall back to here, so leave the same way "cancel" would.
  useEffect(() => {
    if (initialMode === 'upload') void pickAndParseFile();
  }, []);

  async function pickAndParseFile() {
    // getDocumentAsync itself must be inside the try — left bare, a
    // rejection here (the native picker failing to present, a permission
    // denial, anything) was an unhandled promise rejection that never
    // reset openingPicker, leaving the screen stuck on the loading state
    // forever with no error shown.
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: UPLOAD_TYPES });
      if (picked.canceled || !picked.assets?.[0]) {
        setOpeningPicker(false);
        onCancel?.();
        return;
      }
      const asset = picked.assets[0];
      if (asset.size && asset.size > MAX_UPLOAD_BYTES) {
        setOpeningPicker(false);
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
      Alert.alert(t('parseFailed'), e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
      // Falls through to the normal paste screen on failure, so an
      // upload that didn't work isn't a dead end — success re-renders
      // into the preview branch regardless of this flag.
      setOpeningPicker(false);
    }
  }

  const stepLabel = mode === 'onboarding' ? t('planStep') : mode === 'edit' ? t('editPlanStep') : t('addPlanStep');

  return (
    <DismissKeyboardView style={{ padding: spacing.lg }}>
      <LoadingOverlay visible={busy && !openingPicker} object="plate" label={t('parsing')} />
      {onCancel && !preview && (
        <Pressable onPress={onCancel} style={{ marginBottom: spacing.md, alignSelf: dir === 'rtl' ? 'flex-end' : 'flex-start' }}>
          <Text style={{ color: theme.inkSoft, fontSize: 12, fontWeight: '600' }}>{t('cancel')}</Text>
        </Pressable>
      )}
      <Text style={{ color: theme.inkSoft, fontSize: 12, fontWeight: '700', textAlign: dir === 'rtl' ? 'right' : 'left' }}>
        {stepLabel}
      </Text>
      <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', marginVertical: spacing.sm, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
        {preview ? t('confirmPlanTitle') : openingPicker ? t('uploadTitle') : t('planTitle')}
      </Text>
      {preview && (
        <Text style={{ color: theme.inkSoft, fontSize: 12.5, marginBottom: spacing.sm, marginTop: -spacing.xs, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
          {t('tapToChangeHint')}
        </Text>
      )}

      {loadingExisting ? (
        <ActivityIndicator color={theme.accent} style={{ marginTop: spacing.lg }} />
      ) : openingPicker ? (
        <>
          <Text style={{ color: theme.inkSoft, marginBottom: spacing.md, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {t('uploadSub')}
          </Text>
          <SketchLoader
            size={88} objects={['plate']} orbit={false} stroke={3.2} dir={dir}
            style={{ marginTop: spacing.lg, alignSelf: 'center' }}
          />
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
        />
      )}
    </DismissKeyboardView>
  );
}
