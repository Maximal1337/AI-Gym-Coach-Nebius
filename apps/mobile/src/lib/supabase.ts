import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env',
  );
}

/**
 * Anon-key client: every query is row-scoped by RLS to the signed-in user.
 * Auth session persistence (AsyncStorage) is wired in M2 with the real
 * login flow (GYM-25).
 */
export const supabase = createClient(url, anonKey);
