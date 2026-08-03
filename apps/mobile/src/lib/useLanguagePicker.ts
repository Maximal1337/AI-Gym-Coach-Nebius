import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLanguage, type AppLanguage } from './language';

const LANGUAGES: AppLanguage[] = ['en', 'he', 'ar'];

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
          if (index < LANGUAGES.length) void setLanguage(LANGUAGES[index]);
        },
      );
    } else {
      Alert.alert(t('language'), undefined, [
        ...LANGUAGES.map((lang, i) => ({ text: labels[i], onPress: () => void setLanguage(lang) })),
        { text: t('cancel'), style: 'cancel' as const },
      ]);
    }
  }

  return { open };
}
