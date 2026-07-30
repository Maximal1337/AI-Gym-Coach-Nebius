import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../src/lib/supabase';
import { callFn } from '../src/lib/api';
import { Screen } from '../src/components/Screen';
import { useTheme, spacing, radius } from '../src/theme';

interface Plan { id: string; name: string }

export default function ManagePlans() {
  const theme = useTheme();
  const { t } = useTranslation();
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.md }}>
        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', textAlign: 'right', marginBottom: spacing.md }}>
          {t('managePlansTitle')}
        </Text>

        {plans.length === 0 && (
          <Text style={{ color: theme.inkSoft, textAlign: 'right', marginBottom: spacing.md }}>
            {t('noActivePlans')}
          </Text>
        )}

        {plans.map((p) => (
          <View key={p.id} style={{
            backgroundColor: theme.surface, borderRadius: radius.card,
            padding: spacing.md, marginBottom: spacing.sm,
          }}>
            <Text style={{ color: theme.ink, fontWeight: '700', textAlign: 'right', marginBottom: spacing.sm }}>
              {p.name}
            </Text>
            <View style={{ flexDirection: 'row-reverse', gap: spacing.sm }}>
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
      </ScrollView>
    </Screen>
  );
}
