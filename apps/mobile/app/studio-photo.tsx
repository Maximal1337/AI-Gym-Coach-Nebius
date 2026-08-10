import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../src/lib/api';
import { existingOpenSessionId, openStudioSession } from '../src/lib/studioApi';
import { useLanguage } from '../src/lib/language';
import { useTheme, spacing, radius } from '../src/theme';
import { Button } from '../src/components/Button';
import { Screen } from '../src/components/Screen';
import { SketchLoader } from '../src/components/SketchLoader';

const MAX_SHOTS = 3; // a wide whiteboard can need more than one frame
const RESIZE_WIDTH = 1600;
const JPEG_QUALITY = 0.5;

interface Shot { uri: string; base64: string }

async function compressPhoto(uri: string): Promise<Shot> {
  const image = await ImageManipulator.manipulate(uri).resize({ width: RESIZE_WIDTH }).renderAsync();
  const result = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });
  return { uri: result.uri, base64: result.base64! };
}

type Step = 'camera' | 'review' | 'parsing';

/**
 * Photograph a studio whiteboard — the primary "add a workout" method
 * (guidelines/studio-workout-entry.html). Same camera/review shape as the
 * gym plan's PhotographPlanFlow (frame guide, retake, gallery picker), but
 * converges on studio-session's `open` rather than a PlanPreview: there's
 * no separate parse-review step here — the session screen itself IS the
 * review, live from the moment the board is read.
 */
export default function StudioPhotoScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [step, setStep] = useState<Step>('camera');
  const [shots, setShots] = useState<Shot[]>([]);
  const [retakeIndex, setRetakeIndex] = useState<number | null>(null);
  const [previewShotIndex, setPreviewShotIndex] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!permission) return;
    if (!permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission]);

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
      mediaTypes: ['images'], quality: 0.7,
      allowsMultipleSelection: !isRetake,
      selectionLimit: isRetake ? 1 : Math.max(1, MAX_SHOTS - shots.length),
    });
    if (result.canceled || result.assets.length === 0) return;
    setCapturing(true);
    try {
      const compressed = await Promise.all(result.assets.map((a) => compressPhoto(a.uri)));
      if (isRetake) addOrReplaceShot(compressed[0]);
      else setShots((prev) => [...prev, ...compressed].slice(0, MAX_SHOTS));
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
    try {
      const res = await openStudioSession({ source: { imagesBase64: shots.map((s) => s.base64) } });
      router.replace({ pathname: '/studio-session', params: { sessionId: res.sessionId } });
    } catch (e) {
      const existing = await existingOpenSessionId(e);
      if (existing) { router.replace({ pathname: '/studio-session', params: { sessionId: existing } }); return; }
      if (e instanceof ApiError && e.code === 'subscription_required') {
        Alert.alert(t('trialExpired'));
        router.push('/subscribe');
      } else {
        Alert.alert(t('photoParseFailed'));
      }
      setStep('review');
    }
  }

  if (step === 'parsing') {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <SketchLoader label={t('parsing')} dir={dir} />
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
            <Text style={{ flex: 1, color: theme.ink, fontSize: 18, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left' }}>
              {t('reviewTitle')}
            </Text>
          </View>

          <ScrollView style={{ flex: 1, paddingHorizontal: spacing.lg }}>
            <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
              {shots.map((shot, i) => (
                <Pressable
                  key={shot.uri} onPress={() => setPreviewShotIndex(i)}
                  style={{ width: 100, height: 134, borderRadius: radius.field, overflow: 'hidden' }}
                >
                  <Image source={{ uri: shot.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  <Pressable
                    onPress={() => retake(i)} hitSlop={6} accessibilityLabel={t('shotRetake')}
                    style={{
                      position: 'absolute', top: 4, insetInlineEnd: 4, width: 24, height: 24, borderRadius: 12,
                      backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="refresh" size={13} color="#fff" />
                  </Pressable>
                </Pressable>
              ))}
              {shots.length < MAX_SHOTS && (
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
          </ScrollView>

          <View style={{ padding: spacing.lg, gap: spacing.sm }}>
            <Button block disabled={shots.length === 0} onPress={parse}>{t('parsePlan')}</Button>
          </View>
        </View>

        <Modal visible={previewShotIndex !== null} animationType="fade" transparent onRequestClose={() => setPreviewShotIndex(null)}>
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }}
            onPress={() => setPreviewShotIndex(null)}
          >
            {previewShotIndex !== null && (
              <Image source={{ uri: shots[previewShotIndex].uri }} style={{ width: '92%', height: '80%' }} resizeMode="contain" />
            )}
            <View style={{ position: 'absolute', top: insets.top + spacing.sm, insetInlineEnd: spacing.md }}>
              <Pressable onPress={() => setPreviewShotIndex(null)} hitSlop={10} accessibilityLabel={t('close')}>
                <Ionicons name="close" size={28} color="#fff" />
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      </Screen>
    );
  }

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
          <Pressable onPress={() => router.back()}><Text style={{ color: theme.inkSoft, fontWeight: '600' }}>{t('cancel')}</Text></Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back">
        <View pointerEvents="none" style={{ position: 'absolute', left: 32, right: 32, top: 140, bottom: 200 }}>
          {([['left', 'top'], ['right', 'top'], ['left', 'bottom'], ['right', 'bottom']] as const).map(([x, y]) => (
            <View
              key={`${x}-${y}`}
              style={{
                position: 'absolute', width: 26, height: 26, [x]: 0, [y]: 0,
                borderTopWidth: y === 'top' ? 3 : 0, borderBottomWidth: y === 'bottom' ? 3 : 0,
                borderLeftWidth: x === 'left' ? 3 : 0, borderRightWidth: x === 'right' ? 3 : 0,
                borderColor: theme.accent,
              }}
            />
          ))}
        </View>

        <View style={{
          flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: spacing.sm,
          paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.md,
        }}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', flex: 1, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {t('photographBoard')}
          </Text>
        </View>

        <View style={{ flex: 1 }} />

        <View style={{ height: 54, marginBottom: spacing.sm }}>
          {shots.length > 0 && retakeIndex === null && (
            <ScrollView
              horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: spacing.sm, paddingHorizontal: spacing.md }}
            >
              {shots.map((shot) => (
                <Image key={shot.uri} source={{ uri: shot.uri }} style={{ width: 40, height: 54, borderRadius: 6 }} />
              ))}
            </ScrollView>
          )}
        </View>

        <View style={{
          flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: spacing.lg, paddingBottom: spacing.xl,
        }}>
          <Pressable
            onPress={pickFromGallery}
            disabled={capturing || (retakeIndex === null && shots.length >= MAX_SHOTS)}
            accessibilityLabel={t('cameraGallery')}
            style={{
              width: 52, height: 52, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.16)',
              alignItems: 'center', justifyContent: 'center',
              opacity: retakeIndex === null && shots.length >= MAX_SHOTS ? 0.4 : 1,
            }}
          >
            <Ionicons name="images-outline" size={24} color="#fff" />
          </Pressable>

          <Pressable
            onPress={shoot}
            disabled={capturing || (retakeIndex === null && shots.length >= MAX_SHOTS)}
            accessibilityLabel={t('cameraShutter')}
            style={{
              width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)',
              padding: 4, opacity: capturing || (retakeIndex === null && shots.length >= MAX_SHOTS) ? 0.5 : 1,
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
