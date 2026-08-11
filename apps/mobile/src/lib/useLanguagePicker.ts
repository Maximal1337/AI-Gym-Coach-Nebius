import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLanguage, type AppLanguage } from './language';
import { track } from './analytics';

const LANGUAGES: AppLanguage[] = ['en', 'he', 'ar', 'es', 'de', 'pt', 'fr', 'it'];

/** Opens the native list of languages (ActionSheetIOS on iOS) and applies the pick. */
export function useLanguagePicker() {
  const { t } = useTranslation();
  const { setLanguage } = useLanguage();

  function open() {
    const labels = LANGUAGES.map((l) => t(`lang_${l}`));
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...labels, t('cancel')], cancelButtonIndex: labels.length },
        (index) => {
          if (index < LANGUAGES.length) {
            track('language_changed', { language: LANGUAGES[index] });
            void setLanguage(LANGUAGES[index]);
          }
        },
      );
    } else {
      Alert.alert(t('language'), undefined, [
        ...LANGUAGES.map((lang, i) => ({
          text: labels[i],
          onPress: () => { track('language_changed', { language: lang }); void setLanguage(lang); },
        })),
        { text: t('cancel'), style: 'cancel' as const },
      ]);
    }
  }

  return { open };
}
