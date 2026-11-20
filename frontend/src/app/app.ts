import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Footer } from './shared/footer';
import { Header } from './shared/header';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TranslatePipe, Header, Footer],
  template: `
    <a class="skip-link" href="#main">{{ 'COMMON.SKIP_TO_CONTENT' | translate }}</a>
    <app-header />
    <main id="main" class="site-main">
      <router-outlet />
    </main>
    <app-footer />
  `,
})
export class App {}
