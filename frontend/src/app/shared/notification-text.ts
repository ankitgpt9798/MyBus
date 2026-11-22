import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AppNotification } from '../core/models';
import { AppDatePipe, CityPipe, InrPipe } from './pipes';

/** Title + one-line summary of a notification, rendered from its stored params in the current UI language. */
@Component({
  selector: 'app-notification-text',
  imports: [TranslatePipe, AppDatePipe, CityPipe, InrPipe],
  template: `
    <strong>{{ 'NOTIFY.TYPES.' + n().type | translate }}</strong>
    <span class="body">
      @if (n().type === 'promotion') {
        {{ n().body }}
      } @else {
        {{ bodyKey() | translate: {
          route: (n().params.from | city) + ' → ' + (n().params.to | city),
          date: (n().params.departureTime | appDate: 'datetime'),
          pnr: n().pnr,
          refund: (n().params.refundAmount | inr)
        } }}
      }
    </span>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
    .body { font-size: 0.86rem; overflow-wrap: anywhere; }
  `,
})
export class NotificationText {
  readonly n = input.required<AppNotification>();

  protected readonly bodyKey = computed(() => {
    const n = this.n();
    if (n.type === 'booking_cancelled') {
      return n.params.paid && n.params.refundAmount ? 'NOTIFY.BODY.booking_cancelled' : 'NOTIFY.BODY.booking_cancelled_plain';
    }
    return `NOTIFY.BODY.${n.type}`;
  });
}
