import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../src/lib/supabase';
import { callFn } from '../../src/lib/api';
import { Screen } from '../../src/components/Screen';
import { LoadingOverlay } from '../../src/components/LoadingOverlay';
import { Button } from '../../src/components/Button';
import { SectionTitle } from '../../src/components/SectionTitle';
import { ChoiceCard } from '../../src/components/ChoiceCard';
import { Badge } from '../../src/components/Badge';
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
      <LoadingOverlay visible={busyId !== null} object="plate" label={t('archiving')} />
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
              <Button
                variant="secondary" size="md"
                disabled={busyId === p.id}
                onPress={() => router.push({ pathname: '/plan-edit', params: { mode: 'edit', planId: p.id, planName: p.name } })}
              >
                {t('editPlan')}
              </Button>
              <Button
                variant="destructive" size="md"
                disabled={busyId === p.id}
                onPress={() => confirmArchive(p)}
              >
                {t('archivePlan')}
              </Button>
            </View>
          </View>
        ))}

        {/* Matches the design system's own PlansScreen: the plan-creation
            choices are one ChoiceCard list under a single section title,
            not a separate CTA pill below a few dashed boxes — same four
            destinations the app already had, just unified per the source. */}
        <SectionTitle>{t('addNewPlanType')}</SectionTitle>
        <View style={{ gap: spacing.sm }}>
          <ChoiceCard
            emphasis="primary"
            icon="sparkles"
            label={t('generatePlanCta')}
            description={t('goalSub')}
            badge={<Badge>AI</Badge>}
            onPress={() => router.push({ pathname: '/plan-generate', params: { mode: 'add' } })}
          />
          <ChoiceCard
            icon="clipboard-outline"
            label={t('choosePaste')}
            onPress={() => router.push({ pathname: '/plan-edit', params: { mode: 'add' } })}
          />
          <ChoiceCard
            icon="document-attach-outline"
            label={t('chooseUpload')}
            onPress={() => router.push({ pathname: '/plan-edit', params: { mode: 'add', initialMode: 'upload' } })}
          />
          <ChoiceCard
            icon="construct-outline"
            label={t('buildOwnPlan')}
            onPress={() => router.push('/plan-build')}
          />
        </View>
        <Text style={{ color: theme.inkSoft, fontSize: 10.5, lineHeight: 15, textAlign: dir === 'rtl' ? 'right' : 'left', marginTop: spacing.sm }}>
          {t('generatePlanCaption')}
        </Text>
      </ScrollView>
    </Screen>
  );
}
