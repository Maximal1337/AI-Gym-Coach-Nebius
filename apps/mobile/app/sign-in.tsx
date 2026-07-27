import { useEffect, useState } from 'react';
import {
  Alert, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useTranslation } from 'react-i18next';
import { supabase } from '../src/lib/supabase';
import { Screen } from '../src/components/Screen';
import { useTheme, spacing, radius, typography } from '../src/theme';

export default function SignIn() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    let mounted = true;
    AppleAuthentication.isAvailableAsync()
      .then((v) => mounted && setAppleAvailable(v))
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  async function afterAuth() {
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

  async function signInEmail(signUp: boolean) {
    Keyboard.dismiss();
    if (!email.trim() || !password) {
      Alert.alert(t('signInError'));
      return;
    }
    setBusy(true);
    const { error } = signUp
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) Alert.alert(t('signInError'), error.message);
    else afterAuth();
  }

  return (
    <Screen>
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: spacing.lg }}
      >
      <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
        <Image
          source={require('../assets/logo-mark.png')}
          resizeMode="contain"
          style={{ width: 220, height: 220, tintColor: theme.ink, marginBottom: spacing.md }}
        />
        <Text style={{
          color: theme.ink, fontSize: typography.screenTitle.size,
          fontWeight: typography.screenTitle.weight, letterSpacing: typography.screenTitle.letterSpacing,
        }}>
          {t('appName')}
        </Text>
        <Text style={{ color: theme.inkSoft, marginTop: spacing.sm, textAlign: 'center' }}>
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

      <Text style={{ color: theme.inkSoft, textAlign: 'center', marginVertical: spacing.md }}>
        {t('or')}
      </Text>

      <TextInput
        placeholder={t('email')}
        placeholderTextColor={theme.inkSoft}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{
          borderWidth: 1, borderColor: theme.rule, borderRadius: radius.field,
          padding: 12, color: theme.ink, marginBottom: spacing.sm, textAlign: 'right',
        }}
      />
      <TextInput
        placeholder={t('password')}
        placeholderTextColor={theme.inkSoft}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{
          borderWidth: 1, borderColor: theme.rule, borderRadius: radius.field,
          padding: 12, color: theme.ink, marginBottom: spacing.md, textAlign: 'right',
        }}
      />
      <Pressable
        disabled={busy}
        onPress={() => signInEmail(false)}
        style={{ backgroundColor: theme.accent, padding: 14, borderRadius: radius.pill, alignItems: 'center' }}
      >
        <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{t('signIn')}</Text>
      </Pressable>
      <Pressable disabled={busy} onPress={() => signInEmail(true)} style={{ padding: spacing.md, alignItems: 'center' }}>
        <Text style={{ color: theme.accent, fontWeight: '600' }}>{t('signUp')}</Text>
      </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
    </Screen>
  );
}
