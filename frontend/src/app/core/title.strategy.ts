import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

/**
 * Route titles are translation keys; the document title follows the selected language.
 * A page can replace its title with a dynamic one (e.g. "Delhi to Lucknow"); it is cleared on the next navigation.
 */
@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly translate = inject(TranslateService);
  private key: string | undefined;
  private dynamic: (() => string) | null = null;

  constructor() {
    super();
    this.translate.onLangChange.subscribe(() => this.render());
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.key = this.buildTitle(snapshot);
    this.dynamic = null;
    this.render();
  }

  /** Page-specific title, re-evaluated on every language change; null goes back to the route's title. */
  setDynamicTitle(fn: (() => string) | null): void {
    this.dynamic = fn;
    this.render();
  }

  private render(): void {
    const app = this.translate.instant('APP.NAME');
    const page = this.dynamic ? this.dynamic() : this.key ? this.translate.instant(this.key) : null;
    this.title.setTitle(page ? `${page} | ${app}` : app);
  }
}
