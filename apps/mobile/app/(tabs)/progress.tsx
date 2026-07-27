import { useCallback, useState } from 'react';
import { Alert, FlatList, Keyboard, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../src/lib/supabase';
import { callFn } from '../../src/lib/api';
import { DismissKeyboardView } from '../../src/components/DismissKeyboardView';
import { useTheme, spacing, radius } from '../../src/theme';

interface SessionRow {
  id: string; started_at: string; source: string;
  training_plans: { name: string } | null;
  set_logs: { id: string }[];
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
    }, []),
  );

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

      <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 14, textAlign: 'right', marginBottom: spacing.sm }}>
        {t('recentWorkouts')}
      </Text>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
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
