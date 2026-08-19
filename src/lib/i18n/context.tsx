'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { getDictionary, type Dictionary, type Locale } from '@/lib/i18n/dictionaries';

interface I18nValue {
  locale: Locale;
  t: Dictionary;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Holds the active language for the tree below it.
 *
 * The dictionary is looked up here rather than handed down from the server
 * layout on purpose: it contains functions for the strings that interpolate
 * numbers and names, and functions cannot cross the server/client boundary.
 */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <I18nContext.Provider value={{ locale, t: getDictionary(locale) }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used inside an I18nProvider.');
  }
  return value;
}
