import { Linking, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/Screen';
import { useLanguage } from '../src/lib/language';
import { track } from '../src/lib/analytics';
import { useTheme, spacing, radius } from '../src/theme';

// Fallback so the ONLY escape from this dead-end screen never depends on a
// nullable DB column (app_config.store_url). Opens the App Store app
// generically; the store_url from config is preferred when set. Replace with
// the real listing URL (or just set store_url) once the app is live.
const FALLBACK_STORE_URL = 'https://apps.apple.com/';

/**
 * Hard update gate — reached via replace() from the entry router when the
 * running version is below the server-set minimum (see lib/appUpdate.ts). No
 * back affordance and nothing replaces it away: the only path forward is
 * updating. Deliberately a dead-end, unlike every other screen.
 */
export default function ForceUpdate() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const { storeUrl } = useLocalSearchParams<{ storeUrl?: string }>();

  return (
    <Screen>
      <View style={{ flex: 1, padding: spacing.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
        <Ionicons name="arrow-up-circle-outline" size={56} color={theme.accent} />
        <Text style={{ color: theme.ink, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>
          {t('updateRequiredTitle')}
        </Text>
        <Text style={{ color: theme.inkSoft, fontSize: 15, lineHeight: 22, textAlign: 'center', writingDirection: dir === 'rtl' ? 'rtl' : 'ltr' }}>
          {t('updateRequiredBody')}
        </Text>
        <Pressable
          onPress={() => { track('force_update_tapped'); Linking.openURL(storeUrl || FALLBACK_STORE_URL); }}
          style={{ backgroundColor: theme.accent, paddingVertical: 14, paddingHorizontal: 32, borderRadius: radius.pill, marginTop: spacing.sm }}
        >
          <Text style={{ color: theme.onAccent, fontWeight: '700' }}>{t('updateNow')}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}
