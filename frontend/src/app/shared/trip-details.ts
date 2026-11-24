import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../core/api.service';
import { errorKey } from '../core/api-error';
import { Stop, TripDetails } from '../core/models';
import { AppDatePipe, CityPipe, NumPipe } from './pipes';
import { RouteRating } from './route-rating';
import { TranslateOrPipe } from './translate-or.pipe';

type Tab = 'points' | 'bus' | 'policy';

/** Read-only trip information shown inside a search result card. */
@Component({
  selector: 'app-trip-details',
  imports: [TranslatePipe, AppDatePipe, CityPipe, NumPipe, TranslateOrPipe, RouteRating],
  template: `
    <div class="tabs" role="tablist">
      @for (t of tabs; track t) {
        <button type="button" role="tab" class="tab" [class.active]="tab() === t" [attr.aria-selected]="tab() === t" (click)="tab.set(t)">
          {{ 'TRIP.TABS.' + t.toUpperCase() | translate }}
        </button>
      }
    </div>

    @if (error(); as e) {
      <div class="alert alert-error">{{ e | translateOr: 'ERRORS.GENERIC' }}</div>
    } @else if (data(); as d) {
      @switch (tab()) {
        @case ('points') {
          <div class="points">
            <div>
              <h3>{{ 'TRIP.BOARDING_POINTS' | translate }}</h3>
              <ul class="stop-list">
                @for (s of boarding(); track s.name) {
                  <li><strong>{{ at(s) | appDate: 'time' }}</strong> {{ s.name }}</li>
                }
              </ul>
            </div>
            <div>
              <h3>{{ 'TRIP.DROPPING_POINTS' | translate }}</h3>
              <ul class="stop-list">
                @for (s of dropping(); track s.name) {
                  <li><strong>{{ at(s) | appDate: 'time' }}</strong> {{ s.name }}</li>
                }
              </ul>
            </div>
          </div>
          @if (via().length) {
            <h3>{{ 'TRIP.ROUTE_STOPS' | translate }}</h3>
            <ol class="timeline">
              <li><span>{{ d.trip.departureTime | appDate: 'time' }}</span> {{ d.route.from | city }}</li>
              @for (s of via(); track s.name) {
                <li><span>{{ at(s) | appDate: 'time' }}</span> {{ s.name }}</li>
              }
              <li><span>{{ d.trip.arrivalTime | appDate: 'time' }}</span> {{ d.route.to | city }}</li>
            </ol>
          }
        }
        @case ('bus') {
          <dl class="kv">
            <dt>{{ 'TRIP.OPERATOR' | translate }}</dt>
            <dd>{{ d.operator.name }}</dd>
            <dt>{{ 'TRIP.BUS' | translate }}</dt>
            <dd>{{ d.bus.name }}</dd>
            <dt>{{ 'TRIP.TYPE' | translate }}</dt>
            <dd>{{ (d.bus.ac ? 'BUS.AC' : 'BUS.NONAC') | translate }} · {{ 'BUS.TYPE.' + d.bus.type | translate }}</dd>
            <dt>{{ 'TRIP.SEATS' | translate }}</dt>
            <dd>{{ 'TRIP.SEATS_OF' | translate: { free: (d.trip.seatsAvailable | num), total: (d.bus.totalSeats | num) } }}</dd>
            <dt>{{ 'TRIP.DISTANCE' | translate }}</dt>
            <dd>{{ 'TRIP.KM' | translate: { km: (d.route.distanceKm | num) } }}</dd>
            <dt>{{ 'REVIEWS.ROUTE_RATING' | translate }}</dt>
            <dd><app-route-rating [routeId]="d.route.id" [avg]="d.route.ratingAvg" [count]="d.route.ratingCount" /></dd>
          </dl>
          <h3>{{ 'TRIP.AMENITIES' | translate }}</h3>
          <div class="tag-list">
            @for (a of d.bus.amenities; track a) {
              <span class="badge">{{ 'AMENITY.' + a | translate }}</span>
            } @empty {
              <span class="muted small">{{ 'TRIP.NO_AMENITIES' | translate }}</span>
            }
          </div>
        }
        @case ('policy') {
          <ul class="policy">
            @for (row of policyRows(); track $index) {
              <li>
                <span>{{ row.key | translate: row.params }}</span>
                <strong>{{ (row.percent ? 'TRIP.POLICY_REFUND' : 'TRIP.POLICY_NO_REFUND') | translate: { p: row.percent } }}</strong>
              </li>
            }
          </ul>
          <p class="muted small">{{ 'TRIP.POLICY_NOTE' | translate }}</p>
        }
      }
    } @else {
      <div class="skeleton details-skeleton"></div>
    }
  `,
  styles: `
    :host { display: block; }
    .tabs { margin-bottom: 1rem; }
    h3 { margin: 0 0 0.5rem; font-size: 0.9rem; }
    .points { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 0.75rem; }
    .stop-list { list-style: none; margin: 0; padding: 0; font-size: 0.9rem; }
    .stop-list li { padding: 0.25rem 0; }
    .stop-list strong { display: inline-block; min-width: 4.5rem; }
    .timeline { margin: 0; padding-left: 1.1rem; font-size: 0.9rem; }
    .timeline li { padding: 0.2rem 0; }
    .timeline span { display: inline-block; min-width: 4.5rem; color: var(--color-text-muted); }
    .kv { margin-bottom: 1rem; }
    .tag-list { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .policy { list-style: none; margin: 0 0 0.5rem; padding: 0; font-size: 0.9rem; }
    .policy li { display: flex; justify-content: space-between; gap: 1rem; padding: 0.4rem 0; border-bottom: 1px dashed var(--color-border); }
    .details-skeleton { height: 120px; border-radius: var(--radius-sm); }
    @media (max-width: 600px) { .points { grid-template-columns: 1fr; } }
  `,
})
export class TripDetailsPanel {
  readonly tripId = input.required<string>();
  /** Already-loaded trip data (skips the request), e.g. on the seat selection page. */
  readonly details = input<TripDetails | null>(null);

