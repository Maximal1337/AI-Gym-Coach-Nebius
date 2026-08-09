import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/Screen';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { AddWorkoutSheet } from '../../src/components/AddWorkoutSheet';
import { StudioWorkoutCard } from '../../src/components/StudioWorkoutCard';
import { LoadingOverlay } from '../../src/components/LoadingOverlay';
import { listStudioSessions, openStudioSession, type StudioSessionListSummary } from '../../src/lib/studioApi';
import { useLanguage } from '../../src/lib/language';
import { useTheme, spacing, TAB_BAR_CLEARANCE } from '../../src/theme';

/**
 * The Studio tab (guidelines/studio-workout-entry.html) — the only entry
 * point for a studio workout, per the product decision to make Studio a
 * dedicated tab rather than a merged auto-classifying "Add a workout" flow.
 *
 * Two states, never both: an open (unsaved) session dominates the screen
 * until it's closed (saved or discarded elsewhere, on the session screen
 * itself) — starting a new workout is simply not reachable from here while
 * one exists, which is the DB's own one-open-session-per-user rule made
 * visible rather than a dialog explaining it.
 */
export default function StudioTab() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);
  const [recent, setRecent] = useState<StudioSessionListSummary[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    listStudioSessions()
      .then((res) => { setOpen(res.open); setRecent(res.recent); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function navigateAfterSheetCloses(to: () => void) {
    setTimeout(to, 300);
  }

  function openSession(sessionId: string) {
    router.push({ pathname: '/studio-session', params: { sessionId } });
  }

  function openAddRoute(to: () => void) {
    setAddOpen(false);
    navigateAfterSheetCloses(to);
  }

  async function buildOwn() {
    setBusy(true);
    try {
      const res = await openStudioSession({ blank: true });
      setAddOpen(false);
      navigateAfterSheetCloses(() => openSession(res.sessionId));
    } catch {
      Alert.alert(t('coachUnavailable'));
    } finally {
      setBusy(false);
    }
  }

  async function doOneAgain(workout: StudioSessionListSummary) {
    setBusy(true);
    try {
      const res = await openStudioSession({ sourceSessionId: workout.id });
      openSession(res.sessionId);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'session_already_open') load();
      else Alert.alert(t('coachUnavailable'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <LoadingOverlay visible={busy} object="plate" label={t('parsing')} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.md, paddingBottom: TAB_BAR_CLEARANCE }}>
        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.md }}>
          {t('studioTab')}
        </Text>

        {loading ? (
          <ActivityIndicator color={theme.accent} style={{ marginTop: spacing.xl }} />
        ) : open ? (
          <Pressable onPress={() => openSession(open.id)}>
            <Card>
              <Text style={{ color: theme.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', textAlign: dir === 'rtl' ? 'right' : 'left' }}>
                {t('continuingLabel')}
              </Text>
              <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 }}>
                <Text style={{ flex: 1, color: theme.ink, fontSize: 18, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left' }} numberOfLines={1}>
                  {open.name}
                </Text>
                <Ionicons name={dir === 'rtl' ? 'chevron-back' : 'chevron-forward'} size={18} color={theme.inkSoft} />
              </View>
              <Text style={{ color: theme.inkSoft, fontSize: 12.5, marginTop: 6, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
                {t('openSessionHint')}
              </Text>
            </Card>
          </Pressable>
        ) : (
          <>
            <Button
              variant="primary" size="md" block
              icon={<Ionicons name="add" size={16} color={theme.onAccent} />}
              onPress={() => setAddOpen(true)}
              style={{ marginBottom: spacing.lg }}
            >
              {t('addNewWorkout')}
            </Button>

            {recent.length > 0 && (
              <>
                <Text style={{ color: theme.inkSoft, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: spacing.sm, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
                  {t('orDoOneAgain')}
                </Text>
                <View style={{ gap: spacing.sm }}>
                  {recent.map((w) => (
                    <StudioWorkoutCard key={w.id} workout={w} onPress={() => doOneAgain(w)} />
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      <AddWorkoutSheet
        visible={addOpen}
        title={t('addNewWorkout')}
        onClose={() => setAddOpen(false)}
        methods={[
          {
            icon: 'camera-outline', label: t('photographBoard'), description: t('photographBoardDesc'),
            emphasis: 'primary',
            onPress: () => openAddRoute(() => router.push('/studio-photo')),
          },
          {
            icon: 'clipboard-outline', label: t('pasteItIn'),
            onPress: () => openAddRoute(() => router.push('/studio-paste')),
          },
          {
            icon: 'document-attach-outline', label: t('uploadFile'),
            onPress: () => openAddRoute(() => router.push({ pathname: '/studio-paste', params: { initialMode: 'upload' } })),
          },
          {
            icon: 'construct-outline', label: t('buildItMyself'),
            onPress: () => void buildOwn(),
          },
        ]}
      />
    </Screen>
  );
}
