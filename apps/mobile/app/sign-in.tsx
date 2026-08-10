import { useEffect, useRef, useState } from 'react';
import {
  Alert, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useTranslation } from 'react-i18next';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../src/lib/supabase';
import { Screen } from '../src/components/Screen';
import { LanguagePicker } from '../src/components/LanguagePicker';
import { LoadingOverlay } from '../src/components/LoadingOverlay';
import { Field } from '../src/components/Field';
import { CodeInput } from '../src/components/CodeInput';
import { Button } from '../src/components/Button';
import { useLanguage, resetLanguageChoice } from '../src/lib/language';
import { useTheme, spacing, radius } from '../src/theme';

const RESEND_COOLDOWN_SEC = 30;
const CODE_LENGTH = 6;
// Three fixed test accounts, allowlisted server-side in dev-test-login
// itself — the real safety boundary is there, not this __DEV__ gate. Each
// one is reset to its named state on every login (see that function), not
// just created once, so it stays reliable across repeated testing. Lets
// testing in Expo Go skip waiting on a real inbox before custom SMTP is
// wired up.
const DEV_TEST_ACCOUNTS = [
  { email: 'dor@test.com', label: 'active trial' },
  { email: 'dor+expired@test.com', label: 'subscription ended' },
  { email: 'dor+new@test.com', label: 'no data — always onboarding' },
] as const;
// Apple App Review has no inbox to receive a real one-time code in, so
// this exact address (allowlisted server-side in dev-test-login, and
// deliberately excluded from its QA-scenario reset) skips straight to a
// session in every build, not just __DEV__ — see sendCode() below.
const REVIEW_TEST_EMAIL = 'ios-review-7f2ka9@notch.app';

/**
 * Email/code sign-in (System Design: auth-flow guidelines, option B —
 * "one-time code", the recommended direction). Replaces the old two-button
 * sign-in/sign-up + password form: one email field, one Continue button,
 * and a 6-digit code the same for a brand-new account or a returning one
 * — the system decides which by whether the email already has an account,
 * with no user-visible branch. This also closes the gap where anyone
 * could type an email they don't own and get in — proving receipt of the
 * code IS the verification, there's no separate confirmation step.
 */
