import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { LanguageService } from './language.service';
import { Lang, Theme } from './models';
import { ThemeService } from './theme.service';

/** Applies language/theme instantly and, for signed-in users, saves them to the profile so they follow the user. */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly auth = inject(AuthService);
  private readonly language = inject(LanguageService);
  private readonly theme = inject(ThemeService);

  async setLanguage(lang: Lang): Promise<boolean> {
    await this.language.use(lang);
    return this.saveRemote({ language: lang });
  }

  setTheme(theme: Theme): Promise<boolean> {
    this.theme.apply(theme);
    return this.saveRemote({ theme });
  }

  toggleTheme(): Promise<boolean> {
    return this.setTheme(this.theme.current() === 'dark' ? 'light' : 'dark');
  }

  /** Resolves true when saved to the profile (false for guests or when offline; the local choice still applies). */
  private async saveRemote(patch: { language?: Lang; theme?: Theme }): Promise<boolean> {
    if (!this.auth.isLoggedIn()) return false;
    try {
      await this.auth.updateProfile(patch);
      return true;
    } catch {
      return false;
    }
  }
}
