import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callFn } from '../lib/api';
import { useLanguage } from '../lib/language';
import { useTheme, spacing, radius } from '../theme';
import { Button } from './Button';
import { Screen } from './Screen';
import { SketchLoader } from './SketchLoader';
import { PlanPreview, type ParsedPlan } from './PlanPreview';
import { PlanPasteFlow } from './PlanPasteFlow';

const MAX_PAGES = 3;
// Printed-page photos are mostly white background + text — highly
// compressible, so 1600px-wide JPEG at this quality comfortably lands
// under plan-import's per-image cap regardless of the source camera's
// native resolution, without a visible quality loss for OCR purposes.
const RESIZE_WIDTH = 1600;
const JPEG_QUALITY = 0.5;
const PARSING_LINES = ['parsing', 'photoLine2', 'photoLine3'];

interface Shot { uri: string; base64: string }

async function compressPhoto(uri: string): Promise<Shot> {
  const image = await ImageManipulator.manipulate(uri).resize({ width: RESIZE_WIDTH }).renderAsync();
  const result = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });
  return { uri: result.uri, base64: result.base64! };
}

type Step = 'camera' | 'review' | 'parsing' | 'preview' | 'type-instead';

/**
 * Photograph a printed plan (guidelines/photograph-plan.html) — a peer of
 * paste/upload/manual, not a mode buried inside upload: photographing
 * paper and picking a PDF are different intentions with different
 * starting points. Camera → review & retake → analyze → the same
 * PlanPreview every other route converges on. The review step is the
 * whole reliability story here — a thumb over a corner or a glare stripe
 * gets caught by the person still holding the sheet, not by a parse
 * failure two minutes later.
 */
