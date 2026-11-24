import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { NumPipe } from './pipes';
import { PluralPipe } from './plural.pipe';
import { Stars } from './stars';

/** Compact route rating that links to the route page (search cards, trip panel, home). */
@Component({
  selector: 'app-route-rating',
  imports: [RouterLink, TranslatePipe, NumPipe, Stars, PluralPipe],
  template: `
    <a class="route-rating" [routerLink]="['/routes', routeId()]" [attr.data-route]="routeId()" (click)="$event.stopPropagation()">
      @if (count()) {
        <app-stars [value]="avg()" [size]="14" />
        <strong>{{ avg() | num: 1 }}</strong>
        <span class="muted">{{ 'REVIEWS.COUNT' | plural: count() : { count: (count() | num) } }}</span>
      } @else {
        <span class="muted">{{ 'REVIEWS.NO_RATINGS_SHORT' | translate }}</span>
      }
      <span class="go">{{ 'REVIEWS.SEE_ROUTE' | translate }}</span>
    </a>
  `,
  styles: `
    .route-rating {
      display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.3rem 0.4rem;
      color: var(--color-text); font-size: 0.85rem; text-decoration: none;
    }
    .route-rating:hover .go { text-decoration: underline; }
    .go { color: var(--color-primary); font-weight: 600; }
  `,
})
export class RouteRating {
  readonly routeId = input.required<string>();
  readonly avg = input(0);
  readonly count = input(0);
}
