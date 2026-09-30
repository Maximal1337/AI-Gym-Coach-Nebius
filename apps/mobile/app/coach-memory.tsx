import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { deleteFact, fetchFacts } from '../src/lib/assistant';
import { factCategoryKey, sortFacts, type FactRow } from '../src/lib/assistantLogic';
import { useLanguage } from '../src/lib/language';
import { track } from '../src/lib/analytics';
import { Screen } from '../src/components/Screen';
import { IconButton } from '../src/components/IconButton';
import { useTheme, spacing, radius, typography, TAB_BAR_CLEARANCE } from '../src/theme';

/**
 * "What the coach remembers" (NH-71): the facts the nightly memory job keeps
 * (NH-63, at most 15), each with its category. Deleting one is a real
 * delete (RLS allows only the user's own rows); the relay sends the current
 * facts with every turn, so the next reply no longer gets it. Reached from the
 * assistant chat's header.
 */
export default function CoachMemory() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const [facts, setFacts] = useState<FactRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setFacts(sortFacts(await fetchFacts()));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function pullToRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function confirmForget(fact: FactRow) {
    Alert.alert(t('memoryForgetTitle'), t('memoryForgetBody'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('memoryForget'), style: 'destructive', onPress: () => void forget(fact) },
    ]);
  }

  // Optimistic, like the settings rows: gone at once, back with an alert on a
  // rare failure.
  async function forget(fact: FactRow) {
    track('memory_fact_deleted', { category: fact.doc.category });
    setFacts((f) => f?.filter((x) => x.id !== fact.id) ?? f);
    try {
      await deleteFact(fact.id);
    } catch {
      setFacts((f) => (f ? sortFacts([...f, fact]) : [fact]));
      Alert.alert(t('memoryDeleteFailed'));
    }
  }

  const textAlign = (dir === 'rtl' ? 'right' : 'left') as 'right' | 'left';
  const rowDir = dir === 'rtl' ? 'row-reverse' : 'row';

  const header = (
    <View style={{ marginBottom: spacing.md }}>
      {/* headerShown is false app-wide — same visible back chevron as settings.tsx. */}
      <Pressable
        onPress={() => { track('memory_back_tapped'); router.back(); }}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={t('back')}
        style={{ alignSelf: dir === 'rtl' ? 'flex-end' : 'flex-start', marginBottom: spacing.sm }}
      >
        <Ionicons name={dir === 'rtl' ? 'chevron-forward' : 'chevron-back'} size={24} color={theme.inkSoft} />
      </Pressable>
      <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign, marginBottom: 6 }}>{t('memoryTitle')}</Text>
      <Text style={{ color: theme.inkSoft, fontSize: 14, lineHeight: 20, textAlign }}>{t('memorySubtitle')}</Text>
    </View>
  );

  function renderFact({ item }: { item: FactRow }) {
    const temporary = item.doc.stability === 'temporary';
    return (
      <View style={{
        flexDirection: rowDir, alignItems: 'center', gap: spacing.sm,
        backgroundColor: theme.surface, borderRadius: radius.card, padding: spacing.md,
      }}>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text style={{ color: theme.accent, fontSize: typography.meta.size, fontWeight: '700' }}>
              {t(factCategoryKey(item.doc.category))}
            </Text>
            {item.pinned && (
              <Text style={{ color: theme.inkSoft, fontSize: typography.meta.size }}>· {t('memoryPinned')}</Text>
            )}
            {temporary && (
              <Text style={{ color: theme.inkSoft, fontSize: typography.meta.size }}>· {t('memoryTemporary')}</Text>
            )}
          </View>
          <Text style={{ color: theme.ink, fontSize: 15, lineHeight: 21, textAlign }}>{item.doc.text}</Text>
        </View>
        <IconButton name="trash-outline" label={t('memoryForget')} onPress={() => confirmForget(item)} />
      </View>
    );
  }

  return (
    <Screen>
      {facts === null && !loadFailed ? (
        <View style={{ padding: spacing.md }}>
          {header}
          <ActivityIndicator style={{ marginTop: spacing.xl }} color={theme.inkSoft} />
        </View>
      ) : (
        <FlatList
          data={facts ?? []}
          keyExtractor={(f) => f.id}
          renderItem={renderFact}
          ListHeaderComponent={header}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: TAB_BAR_CLEARANCE }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} tintColor={theme.inkSoft} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.md, gap: spacing.sm }}>
              <Ionicons name="bulb-outline" size={28} color={theme.accent} />
              <Text style={{ color: theme.inkSoft, fontSize: 15, lineHeight: 22, textAlign: 'center' }}>
                {loadFailed ? t('memoryLoadFailed') : t('memoryEmpty')}
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}
