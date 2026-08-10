import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import type { PurchasesPackage } from 'react-native-purchases';
import { Screen } from '../src/components/Screen';
import { useLanguage, type Direction } from '../src/lib/language';
import { fetchAccessStatus, getCurrentOffering, purchase, purchasesConfigured, restore } from '../src/lib/subscription';
import { useTheme, spacing, radius } from '../src/theme';

/**
 * Fallback display prices — used until a real RevenueCat offering loads
 * (purchasesConfigured is false, we're offline, or Apple/RevenueCat
 * hasn't returned yet). Match the recommendation in the "Subscription
 * Pricing & Monetization Strategy" Linear doc: annual priced at ~50% of
 * (12 × monthly), matching the Fitbod/Freeletics/Runna/MacroFactor
 * comparable set. Once an offering loads, its packages' own
 * product.priceString (real, localized StoreKit prices) is used instead.
 */
const MONTHLY_PRICE = '$9.99';
const ANNUAL_PRICE = '$59.99';
const ANNUAL_MONTHLY_EQUIVALENT = '$5.00';
const ANNUAL_SAVINGS_PCT = 50;

type PlanId = 'monthly' | 'annual';
type Theme = ReturnType<typeof useTheme>;

export default function Subscribe() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const [plan, setPlan] = useState<PlanId>('annual');
  const [daysLeftInTrial, setDaysLeftInTrial] = useState(0);
  const [trialActive, setTrialActive] = useState(true);
  const [monthlyPkg, setMonthlyPkg] = useState<PurchasesPackage | null>(null);
  const [annualPkg, setAnnualPkg] = useState<PurchasesPackage | null>(null);
  const [purchasing, setPurchasing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      fetchAccessStatus().then((s) => {
        setDaysLeftInTrial(s.daysLeftInTrial);
        setTrialActive(s.status === 'trialing' && s.entitled);
      });
      if (purchasesConfigured) {
        getCurrentOffering().then((offering) => {
          setMonthlyPkg(offering?.availablePackages.find((p) => p.packageType === 'MONTHLY') ?? null);
          setAnnualPkg(offering?.availablePackages.find((p) => p.packageType === 'ANNUAL') ?? null);
        }).catch(() => {});
      }
    }, []),
  );

  const row = dir === 'rtl' ? 'row-reverse' : 'row';
  const align = dir === 'rtl' ? 'right' : 'left';

  async function handleContinue() {
    const pkg = plan === 'annual' ? annualPkg : monthlyPkg;
    if (!purchasesConfigured || !pkg) {
      Alert.alert(t('subscribeComingSoonTitle'), t('subscribeComingSoonBody'));
      return;
    }
    setPurchasing(true);
    try {
      const entitled = await purchase(pkg);
      if (entitled) router.back();
    } catch (e) {
      if (!(e as { userCancelled?: boolean })?.userCancelled) {
        Alert.alert(t('coachUnavailable'));
      }
    } finally {
      setPurchasing(false);
    }
  }

  async function handleRestore() {
    if (!purchasesConfigured) {
      Alert.alert(t('subscribeComingSoonTitle'), t('subscribeComingSoonBody'));
      return;
    }
    setPurchasing(true);
    try {
      const entitled = await restore();
      if (entitled) router.back();
      else Alert.alert(t('restorePurchases'), t('restoreNoneFound'));
    } catch {
      Alert.alert(t('coachUnavailable'));
    } finally {
      setPurchasing(false);
    }
  }

  const monthlyPrice = monthlyPkg?.product.priceString ?? MONTHLY_PRICE;
  const annualPrice = annualPkg?.product.priceString ?? ANNUAL_PRICE;

  const features: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
    { icon: 'infinite-outline', label: t('featureUnlimited') },
    { icon: 'sparkles-outline', label: t('featureAiPlans') },
    { icon: 'time-outline', label: t('featureMemory') },
    { icon: 'globe-outline', label: t('featureLanguages') },
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}>
        <View style={{ flexDirection: row, justifyContent: 'flex-end', marginBottom: spacing.xs }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="close" size={26} color={theme.inkSoft} />
          </Pressable>
        </View>

        <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
          <View
            style={{
              width: 64, height: 64, borderRadius: 20, backgroundColor: theme.accent,
              alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
            }}
          >
            <Ionicons name="barbell" size={30} color={theme.onAccent} />
          </View>
          <Text style={{ color: theme.ink, fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: spacing.xs }}>
            {t('subscribeTitle')}
          </Text>
          <Text style={{ color: theme.inkSoft, fontSize: 14.5, textAlign: 'center', lineHeight: 21, maxWidth: 320 }}>
            {t('subscribeSub')}
          </Text>
        </View>

        <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, padding: spacing.md, marginBottom: spacing.lg }}>
          {features.map((f, i) => (
            <View
              key={f.icon}
              style={{
                flexDirection: row, alignItems: 'center', gap: spacing.sm,
                marginBottom: i === features.length - 1 ? 0 : spacing.sm,
              }}
            >
              <View
                style={{
                  width: 28, height: 28, borderRadius: 14, backgroundColor: theme.bg,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Ionicons name={f.icon} size={16} color={theme.accent} />
              </View>
              <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '600', flex: 1, textAlign: align }}>
                {f.label}
              </Text>
            </View>
          ))}
        </View>

        {trialActive && (
          <View style={{ marginBottom: spacing.lg }}>
            <Text style={{ color: theme.inkSoft, fontSize: 12.5, fontWeight: '600', textAlign: align }}>
              {daysLeftInTrial > 0
                ? t('trialDaysRemaining', { count: daysLeftInTrial })
                : t('trialEndsToday')}
            </Text>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.rule, overflow: 'hidden', marginTop: 6 }}>
              <View
                style={{
                  width: `${Math.max((daysLeftInTrial / 30) * 100, 4)}%`, height: '100%',
                  backgroundColor: theme.accent, borderRadius: 2,
                }}
              />
            </View>
          </View>
        )}

        <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
          <PlanCard
            theme={theme}
            dir={dir}
            selected={plan === 'annual'}
            onPress={() => setPlan('annual')}
            title={t('planAnnual')}
            price={annualPrice}
            sub={t('planAnnualSub', { monthly: ANNUAL_MONTHLY_EQUIVALENT })}
            badge={t('planBestValue', { pct: ANNUAL_SAVINGS_PCT })}
          />
          <PlanCard
            theme={theme}
            dir={dir}
            selected={plan === 'monthly'}
            onPress={() => setPlan('monthly')}
            title={t('planMonthly')}
            price={monthlyPrice}
            sub={t('planMonthlySub')}
          />
        </View>

        <Pressable
          onPress={handleContinue}
          disabled={purchasing}
          style={{
            backgroundColor: theme.accent, paddingVertical: 16, borderRadius: radius.pill,
            alignItems: 'center', opacity: purchasing ? 0.7 : 1,
          }}
        >
          {purchasing ? (
            <ActivityIndicator color={theme.onAccent} />
          ) : (
            <Text style={{ color: theme.onAccent, fontSize: 16, fontWeight: '800' }}>
              {plan === 'annual'
                ? t('continueWithPrice', { price: `${annualPrice}/${t('yr')}` })
                : t('continueWithPrice', { price: `${monthlyPrice}/${t('mo')}` })}
            </Text>
          )}
        </Pressable>

        <Pressable onPress={handleRestore} disabled={purchasing} style={{ alignItems: 'center', marginTop: spacing.md }}>
          <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '700' }}>{t('restorePurchases')}</Text>
        </Pressable>

        <Text style={{ color: theme.inkSoft, fontSize: 11, textAlign: 'center', lineHeight: 16, marginTop: spacing.md }}>
          {t('subscribeLegal')}
        </Text>
      </ScrollView>
    </Screen>
  );
}

