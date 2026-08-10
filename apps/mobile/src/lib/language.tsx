import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import i18n from '../i18n';
import { supabase } from './supabase';

export type AppLanguage = 'en' | 'he' | 'ar';
export type Direction = 'ltr' | 'rtl';

const RTL_LANGUAGES: AppLanguage[] = ['he', 'ar'];
const VALID: AppLanguage[] = ['en', 'he', 'ar'];
const STORAGE_KEY = 'notch:language';

function isAppLanguage(v: unknown): v is AppLanguage {
  return typeof v === 'string' && (VALID as string[]).includes(v);
}

/** The device's own language, if it's one we support — same pattern most apps use for a first-launch default. */
export function deviceLanguage(): AppLanguage | null {
  const code = Localization.getLocales()[0]?.languageCode;
  return isAppLanguage(code) ? code : null;
}

/**
 * Whether this device has ever gone through the explicit language-choice
 * step (guidelines/language-discovery.html) — `setLanguage` is the only
 * writer of this key; the auto-detected default `applyLanguage` falls
 * back to on first load is deliberately never persisted, so an empty key
 * here means "never confirmed," not "confirmed English."
 */
export async function hasChosenLanguage(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  return isAppLanguage(stored);
}

/** Dev-only: undoes setLanguage's persistence so the next launch hits
 * onboarding-language again, same as a real first install. Needed
 * because this flag is device-local (see hasChosenLanguage's own
 * comment) — signing into a fresh dev-test account alone can't surface
 * the language step again, only clearing this can. */
export async function resetLanguageChoice(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

interface LanguageContextValue {
  language: AppLanguage;
  dir: Direction;
  /** Persists locally always, and to users.locale/coach_profiles.language when signed in. */
  setLanguage: (lang: AppLanguage) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * App-level direction state (System Design language support) —
 * deliberately NOT React Native's I18nManager.forceRTL, which requires a
 * full app reload to take effect. Direction here is just data threaded
 * through components via useLanguage().dir, so switching is instant.
 * Priority on first load: an explicit choice already made on this device
 * (AsyncStorage) > a signed-in user's saved preference (users.locale —
 * existing users keep whatever they already had, defaulted to 'he' in the
 * DB from before this feature existed) > the device's own language, same
 * as most apps default on first launch > English.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>('en');

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
      if (isAppLanguage(stored)) {
        applyLanguage(stored);
        return;
      }
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        const { data: row } = await supabase
          .from('users')
          .select('locale')
          .eq('id', data.user.id)
          .maybeSingle();
        if (isAppLanguage(row?.locale)) {
          applyLanguage(row.locale);
          return;
        }
      }
      applyLanguage(deviceLanguage() ?? 'en');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyLanguage(lang: AppLanguage) {
    setLanguageState(lang);
    void i18n.changeLanguage(lang);
  }

  async function setLanguage(lang: AppLanguage) {
    applyLanguage(lang);
    await AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => {});
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return;
    await supabase.from('users').update({ locale: lang }).eq('id', userId);
    // No-op if the row doesn't exist yet (pre-onboarding) — not an error.
    await supabase.from('coach_profiles').update({ language: lang }).eq('user_id', userId);
  }

  const dir: Direction = RTL_LANGUAGES.includes(language) ? 'rtl' : 'ltr';
  const value = useMemo(() => ({ language, dir, setLanguage }), [language, dir]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
