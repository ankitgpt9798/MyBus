import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

/** Route titles are translation keys; the document title follows the selected language. */
@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly translate = inject(TranslateService);
  private key: string | undefined;

  constructor() {
    super();
    this.translate.onLangChange.subscribe(() => this.render());
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.key = this.buildTitle(snapshot);
    this.render();
  }

  private render(): void {
    const app = this.translate.instant('APP.NAME');
    this.title.setTitle(this.key ? `${this.translate.instant(this.key)} | ${app}` : app);
  }
}
