import { Platform } from 'react-native';
import Purchases, { type CustomerInfo, type PurchasesOffering, type PurchasesPackage } from 'react-native-purchases';
import { supabase } from './supabase';

// Entitlement identifier configured in the RevenueCat dashboard
// (Entitlements > "premium"), attached to both the monthly and annual
// products. See the "Connecting to RevenueCat" setup notes for the exact
// dashboard steps this pairs with.
const ENTITLEMENT_ID = 'premium';
const REVENUECAT_API_KEY_IOS = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS;

/** True once a real RevenueCat project key is set — lets subscribe.tsx fall back to a "not live yet" state until then, same as before this was wired up. */
export const purchasesConfigured = !!REVENUECAT_API_KEY_IOS;

/**
 * Call once per app launch after the Supabase session resolves (see
 * app/index.tsx, alongside registerPush) — same fire-and-forget,
 * idempotent-on-repeat-launch shape. appUserID is the Supabase user id so
 * revenuecat-webhook's app_user_id lines up with public.users.id directly.
 */
export function initPurchases(userId: string): void {
  if (!purchasesConfigured || Platform.OS !== 'ios') return;
  try {
    Purchases.configure({ apiKey: REVENUECAT_API_KEY_IOS!, appUserID: userId });
  } catch {
    // Never block app startup on a purchases SDK hiccup.
  }
}

export function isEntitled(info: CustomerInfo): boolean {
  return info.entitlements.active[ENTITLEMENT_ID] !== undefined;
}

export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  const offerings = await Purchases.getOfferings();
  return offerings.current;
}

export async function purchase(pkg: PurchasesPackage): Promise<boolean> {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return isEntitled(customerInfo);
}

export async function restore(): Promise<boolean> {
  const customerInfo = await Purchases.restorePurchases();
  return isEntitled(customerInfo);
}

export type AccessStatus = {
  status: 'trialing' | 'active' | 'canceled' | 'expired';
  entitled: boolean;
  trialEndsAt: string | null;
  subscriptionExpiresAt: string | null;
  /** 0 once the trial has ended, never negative. */
  daysLeftInTrial: number;
};

/**
 * Client-side read of the same entitlement logic session-start/
 * plan-generate/studio-session enforce server-side (subscriptionAccess()
 * in supabase/functions/_shared/mod.ts) — used for proactive UI (trial
 * countdown banner, settings status row), never as the real gate. The
 * server check is always the one that actually blocks a coached session;
 * this can lag it by as much as a webhook round-trip.
 */
export async function fetchAccessStatus(): Promise<AccessStatus> {
  const { data } = await supabase
    .from('users')
    .select('subscription_status, trial_ends_at, subscription_expires_at')
    .maybeSingle();

  const status = (data?.subscription_status ?? 'trialing') as AccessStatus['status'];
  const trialEndsAt = data?.trial_ends_at ?? null;
  const subscriptionExpiresAt = data?.subscription_expires_at ?? null;

  const now = Date.now();
  const trialActive = !!trialEndsAt && new Date(trialEndsAt).getTime() > now;
  const paidActive = (status === 'active' || status === 'canceled') &&
    (!subscriptionExpiresAt || new Date(subscriptionExpiresAt).getTime() > now);
  const daysLeftInTrial = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - now) / 86_400_000))
    : 0;

  return { status, entitled: trialActive || paidActive, trialEndsAt, subscriptionExpiresAt, daysLeftInTrial };
}
