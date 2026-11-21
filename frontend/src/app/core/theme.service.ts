import { Injectable, signal } from '@angular/core';
import { Theme } from './models';
import { STORAGE_KEYS, readStorage, writeStorage } from './storage';

export const DEFAULT_THEME: Theme = 'light';
export const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark';

/**
 * Applies the theme by setting <html data-theme>; all colours are CSS variables, so the switch is instant.
 * index.html runs the same lookup inline before Angular boots, so the first paint already has the right theme.
 * With no stored preference the default is light.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly current = signal<Theme>(this.initialTheme());

  private initialTheme(): Theme {
    const stored = readStorage(STORAGE_KEYS.theme);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  }

  init(): void {
    this.apply(this.current(), false);
  }

  apply(theme: string, persist = true): void {
    const next = isTheme(theme) ? theme : DEFAULT_THEME;
    this.current.set(next);
    document.documentElement.dataset['theme'] = next;
    if (persist) writeStorage(STORAGE_KEYS.theme, next);
  }
}
