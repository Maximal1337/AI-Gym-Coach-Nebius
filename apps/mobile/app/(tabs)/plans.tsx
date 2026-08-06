import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/lib/supabase';
import { callFn } from '../../src/lib/api';
import { Screen } from '../../src/components/Screen';
import { LoadingOverlay } from '../../src/components/LoadingOverlay';
import { Button } from '../../src/components/Button';
import { IconButton } from '../../src/components/IconButton';
import { BottomSheet } from '../../src/components/BottomSheet';
import { ChoiceCard } from '../../src/components/ChoiceCard';
import { Badge } from '../../src/components/Badge';
import { useLanguage } from '../../src/lib/language';
import { useTheme, spacing, radius, TAB_BAR_CLEARANCE } from '../../src/theme';

interface Plan { id: string; name: string }

/** A single row inside the plan-actions sheet (guidelines/plan-actions.html's ActionRow). */
function ActionRow({
  icon, label, sub, warn, disabled, onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  warn?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { dir } = useLanguage();
  const fg = warn ? theme.warning : theme.ink;
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: spacing.md,
        paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.rule, opacity: disabled ? 0.5 : 1,
      }}
    >
      <Ionicons name={icon} size={19} color={warn ? fg : theme.accent} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: fg, fontSize: 15, fontWeight: '600', textAlign: dir === 'rtl' ? 'right' : 'left' }}>
          {label}
        </Text>
        {sub && (
          <Text style={{ color: theme.inkSoft, fontSize: 12, marginTop: 2, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
            {sub}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

/**
 * "One way in" (guidelines/plan-actions.html): the card itself is the
 * action — tap it to open the plan — everything else lives behind one
 * `⋯`, and adding a plan is one button that opens a sheet with all four
 * routes, instead of four permanent choice cards sitting under the list.
 */
export default function ManagePlans() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState('');
  const [actionsFor, setActionsFor] = useState<Plan | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(() => {
    supabase.from('training_plans').select('id, name').eq('status', 'active')
      .then(({ data }) => setPlans((data ?? []) as Plan[]));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openPlan(plan: Plan) {
    setActionsFor(null);
    router.push({ pathname: '/plan-edit', params: { mode: 'edit', planId: plan.id, planName: plan.name } });
  }

  async function archive(plan: Plan) {
    setActionsFor(null);
    setBusyLabel(t('archiving'));
    setBusyId(plan.id);
    try {
      await callFn('plan-import', { action: 'archive', planId: plan.id });
      load();
    } catch {
      Alert.alert(t('coachUnavailable'));
    } finally {
      setBusyId(null);
    }
  }

  function openAddRoute(to: () => void) {
    setAddOpen(false);
    to();
  }

  return (
    <Screen>
      <LoadingOverlay visible={busyId !== null} object="plate" label={busyLabel} />
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
          <Pressable
            key={p.id}
            onPress={() => openPlan(p)}
            disabled={busyId === p.id}
            style={{
              flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: spacing.sm,
              backgroundColor: theme.surface, borderRadius: radius.card,
              paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm,
              opacity: busyId === p.id ? 0.5 : 1,
            }}
          >
            <Text
              style={{ flex: 1, color: theme.ink, fontWeight: '700', fontSize: 15, textAlign: dir === 'rtl' ? 'right' : 'left' }}
              numberOfLines={1}
            >
              {p.name}
            </Text>
            <IconButton
              name="ellipsis-horizontal"
              label={t('planActions')}
              onPress={() => setActionsFor(p)}
            />
          </Pressable>
        ))}

        <Button
          variant="primary" size="md" block
          icon={<Ionicons name="add" size={16} color={theme.onAccent} />}
          onPress={() => setAddOpen(true)}
          style={{ marginTop: spacing.xs }}
        >
          {t('addPlanTitle')}
        </Button>
      </ScrollView>

      <BottomSheet visible={actionsFor !== null} title={actionsFor?.name ?? ''} onClose={() => setActionsFor(null)}>
        <ActionRow icon="create-outline" label={t('editPlan')} onPress={() => actionsFor && openPlan(actionsFor)} />
        <ActionRow
          icon="archive-outline" warn
          label={t('archivePlan')}
          sub={t('archiveConfirmBody')}
          onPress={() => actionsFor && archive(actionsFor)}
        />
      </BottomSheet>

      <BottomSheet visible={addOpen} title={t('addPlanTitle')} onClose={() => setAddOpen(false)}>
        <View style={{ gap: spacing.sm }}>
          <ChoiceCard
            emphasis="primary"
            icon="sparkles"
            label={t('generatePlanCta')}
            description={t('goalSub')}
            badge={<Badge>AI</Badge>}
            onPress={() => openAddRoute(() => router.push({ pathname: '/plan-generate', params: { mode: 'add' } }))}
          />
          <ChoiceCard
            icon="clipboard-outline"
            label={t('choosePaste')}
            onPress={() => openAddRoute(() => router.push({ pathname: '/plan-edit', params: { mode: 'add' } }))}
          />
          <ChoiceCard
            icon="document-attach-outline"
            label={t('chooseUpload')}
            onPress={() => openAddRoute(() => router.push({ pathname: '/plan-edit', params: { mode: 'add', initialMode: 'upload' } }))}
          />
          <ChoiceCard
            icon="construct-outline"
            label={t('buildOwnPlan')}
            onPress={() => openAddRoute(() => router.push('/plan-build'))}
          />
        </View>
        <Text style={{ color: theme.inkSoft, fontSize: 10.5, lineHeight: 15, textAlign: dir === 'rtl' ? 'right' : 'left', marginTop: spacing.sm }}>
          {t('generatePlanCaption')}
        </Text>
      </BottomSheet>
    </Screen>
  );
}
