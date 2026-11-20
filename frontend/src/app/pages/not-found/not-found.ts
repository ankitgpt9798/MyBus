import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, TranslatePipe],
  template: `
    <div class="container section narrow">
      <div class="empty-state card">
        <h1 class="page-title">404</h1>
        <h2>{{ 'NOT_FOUND.TITLE' | translate }}</h2>
        <p class="muted">{{ 'NOT_FOUND.TEXT' | translate }}</p>
        <a routerLink="/" class="btn btn-primary">{{ 'COMMON.BACK_HOME' | translate }}</a>
      </div>
    </div>
  `,
})
export class NotFoundPage {}
