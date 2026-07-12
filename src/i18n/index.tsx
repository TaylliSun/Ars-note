import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import en, { Translations } from './en';
import zhCN from './zhCN';

export type Language = 'en' | 'zh-CN';

const allTranslations: Record<Language, Translations> = { en, 'zh-CN': zhCN };

interface I18nContextType {
  t: Translations;
  language: Language;
  setLanguage: (lang: Language) => void;
}

const I18nContext = createContext<I18nContextType>({
  t: zhCN,
  language: 'zh-CN',
  setLanguage: () => {},
});

const STORAGE_KEY = 'ars-note.language';

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'en' || saved === 'zh-CN') return saved;
    } catch {
      /* localStorage unavailable in some environments */
    }
    return 'zh-CN';
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      /* ignore */
    }
  }, [language]);

  const t = allTranslations[language];

  return (
    <I18nContext.Provider value={{ t, language, setLanguage }}>
      {children}
    </I18nContext.Provider>
  );
};

export function useI18n(): I18nContextType {
  return useContext(I18nContext);
}

export type { Translations };
