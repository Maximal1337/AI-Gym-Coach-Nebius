import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/Screen';
import { Button } from '../src/components/Button';
import { Badge } from '../src/components/Badge';
import { deviceLanguage, useLanguage, type AppLanguage } from '../src/lib/language';
import { useTheme, spacing, radius } from '../src/theme';

const LANGUAGES: AppLanguage[] = ['en', 'he', 'ar', 'es', 'de', 'pt', 'fr', 'it'];
const LANGUAGE_DIR: Record<AppLanguage, 'ltr' | 'rtl'> = {
  en: 'ltr', he: 'rtl', ar: 'rtl', es: 'ltr', de: 'ltr', pt: 'ltr', fr: 'ltr', it: 'ltr',
};

/**
 * "The explicit step" (guidelines/language-discovery.html) — the design
 * doc's own top recommendation is silent device-language detection plus
 * a dismissible confirmation strip, specifically because a dedicated
 * step costs a screen and asks everyone to solve a problem only some
 * people have. Shipping the step anyway, per instruction: real users
 * were found stuck on English with no idea the app supported anything
 * else, which is exactly the case the doc itself calls out as the
 * dedicated step's justification — "if your data shows people are
 * ending up in the wrong language and never recovering, certainty beats
 * elegance." Pre-selected to the device's own language either way, so
 * confirming is one tap for the common case.
 */
export default function OnboardingLanguage() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { setLanguage } = useLanguage();
  const [selected, setSelected] = useState<AppLanguage>(deviceLanguage() ?? 'en');
  const [busy, setBusy] = useState(false);
  const detected = deviceLanguage();

  async function confirm() {
    setBusy(true);
    await setLanguage(selected);
    router.replace('/');
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, justifyContent: 'center' }}>
        <Text style={{ color: theme.ink, fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: spacing.xs }}>
          {t('langChooseTitle')}
        </Text>
        <Text style={{ color: theme.inkSoft, fontSize: 13, textAlign: 'center', marginBottom: spacing.lg }}>
          {t('langChooseSub')}
        </Text>

        <View style={{ gap: spacing.sm }}>
          {LANGUAGES.map((lang) => {
            const isSelected = selected === lang;
            const dir = LANGUAGE_DIR[lang];
            return (
              <Pressable
                key={lang}
                onPress={() => setSelected(lang)}
                style={{
                  flexDirection: dir === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: spacing.md,
                  backgroundColor: isSelected ? 'rgba(98, 252, 152, 0.12)' : theme.surface,
                  borderWidth: 1.5, borderColor: isSelected ? theme.accent : 'transparent',
                  borderRadius: radius.card, padding: spacing.md,
                }}
              >
                <Text style={{
                  flex: 1, color: isSelected ? theme.accent : theme.ink, fontSize: 17, fontWeight: '700',
                  textAlign: dir === 'rtl' ? 'right' : 'left',
                }}>
                  {t(`lang_${lang}`)}
                </Text>
                {detected === lang && <Badge tone="neutral">{t('deviceBadge')}</Badge>}
                {isSelected && <Ionicons name="checkmark-circle" size={20} color={theme.accent} />}
              </Pressable>
            );
          })}
        </View>

        <Button block busy={busy} onPress={confirm} style={{ marginTop: spacing.lg }}>
          {t('continue')}
        </Button>
      </ScrollView>
    </Screen>
  );
}