export function PhotographPlanFlow({
  mode, onCancel, onDone,
}: {
  mode: 'onboarding' | 'add';
  onCancel: () => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [step, setStep] = useState<Step>('camera');
  const [shots, setShots] = useState<Shot[]>([]);
  // Which shot a new capture/pick replaces; null means "append a new page".
  const [retakeIndex, setRetakeIndex] = useState<number | null>(null);
  // Which shot is open in the full-size viewer (tapping the thumbnail
  // itself inspects it — the review step's whole point is checking that
  // numbers are actually legible, which a ~100px thumbnail can't show;
  // only the small reload badge on the thumbnail triggers a retake).
  const [previewShotIndex, setPreviewShotIndex] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [preview, setPreview] = useState<ParsedPlan[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [lineIdx, setLineIdx] = useState(0);

  useEffect(() => {
    if (!permission) return;
    if (!permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission]);

  useEffect(() => {
    if (step !== 'parsing') return;
    const id = setInterval(() => setLineIdx((i) => (i + 1) % PARSING_LINES.length), 1400);
    return () => clearInterval(id);
  }, [step]);

  function addOrReplaceShot(shot: Shot) {
    setShots((prev) => {
      if (retakeIndex === null) return [...prev, shot];
      return prev.map((s, i) => (i === retakeIndex ? shot : s));
    });
    setRetakeIndex(null);
  }

  async function shoot() {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const picture = await cameraRef.current.takePictureAsync({ quality: 0.5 });
      if (!picture) return;
      const shot = await compressPhoto(picture.uri);
      const wasRetake = retakeIndex !== null;
      addOrReplaceShot(shot);
      // A retake goes straight back to review; adding a page keeps the
      // camera open so the next page can be shot right away — "Done"
      // (below) is the only thing that advances there otherwise.
      if (wasRetake) setStep('review');
    } catch {
      Alert.alert(t('photoParseFailed'));
    } finally {
      setCapturing(false);
    }
  }

  async function pickFromGallery() {
    const isRetake = retakeIndex !== null;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsMultipleSelection: !isRetake,
      selectionLimit: isRetake ? 1 : Math.max(1, MAX_PAGES - shots.length),
    });
    if (result.canceled || result.assets.length === 0) return;
    setCapturing(true);
    try {
      const compressed = await Promise.all(result.assets.map((a) => compressPhoto(a.uri)));
      if (isRetake) {
        addOrReplaceShot(compressed[0]);
      } else {
        setShots((prev) => [...prev, ...compressed].slice(0, MAX_PAGES));
      }
      setStep('review');
    } catch {
      Alert.alert(t('photoParseFailed'));
    } finally {
      setCapturing(false);
    }
  }

  function retake(index: number) {
    setRetakeIndex(index);
    setStep('camera');
  }

  async function parse() {
    setStep('parsing');
    setBusy(true);
    try {
      const res = await callFn<{ plans: ParsedPlan[] }>('plan-import', {
        action: 'parse',
        imagesBase64: shots.map((s) => s.base64),
      });
      setPreview(res.plans);
      setStep('preview');
    } catch {
      Alert.alert(t('photoParseFailed'));
      setStep('review');
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setShots([]);
    setPreview(null);
    setRetakeIndex(null);
    setStep('camera');
  }

  if (step === 'type-instead') {
    return (
      <Screen>
        <PlanPasteFlow
          mode={mode}
          onDone={onDone}
          onCancel={() => setStep('review')}
          initialMode="paste"
        />
      </Screen>
    );
  }

  if (step === 'preview' && preview) {
    return (
      <Screen>
        <View style={{ flex: 1, padding: spacing.lg }}>
          <PlanPreview
            preview={preview}
            setPreview={setPreview}
            mode={mode}
            onDone={onDone}
            onTryAgain={restart}
            tryAgainLabel={t('photoRetakeAll')}
          />
        </View>
      </Screen>
    );
  }

  if (step === 'parsing') {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <SketchLoader label={t(PARSING_LINES[lineIdx])} dir={dir} />
        </View>
      </Screen>
    );
  }

  if (step === 'review') {
    return (
      <Screen>
      <View style={{ flex: 1 }}>
        <View style={{
          flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: spacing.sm,
          paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
        }}>
          <Pressable onPress={() => setStep('camera')} hitSlop={10}>
            <Ionicons name={dir === 'rtl' ? 'chevron-forward' : 'chevron-back'} size={22} color={theme.inkSoft} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.ink, fontSize: 18, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left' }}>
              {t('reviewTitle')}
            </Text>
            <Text style={{ color: theme.inkSoft, fontSize: 12, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
              {t('shotCount', { count: shots.length })}
            </Text>
          </View>
        </View>

        <ScrollView style={{ flex: 1, paddingHorizontal: spacing.lg }}>
          <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
            {shots.map((shot, i) => (
              <Pressable
                key={shot.uri}
                onPress={() => setPreviewShotIndex(i)}
                accessibilityLabel={`${t('reviewTitle')} ${i + 1}`}
                style={{ width: 100, height: 134, borderRadius: radius.field, overflow: 'hidden' }}
              >
                <Image source={{ uri: shot.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                <View style={{
                  position: 'absolute', top: 4, insetInlineStart: 4,
                  backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
                }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{i + 1}</Text>
                </View>
                {/* A separate tap target from the thumbnail itself — tapping
                    the photo inspects it, only this badge retakes it. */}
                <Pressable
                  onPress={() => retake(i)}
                  hitSlop={6}
                  accessibilityLabel={t('shotRetake')}
                  style={{
                    position: 'absolute', top: 4, insetInlineEnd: 4, width: 24, height: 24, borderRadius: 12,
                    backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Ionicons name="refresh" size={13} color="#fff" />
                </Pressable>
              </Pressable>
            ))}
            {shots.length < MAX_PAGES && (
              <Pressable
                onPress={() => { setRetakeIndex(null); setStep('camera'); }}
                style={{
                  width: 100, height: 134, borderRadius: radius.field, borderWidth: 1, borderStyle: 'dashed',
                  borderColor: theme.rule, alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <Ionicons name="add" size={20} color={theme.inkSoft} />
                <Text style={{ color: theme.inkSoft, fontSize: 11, fontWeight: '600' }}>{t('shotAddPage')}</Text>
              </Pressable>
            )}
          </View>

          <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, padding: spacing.md }}>
            <Text style={{ color: theme.ink, fontSize: 12.5, fontWeight: '700', marginBottom: 3, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
              {t('reviewNoticeLabel')}
            </Text>
            <Text style={{ color: theme.inkSoft, fontSize: 12.5, lineHeight: 18, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
              {t('reviewNoticeBody')}
            </Text>
          </View>
        </ScrollView>

        <View style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Button block disabled={shots.length === 0} onPress={parse}>{t('parsePlan')}</Button>
          <Button variant="quiet" block onPress={() => setStep('type-instead')}>{t('typeItInstead')}</Button>
        </View>
      </View>

      <Modal
        visible={previewShotIndex !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setPreviewShotIndex(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }}
          onPress={() => setPreviewShotIndex(null)}
        >
          {previewShotIndex !== null && (
            <Image
              source={{ uri: shots[previewShotIndex].uri }}
              style={{ width: '92%', height: '80%' }}
              resizeMode="contain"
            />
          )}
          <View style={{ position: 'absolute', top: insets.top + spacing.sm, insetInlineEnd: spacing.md }}>
            <Pressable onPress={() => setPreviewShotIndex(null)} hitSlop={10} accessibilityLabel={t('close')}>
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>
          </View>
          {previewShotIndex !== null && (
            <View style={{ position: 'absolute', bottom: insets.bottom + spacing.lg }}>
              <Button
                variant="secondary"
                onPress={() => { const i = previewShotIndex; setPreviewShotIndex(null); retake(i); }}
              >
                {t('shotRetake')}
              </Button>
            </View>
          )}
        </Pressable>
      </Modal>
      </Screen>
    );
  }

  // step === 'camera' — permission is null while the initial check/prompt
  // (the effect above) is still in flight; only a resolved, denied
  // response should show the "denied" messaging, not the loading gap.
  if (permission === null) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      </Screen>
    );
  }
  if (!permission.granted) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md }}>
          <Text style={{ color: theme.ink, textAlign: 'center', fontWeight: '600' }}>{t('cameraPermissionDenied')}</Text>
          <Button onPress={() => Linking.openSettings()}>{t('openSettings')}</Button>
          <Pressable onPress={onCancel}><Text style={{ color: theme.inkSoft, fontWeight: '600' }}>{t('cancel')}</Text></Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back">
        {/* Frame guide — corner marks showing the target capture area, cheap
            to build and the difference between a parse that works and one
            that fails after a 20-second wait on a cropped/angled shot. */}
        <View pointerEvents="none" style={{ position: 'absolute', left: 32, right: 32, top: 140, bottom: 200 }}>
          {([['left', 'top'], ['right', 'top'], ['left', 'bottom'], ['right', 'bottom']] as const).map(([x, y]) => (
            <View
              key={`${x}-${y}`}
              style={{
                position: 'absolute', width: 26, height: 26,
                [x]: 0, [y]: 0,
                borderTopWidth: y === 'top' ? 3 : 0,
                borderBottomWidth: y === 'bottom' ? 3 : 0,
                borderLeftWidth: x === 'left' ? 3 : 0,
                borderRightWidth: x === 'right' ? 3 : 0,
                borderColor: theme.accent,
              }}
            />
          ))}
        </View>

        <View style={{
          flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: spacing.sm,
          paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.md,
        }}>
          <Pressable onPress={onCancel} hitSlop={10}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', flex: 1, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {t('cameraTitle')}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: spacing.md }}>
          <View style={{
            flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: 6,
            backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 14,
          }}>
            <Ionicons name="scan-outline" size={15} color={theme.accent} />
            <Text style={{ color: '#fff', fontSize: 12.5, fontWeight: '600' }}>{t('cameraHint')}</Text>
          </View>
        </View>

        <View style={{ flex: 1 }} />

        {/* Fixed-height regardless of content, even with zero shots — the
            controls row below sits under a flex:1 spacer, so if this only
            rendered once a photo existed, that first capture would shove
            the whole bottom cluster (shutter included) upward as it
            popped in, instead of the button staying put. */}
        <View style={{ height: 54, marginBottom: spacing.sm }}>
        {shots.length > 0 && retakeIndex === null && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: spacing.sm, paddingHorizontal: spacing.md }}
          >
            {shots.map((shot) => (
              <Image key={shot.uri} source={{ uri: shot.uri }} style={{ width: 40, height: 54, borderRadius: 6 }} />
            ))}
            <Text style={{ color: '#fff', fontSize: 12, opacity: 0.75, alignSelf: 'center' }}>
              {t('shotCount', { count: shots.length })}
            </Text>
          </ScrollView>
        )}
        </View>

        <View style={{
          flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: spacing.lg, paddingBottom: spacing.xl,
        }}>
          <Pressable
            onPress={pickFromGallery}
            disabled={capturing || (retakeIndex === null && shots.length >= MAX_PAGES)}
            accessibilityLabel={t('cameraGallery')}
            style={{
              width: 52, height: 52, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.16)',
              alignItems: 'center', justifyContent: 'center',
              opacity: retakeIndex === null && shots.length >= MAX_PAGES ? 0.4 : 1,
            }}
          >
            <Ionicons name="images-outline" size={24} color="#fff" />
          </Pressable>

          <Pressable
            onPress={shoot}
            disabled={capturing || (retakeIndex === null && shots.length >= MAX_PAGES)}
            accessibilityLabel={t('cameraShutter')}
            style={{
              width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)',
              padding: 4, opacity: capturing || (retakeIndex === null && shots.length >= MAX_PAGES) ? 0.5 : 1,
            }}
          >
            <View style={{ flex: 1, borderRadius: 33, backgroundColor: '#fff' }} />
          </Pressable>

          {shots.length > 0 && retakeIndex === null ? (
            <Button size="md" onPress={() => setStep('review')} style={{ alignSelf: 'center' }}>{t('cameraDone')}</Button>
          ) : (
            <View style={{ width: 52 }} />
          )}
        </View>
      </CameraView>
    </View>
  );
}
