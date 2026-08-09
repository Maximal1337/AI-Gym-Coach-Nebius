import { useState } from 'react';
import { Alert, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { openStudioSession, type StudioSessionSource } from '../src/lib/studioApi';
import { DismissKeyboardView } from '../src/components/DismissKeyboardView';
import { LoadingOverlay } from '../src/components/LoadingOverlay';
import { Screen } from '../src/components/Screen';
import { useLanguage } from '../src/lib/language';
import { useTheme, spacing, radius } from '../src/theme';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const UPLOAD_TYPES = ['application/pdf', DOCX_MIME, 'text/plain'];
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

// Same single-in-flight-picker guard as PlanPasteFlow.tsx — a second
// getDocumentAsync() presented while the first hasn't resolved can silently
// no-op on iOS.
let pickerInFlight: Promise<unknown> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('document_picker_timed_out')), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
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
  settled.finally(() => { if (pickerInFlight === settled) pickerInFlight = null; });
  return call;
}

/**
 * Paste a studio board as text, or upload a file — the two non-photo "add a
 * workout" methods (guidelines/studio-workout-entry.html). Converges on
 * studio-session's `open`, same as studio-photo.tsx; no separate preview
 * step, since the session screen is itself the live, editable review.
 */
export default function StudioPasteScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const { initialMode } = useLocalSearchParams<{ initialMode?: string }>();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showUploadLauncher] = useState(initialMode === 'upload');
  const [picking, setPicking] = useState(false);

  async function openWith(source: StudioSessionSource) {
    setBusy(true);
    try {
      const res = await openStudioSession({ source });
      router.replace({ pathname: '/studio-session', params: { sessionId: res.sessionId } });
    } catch {
      Alert.alert(t('parseFailed'));
    } finally {
      setBusy(false);
      setPicking(false);
    }
  }

  async function pickAndParseFile() {
    setPicking(true);
    try {
      const picked = await pickDocument();
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      if (asset.size && asset.size > MAX_UPLOAD_BYTES) {
        Alert.alert(t('uploadTooLarge'));
        return;
      }
      const file = new File(asset.uri);
      const isPdf = asset.mimeType === 'application/pdf' || asset.name.toLowerCase().endsWith('.pdf');
      const isDocx = asset.mimeType === DOCX_MIME || asset.name.toLowerCase().endsWith('.docx');
      await openWith(
        isPdf ? { pdfBase64: await file.base64(), filename: asset.name }
          : isDocx ? { docxBase64: await file.base64(), filename: asset.name }
            : { text: await file.text() },
      );
    } catch {
      Alert.alert(t('parseFailed'));
      setPicking(false);
    }
  }

  return (
    <Screen>
    <DismissKeyboardView style={{ padding: spacing.lg }}>
      <LoadingOverlay visible={busy && !picking} object="plate" label={t('parsing')} />
      <Pressable onPress={() => router.back()} style={{ marginBottom: spacing.md, alignSelf: dir === 'rtl' ? 'flex-end' : 'flex-start' }}>
        <Text style={{ color: theme.inkSoft, fontSize: 12, fontWeight: '600' }}>{t('cancel')}</Text>
      </Pressable>
      <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', marginBottom: spacing.sm, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
        {picking ? t('uploadTitle') : showUploadLauncher ? t('uploadChooseTitle') : t('pasteItIn')}
      </Text>

      {picking ? (
        <Text style={{ color: theme.inkSoft, textAlign: dir === 'rtl' ? 'right' : 'left' }}>{t('uploadSub')}</Text>
      ) : showUploadLauncher ? (
        <>
          <Text style={{ color: theme.inkSoft, marginBottom: spacing.md, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {t('uploadChooseSub')}
          </Text>
          <Pressable
            onPress={() => void pickAndParseFile()}
            style={{ backgroundColor: theme.accent, padding: 14, borderRadius: radius.pill, alignItems: 'center', marginTop: spacing.md }}
          >
            <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{t('uploadChooseCta')}</Text>
          </Pressable>
        </>
      ) : (
        <View style={{ flex: 1 }}>
          <TextInput
            multiline
            placeholder={t('studioPastePlaceholder')}
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
            onPress={() => { Keyboard.dismiss(); void openWith({ text }); }}
            style={{
              backgroundColor: text.length >= 10 ? theme.accent : theme.rule,
              padding: 14, borderRadius: radius.pill, alignItems: 'center', marginTop: spacing.md,
            }}
          >
            <Text style={{ color: text.length >= 10 ? theme.onAccent : theme.inkSoft, fontWeight: '700' }}>
              {busy ? t('parsing') : t('parsePlan')}
            </Text>
          </Pressable>
        </View>
      )}
    </DismissKeyboardView>
    </Screen>
  );
}
