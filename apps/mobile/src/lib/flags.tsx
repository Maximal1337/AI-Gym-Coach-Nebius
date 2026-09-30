import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { supabase } from './supabase';

/** Mirrors public.feature_flags (supabase/migrations/20260918130000_feature_flags.sql; assistant_checkin from 20260928170000). */
export type FeatureFlag = 'assistant_chat' | 'assistant_memory' | 'assistant_workout' | 'assistant_checkin';

const NO_FLAGS: ReadonlySet<FeatureFlag> = new Set();
const FlagsContext = createContext<ReadonlySet<FeatureFlag>>(NO_FLAGS);

/**
 * Server-controlled feature flags (NH-12): the hackathon features stay hidden
 * unless the signed-in account has them enabled server-side — real users keep
 * the current experience. Loaded on every auth change (sign-in, sign-out,
 * token refresh) and whenever the app returns to the foreground, so turning a
 * flag or its global kill switch off takes effect without a new build.
 *
 * Fails closed: until the first successful load, or when signed out, there are
 * no flags. A failed refresh keeps the last known set rather than flickering a
 * feature away mid-use on a flaky connection.
 */
export function FlagsProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<ReadonlySet<FeatureFlag>>(NO_FLAGS);

  useEffect(() => {
    let cancelled = false;
    let latest = 0;

    async function load() {
      const request = ++latest;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          if (!cancelled && request === latest) setFlags(NO_FLAGS);
          return;
        }
        const { data, error } = await supabase.rpc('my_feature_flags');
        if (cancelled || request !== latest || error || !Array.isArray(data)) return;
        setFlags(new Set(data as FeatureFlag[]));
      } catch {
        // Keep the last known flags; the next auth change or foreground retries.
      }
    }

    void load();
    const { data: auth } = supabase.auth.onAuthStateChange(() => { void load(); });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => {
      cancelled = true;
      auth.subscription.unsubscribe();
      appState.remove();
    };
  }, []);

  return <FlagsContext.Provider value={flags}>{children}</FlagsContext.Provider>;
}

/** Whether a feature is enabled for the signed-in account. */
export function useFlag(flag: FeatureFlag): boolean {
  return useContext(FlagsContext).has(flag);
}
