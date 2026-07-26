import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './locales/he.json';

// GYM-50: every UI string goes through i18next from day one. Only Hebrew
// ships in v1 — adding a language later is a new JSON file, not a refactor.
i18n.use(initReactI18next).init({
  resources: { he: { translation: he } },
  lng: 'he',
  fallbackLng: 'he',
  interpolation: { escapeValue: false },
});

export default i18n;
