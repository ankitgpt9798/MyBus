import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { NumPipe } from './pipes';

/** Read-only star rating (supports fractions, e.g. 4.3), announced as "4.3 out of 5 stars". */
@Component({
  selector: 'app-stars',
  imports: [TranslatePipe, NumPipe],
  template: `
    <span class="stars" role="img" [attr.aria-label]="'REVIEWS.STARS_LABEL' | translate: { value: (value() | num: 1) }" [style.--size.px]="size()">
      @for (fill of fills(); track $index) {
        <span class="star" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="bg"><path [attr.d]="path" /></svg>
          <svg viewBox="0 0 24 24" class="fg" [style.clip-path]="'inset(0 ' + (100 - fill) + '% 0 0)'"><path [attr.d]="path" /></svg>
        </span>
      }
    </span>
  `,
  styles: `
    :host { display: inline-flex; vertical-align: middle; }
    .stars { display: inline-flex; gap: 1px; }
    .star { position: relative; width: var(--size); height: var(--size); }
    svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .bg { fill: var(--color-border); }
    .fg { fill: var(--color-star); }
  `,
})
export class Stars {
  readonly value = input.required<number>();
  readonly size = input(16);
  protected readonly path = 'm12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z';
  protected readonly fills = computed(() => [0, 1, 2, 3, 4].map((i) => Math.round(Math.max(0, Math.min(1, this.value() - i)) * 100)));
}
