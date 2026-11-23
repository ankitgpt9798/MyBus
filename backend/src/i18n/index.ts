import bn from './bn';
import en from './en';
import hi from './hi';
import mr from './mr';
import te from './te';

export const SUPPORTED_LANGUAGES = ['en', 'hi', 'mr', 'bn', 'te'] as const;
export type Lang = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Lang = 'en';

type Dict = { [key: string]: string | Dict };
const dictionaries: Record<Lang, Dict> = { en, hi, mr, bn, te };

export const isLang = (v: unknown): v is Lang => SUPPORTED_LANGUAGES.includes(v as Lang);

function lookup(dict: Dict, key: string): string | undefined {
  let node: string | Dict | undefined = dict;
  for (const part of key.split('.')) {
    if (!node || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Server-side translation (emails, notifications) with fallback to English, then to the key. */
export function t(lang: string | undefined, key: string, params: Record<string, string | number> = {}): string {
  const language = isLang(lang) ? lang : DEFAULT_LANGUAGE;
  const template = lookup(dictionaries[language], key) ?? lookup(dictionaries[DEFAULT_LANGUAGE], key) ?? key;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(params[name] ?? ''));
}

// Same locale rules as the web app: IST, 24-hour times, Latin digits for mr/bn/te.
const LOCALES: Record<Lang, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  mr: 'mr-IN-u-nu-latn',
  bn: 'bn-IN-u-nu-latn',
  te: 'te-IN-u-nu-latn',
};
const localeOf = (lang: string | undefined) => LOCALES[isLang(lang) ? lang : DEFAULT_LANGUAGE];

/** e.g. "Sun, 22 Nov, 21:30" in the user's language (IST). */
export function formatDateTime(lang: string | undefined, value: Date | string): string {
  return new Intl.DateTimeFormat(localeOf(lang), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

/** e.g. "21:45" in the user's language (IST). */
export function formatTime(lang: string | undefined, value: Date | string): string {
  return new Intl.DateTimeFormat(localeOf(lang), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

/** Rupee amount in the user's language, e.g. "₹1,240". */
export function formatMoney(lang: string | undefined, amount: number): string {
  return new Intl.NumberFormat(localeOf(lang), { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

/** Translated city name; unknown cities are returned unchanged. */
export function cityName(lang: string | undefined, city: string): string {
  const value = t(lang, `city.${city}`);
  return value === `city.${city}` ? city : value;
}