  private readonly api = inject(ApiService);
  protected readonly tabs: Tab[] = ['points', 'bus', 'policy'];
  protected readonly tab = signal<Tab>('points');
  protected readonly data = signal<TripDetails | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly boarding = computed(() => this.stops('boarding'));
  protected readonly via = computed(() => this.stops('via'));
  protected readonly dropping = computed(() => this.stops('dropping'));
  protected readonly policyRows = computed(() => {
    const tiers = this.data()?.policy.refund ?? [];
    return tiers.map((p, i) => {
      const prev = tiers[i - 1]?.minHours;
      if (i === 0) return { key: 'TRIP.POLICY_MORE_THAN', params: { h: p.minHours }, percent: p.percent };
      if (p.minHours > 0) return { key: 'TRIP.POLICY_BETWEEN', params: { h: p.minHours, max: prev }, percent: p.percent };
      return { key: 'TRIP.POLICY_LESS_THAN', params: { h: prev }, percent: p.percent };
    });
  });

  constructor() {
    effect(() => {
      const id = this.tripId();
      const given = this.details();
      if (given) this.data.set(given);
      else untracked(() => this.load(id));
    });
  }

  private stops(type: Stop['type']): Stop[] {
    return this.data()?.route.stops.filter((s) => s.type === type) ?? [];
  }

  protected at(stop: Stop): string {
    const dep = this.data()?.trip.departureTime;
    return dep ? new Date(new Date(dep).getTime() + stop.offsetMinutes * 60_000).toISOString() : '';
  }

  private async load(id: string): Promise<void> {
    this.data.set(null);
    this.error.set(null);
    try {
      this.data.set(await this.api.trip(id));
    } catch (err) {
      this.error.set(errorKey(err));
    }
  }
}
