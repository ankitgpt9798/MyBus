import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

/** Placeholder for sections that are not built yet. `feature` comes from the route's data. */
@Component({
  selector: 'app-coming-soon',
  imports: [RouterLink, TranslatePipe],
  template: `
    <div class="container section narrow">
      <div class="empty-state card">
        <h1 class="page-title">{{ 'COMING_SOON.' + feature() + '.TITLE' | translate }}</h1>
        <p class="muted">{{ 'COMING_SOON.' + feature() + '.TEXT' | translate }}</p>
        <span class="badge badge-info">{{ 'COMING_SOON.BADGE' | translate }}</span>
        <a routerLink="/" class="btn btn-outline">{{ 'COMMON.BACK_HOME' | translate }}</a>
      </div>
    </div>
  `,
})
export class ComingSoonPage {
  readonly feature = input('COMMUNITY');
}
