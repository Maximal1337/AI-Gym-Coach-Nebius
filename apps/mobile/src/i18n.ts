import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import he from './locales/he.json';
import ar from './locales/ar.json';
import es from './locales/es.json';
import de from './locales/de.json';
import pt from './locales/pt.json';
import fr from './locales/fr.json';
import it from './locales/it.json';

// English by default, with Hebrew, Arabic, Spanish, German, Portuguese,
// French, and Italian as real switchable languages (see
// src/lib/language.tsx for how the active one is chosen/persisted).
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    he: { translation: he },
    ar: { translation: ar },
    es: { translation: es },
    de: { translation: de },
    pt: { translation: pt },
    fr: { translation: fr },
    it: { translation: it },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
