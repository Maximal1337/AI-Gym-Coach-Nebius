import { supabase } from './supabase';

// Same env-driven ceiling everywhere it's read (System Design §10 /
// Subscription Pricing & Monetization Strategy doc) — sized for ~6 free
// AI-coached workouts/month. This is only ever an approximation of the
// real per-user LLM cost; the actual gate is the server-side budget check
// in supabase/functions/_shared/mod.ts's budgetRemaining().
const BUDGET_CENTS = Number(process.env.EXPO_PUBLIC_MONTHLY_BUDGET_CENTS ?? '3.6');
const APPROX_CENTS_PER_WORKOUT = 0.6;

export interface UsageSnapshot {
  used: number;
  total: number;
  remaining: number;
  spentCents: number;
}

/** Reads this month's usage_ledger row and converts it to an approximate workout count. */
export async function fetchUsageSnapshot(): Promise<UsageSnapshot> {
  const period = new Date().toISOString().slice(0, 7);
  const { data } = await supabase.from('usage_ledger').select('cost_cents').eq('period', period).maybeSingle();
  const spentCents = Number(data?.cost_cents ?? 0);
  const total = Math.round(BUDGET_CENTS / APPROX_CENTS_PER_WORKOUT);
  const used = Math.min(Math.round(spentCents / APPROX_CENTS_PER_WORKOUT), total);
  return { used, total, remaining: Math.max(total - used, 0), spentCents };
}
