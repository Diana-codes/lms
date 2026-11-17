import 'server-only';
import type { Dictionary } from '@/dictionaries/en';

export const locales = ['en', 'rw'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export const localeNames: Record<Locale, string> = {
  en: 'English',
  rw: 'Kinyarwanda',
};

const dictionaries: Record<Locale, () => Promise<Dictionary>> = {
  en: () => import('@/dictionaries/en').then((m) => m.default),
  rw: () => import('@/dictionaries/rw').then((m) => m.default),
};

export const hasLocale = (value: string): value is Locale =>
  (locales as readonly string[]).includes(value);

export const getDictionary = (locale: Locale) => dictionaries[locale]();
