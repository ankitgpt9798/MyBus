import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

/** Shown when a signed-in user opens an admin-only page. */
@Component({
  selector: 'app-forbidden',
  imports: [RouterLink, TranslatePipe],
  template: `
    <div class="container section narrow">
      <div class="empty-state card">
        <h1 class="page-title">403</h1>
        <h2>{{ 'FORBIDDEN.TITLE' | translate }}</h2>
        <p class="muted">{{ 'FORBIDDEN.TEXT' | translate }}</p>
        <a routerLink="/" class="btn btn-primary">{{ 'COMMON.BACK_HOME' | translate }}</a>
      </div>
    </div>
  `,
})
export class ForbiddenPage {}
