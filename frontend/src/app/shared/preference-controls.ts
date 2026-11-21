import { Component, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LANGUAGES, LanguageService } from '../core/language.service';
import { Lang } from '../core/models';
import { PreferencesService } from '../core/preferences.service';
import { ThemeService } from '../core/theme.service';
import { Icon } from './icons';

/** Language selector + dark-mode toggle. Rendered in the header (desktop) and inside the mobile menu. */
@Component({
  selector: 'app-preference-controls',
  imports: [TranslatePipe, Icon],
  template: `
    <label class="lang-picker" [title]="'HEADER.LANGUAGE' | translate">
      <app-icon name="globe" [size]="18" />
      <span class="sr-only">{{ 'HEADER.LANGUAGE' | translate }}</span>
      <select class="lang-select" [attr.data-place]="place()" (change)="setLanguage($event)">
        @for (l of languages; track l.code) {
          <option [value]="l.code" [selected]="l.code === language.current()" [attr.lang]="l.code">{{ l.label }}</option>
        }
      </select>
    </label>
    <button type="button" class="icon-btn theme-toggle" [attr.data-place]="place()" (click)="prefs.toggleTheme()"
      [attr.aria-pressed]="theme.current() === 'dark'"
      [attr.aria-label]="(theme.current() === 'dark' ? 'HEADER.SWITCH_TO_LIGHT' : 'HEADER.SWITCH_TO_DARK') | translate"
      [title]="(theme.current() === 'dark' ? 'HEADER.SWITCH_TO_LIGHT' : 'HEADER.SWITCH_TO_DARK') | translate">
      <app-icon [name]="theme.current() === 'dark' ? 'sun' : 'moon'" />
      @if (place() === 'menu') {
        <span class="toggle-text">{{ 'HEADER.DARK_MODE' | translate }}</span>
      }
    </button>
  `,
  styles: `
    :host { display: flex; align-items: center; gap: 0.5rem; }
    .lang-picker {
      display: flex; align-items: center; gap: 0.25rem; height: 38px; padding: 0 0.5rem;
      border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text-muted);
    }
    .lang-select {
      width: auto; min-height: 0; padding: 0 0.15rem; border: 0; background: transparent;
      color: var(--color-text); font: inherit; cursor: pointer; box-shadow: none;
    }
    .lang-select:focus { box-shadow: none; }
    .lang-select option { background: var(--color-surface); color: var(--color-text); }
    :host([place='menu']) .theme-toggle { width: auto; padding: 0 0.75rem; gap: 0.5rem; display: inline-flex; align-items: center; }
  `,
  host: { '[attr.place]': 'place()' },
})
export class PreferenceControls {
  readonly place = input<'header' | 'menu'>('header');

  protected readonly language = inject(LanguageService);
  protected readonly theme = inject(ThemeService);
  protected readonly prefs = inject(PreferencesService);
  protected readonly languages = LANGUAGES;

  protected setLanguage(event: Event): void {
    void this.prefs.setLanguage((event.target as HTMLSelectElement).value as Lang);
  }
}
