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