function PlanCard({ theme, dir, selected, onPress, title, price, sub, badge }: {
  theme: Theme; dir: Direction; selected: boolean; onPress: () => void;
  title: string; price: string; sub: string; badge?: string;
}) {
  const row = dir === 'rtl' ? 'row-reverse' : 'row';
  const align = dir === 'rtl' ? 'right' : 'left';
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderWidth: 1.5, borderColor: selected ? theme.accent : theme.rule,
        backgroundColor: theme.surface, borderRadius: radius.card, padding: spacing.md,
      }}
    >
      <View style={{ flexDirection: row, alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm }}>
          <View
            style={{
              width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
              borderWidth: 1.5, borderColor: selected ? theme.accent : theme.inkSoft,
              backgroundColor: selected ? theme.accent : 'transparent',
            }}
          >
            {selected && <Text style={{ color: theme.onAccent, fontSize: 11, fontWeight: '900' }}>✓</Text>}
          </View>
          <View>
            <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '800', textAlign: align }}>{title}</Text>
            <Text style={{ color: theme.inkSoft, fontSize: 12, textAlign: align, marginTop: 1 }}>{sub}</Text>
          </View>
        </View>
        <Text style={{ color: theme.ink, fontSize: 17, fontWeight: '800' }}>{price}</Text>
      </View>
      {badge && (
        <View
          style={{
            alignSelf: dir === 'rtl' ? 'flex-end' : 'flex-start', marginTop: spacing.sm,
            backgroundColor: theme.accent, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3,
          }}
        >
          <Text style={{ color: theme.onAccent, fontSize: 10.5, fontWeight: '800' }}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}
