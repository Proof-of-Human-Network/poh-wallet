import { Platform, NativeModules } from 'react-native';
import { SUPPORTED_LANGUAGES } from '../constants';

// NOTE: The full translations object has been moved out of App.js for cleanliness.
// For even better open-source structure, these can be split into individual files:
//   src/i18n/locales/en.js, zh.js, es.js, etc.

import { translations } from './translations';

export { SUPPORTED_LANGUAGES };

const warnedLanguages = new Set();

export function createTranslator(lang) {
  return (key, params = {}) => {
    const hasLang = !!translations[lang];
    const dict = hasLang ? translations[lang] : (translations.en || {});

    if (!hasLang && lang !== 'en' && !warnedLanguages.has(lang)) {
      warnedLanguages.add(lang);
      console.warn(`[i18n] No full translations found for language "${lang}". Falling back to English. (Add data to src/i18n/translations.js)`);
    }

    let str = dict[key] !== undefined
      ? dict[key]
      : (translations.en?.[key] !== undefined ? translations.en[key] : key);

    if (params && typeof params === 'object') {
      Object.keys(params).forEach(k => {
        const val = params[k] != null ? String(params[k]) : '';
        str = str.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), val);
      });
    }
    return str;
  };
}

export function detectDefaultLanguage() {
  try {
    let locale = 'en';
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings || {};
      locale = settings.AppleLocale ||
               (settings.AppleLanguages && settings.AppleLanguages[0]) ||
               'en';
    } else {
      locale = NativeModules.I18nManager?.localeIdentifier || 'en_US';
    }

    let code = String(locale || 'en').toLowerCase().split(/[-_]/)[0];
    if (code === 'zh' || code === 'cn') code = 'zh';

    const supported = SUPPORTED_LANGUAGES.find(l => l.code === code);
    return supported ? code : 'en';
  } catch {
    return 'en';
  }
}

// Convenience hook-style helper (can be expanded with useContext later)
export function useI18n(language, changeLanguage) {
  const t = createTranslator(language);
  return { t, language, changeLanguage };
}
