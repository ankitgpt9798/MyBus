import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Booking } from '../../core/models';
import { AppDatePipe, CityPipe, InrPipe } from '../../shared/pipes';

/** Order summary shown beside the passenger and payment steps. */
@Component({
  selector: 'app-booking-summary',
  imports: [TranslatePipe, AppDatePipe, CityPipe, InrPipe],
  template: `
    @let b = booking();
    <h2 class="sub-title">{{ 'CHECKOUT.SUMMARY' | translate }}</h2>
    <p class="route-line"><strong>{{ b.journey.from | city }}</strong> → <strong>{{ b.journey.to | city }}</strong></p>
    <p class="muted small">{{ b.journey.departureTime | appDate: 'datetime' }} · {{ b.journey.operatorName }}</p>
    <dl class="kv">
      <dt>{{ 'TRIP.SEATS' | translate }}</dt>
      <dd>{{ b.seats.join(', ') }}</dd>
      <dt>{{ 'TRIP.BOARDING_POINT' | translate }}</dt>
      <dd>{{ b.boardingPoint.time | appDate: 'time' }} — {{ b.boardingPoint.name }}</dd>
      <dt>{{ 'TRIP.DROPPING_POINT' | translate }}</dt>
      <dd>{{ b.droppingPoint.time | appDate: 'datetime' }} — {{ b.droppingPoint.name }}</dd>
    </dl>
    <div class="fare-line"><span>{{ 'TRIP.FARE_PER_SEAT' | translate }}</span><span>{{ b.farePerSeat | inr }} × {{ b.seats.length }}</span></div>
    <div class="fare-line total"><span>{{ 'TRIP.TOTAL' | translate }}</span><strong>{{ b.totalAmount | inr }}</strong></div>
  `,
  styles: `
    :host { display: block; }
    .route-line { margin: 0 0 0.2rem; font-size: 1.05rem; }
    .kv { margin: 0.75rem 0; font-size: 0.9rem; }
    .fare-line { display: flex; justify-content: space-between; gap: 1rem; padding: 0.3rem 0; }
    .total { margin-top: 0.4rem; padding-top: 0.6rem; border-top: 1px solid var(--color-border); font-size: 1.15rem; }
  `,
})
export class BookingSummary {
  readonly booking = input.required<Booking>();
}