export default function SignIn() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeError, setCodeError] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let mounted = true;
    AppleAuthentication.isAvailableAsync()
      .then((v) => mounted && setAppleAvailable(v))
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => () => {
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
  }, []);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SEC);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1 && cooldownTimer.current) clearInterval(cooldownTimer.current);
        return Math.max(0, s - 1);
      });
    }, 1000);
  }

  function afterAuth() {
    router.replace('/');
  }

  async function signInApple() {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      });
      if (!credential.identityToken) return;
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (error) Alert.alert(t('signInError'));
      else afterAuth();
    } catch {
      /* user cancelled */
    }
  }

  // Same call whether this email has an account or not — Supabase creates
  // one on first request (shouldCreateUser, default true). Nothing here
  // ever reveals which case it was; that's the whole point of this flow.
  async function sendCode() {
    Keyboard.dismiss();
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      Alert.alert(t('signInError'), t('enterValidEmail'));
      return;
    }
    if (trimmed === REVIEW_TEST_EMAIL) {
      await devTestLogin(trimmed);
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: trimmed });
    setBusy(false);
    if (error) {
      Alert.alert(t('signInError'), error.message);
      return;
    }
    setCode('');
    setCodeError(false);
    setStep('code');
    startCooldown();
  }

  async function verifyCode(value: string) {
    setBusy(true);
    setCodeError(false);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: value, type: 'email' });
    setBusy(false);
    if (error) {
      setCodeError(true);
      setCode('');
      return;
    }
    afterAuth();
  }

  function onCodeChange(value: string) {
    setCode(value);
    setCodeError(false);
    if (value.length === CODE_LENGTH) void verifyCode(value);
  }

  function useDifferentEmail() {
    setStep('email');
    setCode('');
    setCodeError(false);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    setCooldown(0);
  }

  // Dev-only: the edge function isn't behind the normal auth check (it
  // can't be — there's no session yet), so this is a plain unauthenticated
  // fetch rather than the usual callFn helper, which requires one.
  async function devTestLogin(testEmail: string) {
    setBusy(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/dev-test-login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ email: testEmail }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { accessToken, refreshToken } = await res.json();
      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (error) throw error;
      // The "no data" account resets its server-side row on every login
      // (dev-test-login), but the language choice is device-local, not
      // server data — without this, onboarding-language never reshows
      // once this device has picked a language even once.
      if (testEmail === 'dor+new@test.com') await resetLanguageChoice();
      afterAuth();
    } catch {
      Alert.alert(t('signInError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
    <LoadingOverlay visible={busy} object="dumbbell" label={t('signingIn')} />
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: spacing.lg }}
      >
      {step === 'email' ? (
        <>
          <View style={{ alignItems: 'center', marginBottom: spacing.md }}>
            <Image
              source={require('../assets/logo-mark.png')}
              resizeMode="contain"
              style={{ width: 140, height: 140, marginBottom: spacing.xs }}
            />
            <Text style={{
              color: theme.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.6, marginTop: 4,
              textAlign: 'center',
            }}>
              {t('appName')}
            </Text>
            <Text style={{
              color: theme.inkSoft, fontSize: 15.5, lineHeight: 22, marginTop: spacing.sm,
              textAlign: 'center', maxWidth: 280,
            }}>
              {t('tagline')}
            </Text>
          </View>

          {appleAvailable && (
            <Pressable
              onPress={signInApple}
              style={{ backgroundColor: theme.ink, padding: 14, borderRadius: radius.pill, alignItems: 'center' }}
            >
              <Text style={{ color: theme.bg, fontWeight: '700' }}>{t('signInWithApple')}</Text>
            </Pressable>
          )}

          {appleAvailable && (
            <Text style={{ color: theme.inkSoft, textAlign: 'center', marginVertical: spacing.md }}>
              {t('or')}
            </Text>
          )}

          <Field
            value={email}
            onChangeText={setEmail}
            placeholder={t('email')}
            surface="outline"
            keyboardType="email-address"
            autoCapitalize="none"
            onSubmitEditing={sendCode}
            style={{ marginBottom: spacing.md }}
          />
          <Button block disabled={busy} onPress={sendCode}>{t('continue')}</Button>

          {__DEV__ && DEV_TEST_ACCOUNTS.map(({ email: testEmail, label }) => (
            <Button
              key={testEmail}
              variant="dashed" block disabled={busy} onPress={() => devTestLogin(testEmail)}
              style={{ marginTop: spacing.md }}
            >
              Dev: {label}
            </Button>
          ))}
        </>
      ) : (
        <>
          <Text style={{
            color: theme.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.4,
            textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: 5,
          }}>
            {t('codeStepTitle')}
          </Text>
          <Text style={{
            color: theme.inkSoft, fontSize: 13.5, lineHeight: 20,
            textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.lg,
          }}>
            {t('codeSentTo', { email: email.trim() })}
          </Text>

          <CodeInput value={code} onChangeText={onCodeChange} disabled={busy} autoFocus />

          {codeError && (
            <Text style={{
              color: theme.critical, fontSize: 12.5, textAlign: dir === 'rtl' ? 'right' : 'left', marginBottom: spacing.sm,
            }}>
              {t('codeInvalid')}
            </Text>
          )}

          <Button
            variant="ghost" block disabled={busy || cooldown > 0}
            onPress={sendCode}
            style={{ marginTop: spacing.sm }}
          >
            {cooldown > 0 ? t('resendCodeIn', { seconds: cooldown }) : t('resendCode')}
          </Button>
          <Button variant="quiet" block disabled={busy} onPress={useDifferentEmail}>
            {t('useDifferentEmail')}
          </Button>
        </>
      )}
      </ScrollView>
    </KeyboardAvoidingView>
    {/* Floats above the centered content instead of sitting in normal flow
        above it — otherwise it eats into the ScrollView's available height
        and the "centered" block ends up visibly low, centered only in the
        leftover space below this row rather than the full screen. */}
    <View style={{
      position: 'absolute', top: insets.top, left: 0, right: 0,
      flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'center',
      padding: spacing.md,
    }}>
      {step === 'code' ? (
        <Pressable onPress={useDifferentEmail} hitSlop={10}>
          <Ionicons name={dir === 'rtl' ? 'chevron-forward' : 'chevron-back'} size={24} color={theme.inkSoft} />
        </Pressable>
      ) : <View />}
      <LanguagePicker />
    </View>
    </Screen>
  );
}
