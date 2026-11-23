import { Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LanguageService } from '../core/language.service';
import { AppNotification } from '../core/models';
import { AppDatePipe, CityPipe, InrPipe } from './pipes';

/** Title + one-line summary of a notification, rendered from its stored params in the current UI language. */
@Component({
  selector: 'app-notification-text',
  imports: [TranslatePipe, AppDatePipe, CityPipe, InrPipe],
  template: `
    @if (offer(); as o) {
      <strong>{{ o.title }}</strong>
      <span class="body">{{ o.body }}</span>
    } @else {
      <strong>{{ 'NOTIFY.TYPES.' + n().type | translate }}</strong>
      <span class="body">
        {{ bodyKey() | translate: {
          route: (n().params.from | city) + ' → ' + (n().params.to | city),
          date: (n().params.departureTime | appDate: 'datetime'),
          oldDate: (n().params.oldDepartureTime | appDate: 'datetime'),
          boarding: n().params.boardingPoint ?? '',
          boardingTime: (n().params.boardingTime | appDate: 'time'),
          seats: (n().params.seats ?? []).join(', '),
          pnr: n().pnr,
          refund: (n().params.refundAmount | inr)
        } }}
      </span>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
    .body { font-size: 0.86rem; overflow-wrap: anywhere; }
  `,
})
export class NotificationText {
  private readonly language = inject(LanguageService);
  readonly n = input.required<AppNotification>();

  /** Offers carry every language version; show the current UI language, falling back to English. */
  protected readonly offer = computed(() => {
    const n = this.n();
    if (n.type !== 'promotion') return null;
    const tr = n.params.translations?.[this.language.current()];
    if (tr?.title && tr.body) return tr;
    return { title: n.params.title || n.title, body: n.params.body || n.body };
  });

  protected readonly bodyKey = computed(() => {
    const n = this.n();
    if (n.type === 'booking_cancelled') {
      return n.params.paid && n.params.refundAmount ? 'NOTIFY.BODY.booking_cancelled' : 'NOTIFY.BODY.booking_cancelled_plain';
    }
    if (n.type === 'schedule_changed' && !n.params.oldDepartureTime) return 'NOTIFY.BODY.schedule_changed_plain';
    return `NOTIFY.BODY.${n.type}`;
  });
}
