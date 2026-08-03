import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../src/lib/supabase';
import { callFn } from '../../src/lib/api';
import { Screen } from '../../src/components/Screen';
import { useLanguage } from '../../src/lib/language';
import { useTheme, spacing, radius, TAB_BAR_CLEARANCE } from '../../src/theme';

interface Plan { id: string; name: string }

export default function ManagePlans() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    supabase.from('training_plans').select('id, name').eq('status', 'active')
      .then(({ data }) => setPlans((data ?? []) as Plan[]));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function confirmArchive(plan: Plan) {
    Alert.alert(t('archiveConfirmTitle', { name: plan.name }), t('archiveConfirmBody', { name: plan.name }), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('archivePlan'),
        style: 'destructive',
        onPress: async () => {
          setBusyId(plan.id);
          try {
            await callFn('plan-import', { action: 'archive', planId: plan.id });
            load();
          } catch {
            Alert.alert(t('coachUnavailable'));
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.md, paddingBottom: TAB_BAR_CLEARANCE }}>
        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.md }}>
          {t('managePlansTitle')}
        </Text>

        {plans.length === 0 && (
          <Text style={{ color: theme.inkSoft, textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.md }}>
            {t('noActivePlans')}
          </Text>
        )}

        {plans.map((p) => (
          <View key={p.id} style={{
            backgroundColor: theme.surface, borderRadius: radius.card,
            padding: spacing.md, marginBottom: spacing.sm,
          }}>
            <Text style={{ color: theme.ink, fontWeight: '700', textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.sm }}>
              {p.name}
            </Text>
            <View style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', gap: spacing.sm }}>
              <Pressable
                disabled={busyId === p.id}
                onPress={() => router.push({ pathname: '/plan-edit', params: { mode: 'edit', planId: p.id, planName: p.name } })}
                style={{ backgroundColor: theme.accent, paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.pill }}
              >
                <Text style={{ color: theme.onAccent, fontWeight: '700', fontSize: 13 }}>{t('editPlan')}</Text>
              </Pressable>
              <Pressable
                disabled={busyId === p.id}
                onPress={() => confirmArchive(p)}
                style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.critical }}
              >
                <Text style={{ color: theme.critical, fontWeight: '700', fontSize: 13 }}>{t('archivePlan')}</Text>
              </Pressable>
            </View>
          </View>
        ))}

        <Pressable
          onPress={() => router.push({ pathname: '/plan-edit', params: { mode: 'add' } })}
          style={{
            borderWidth: 1, borderColor: theme.accent, borderStyle: 'dashed', borderRadius: radius.card,
            padding: spacing.md, alignItems: 'center', marginTop: spacing.sm,
          }}
        >
          <Text style={{ color: theme.accent, fontWeight: '700' }}>{t('addNewPlanType')}</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/plan-build')}
          style={{
            borderWidth: 1, borderColor: theme.rule, borderStyle: 'dashed', borderRadius: radius.card,
            padding: spacing.md, alignItems: 'center', marginTop: spacing.sm,
          }}
        >
          <Text style={{ color: theme.inkSoft, fontWeight: '700' }}>{t('buildOwnPlan')}</Text>
        </Pressable>

        {/* Pinned separately from the two above (System Design §21) — a
            distinct third option, not grouped with paste/manual. */}
        <Pressable
          onPress={() => router.push({ pathname: '/plan-generate', params: { mode: 'add' } })}
          style={{
            backgroundColor: theme.accent, borderRadius: radius.pill,
            padding: spacing.md, alignItems: 'center', marginTop: spacing.lg,
          }}
        >
          <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{t('generatePlanCta')}</Text>
        </Pressable>
        <Text style={{ color: theme.inkSoft, fontSize: 10.5, textAlign: 'center', marginTop: spacing.xs, lineHeight: 15 }}>
          {t('generatePlanCaption')}
        </Text>
      </ScrollView>
    </Screen>
  );
}
