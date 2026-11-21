import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { routes } from './app.routes';
import { AuthService } from './core/auth.service';
import { authInterceptor } from './core/interceptors';
import { DEFAULT_LANG, LanguageService } from './core/language.service';
import { ThemeService } from './core/theme.service';
import { TranslatedTitleStrategy } from './core/title.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    { provide: TitleStrategy, useClass: TranslatedTitleStrategy },
    provideHttpClient(withInterceptors([authInterceptor])),
    // All UI text comes from /i18n/<lang>.json; English is the default and the fallback.
    provideTranslateService({
      fallbackLang: DEFAULT_LANG,
      loader: provideTranslateHttpLoader({ prefix: '/i18n/', suffix: '.json' }),
    }),
    // Before the first route renders: apply the local theme and language (so nothing shows as raw keys),
    // then restore the session, which applies the profile's saved preferences.
    provideAppInitializer(async () => {
      const theme = inject(ThemeService);
      const language = inject(LanguageService);
      const auth = inject(AuthService);
      theme.init();
      await language.use(language.current());
      await auth.restore();
    }),
  ],
};
