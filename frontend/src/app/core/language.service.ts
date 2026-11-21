import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { Lang } from './models';
import { STORAGE_KEYS, readStorage, writeStorage } from './storage';

export const DEFAULT_LANG: Lang = 'en';
/** Language names are shown in their own script, as is usual for a language picker. */
export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'mr', label: 'मराठी' },
];

export const isLang = (v: unknown): v is Lang => LANGUAGES.some((l) => l.code === v);

/**
 * Applies the UI language locally: ngx-translate, <html lang> and localStorage (for guests and revisits).
 * Switching re-renders every translate pipe and the locale-aware pipes without a reload.
 * Saving to the user profile lives in PreferencesService.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly translate = inject(TranslateService);
  readonly current = signal<Lang>(this.initialLang());

  private initialLang(): Lang {
    const stored = readStorage(STORAGE_KEYS.lang);
    if (isLang(stored)) return stored;
    const browser = (navigator.language || '').slice(0, 2);
    return isLang(browser) ? browser : DEFAULT_LANG;
  }

  /** Unknown codes fall back to English; missing keys fall back to English via ngx-translate's fallbackLang. */
  async use(lang: string): Promise<void> {
    const next = isLang(lang) ? lang : DEFAULT_LANG;
    try {
      await firstValueFrom(this.translate.use(next));
    } catch {
      // Translation file failed to load: ngx-translate keeps serving the English fallback.
    }
    this.current.set(next);
    writeStorage(STORAGE_KEYS.lang, next);
    document.documentElement.lang = next;
  }
}
