import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { Booking } from '../../core/models';
import { Icon } from '../../shared/icons';
import { AppDatePipe, CityPipe, InrPipe } from '../../shared/pipes';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';
import { statusBadge } from './status-badge';

type Tab = 'upcoming' | 'completed' | 'cancelled';
const TABS: Tab[] = ['upcoming', 'completed', 'cancelled'];

@Component({
  selector: 'app-my-bookings',
  imports: [RouterLink, TranslatePipe, Icon, AppDatePipe, CityPipe, InrPipe, TranslateOrPipe],
  template: `
    <div class="container section narrow">
      <h1 class="page-title">{{ 'NAV.MY_BOOKINGS' | translate }}</h1>
      <div class="tabs" role="tablist">
        @for (t of tabs; track t) {
          <button type="button" role="tab" class="tab" [class.active]="current() === t" [attr.aria-selected]="current() === t" (click)="select(t)">
            {{ 'BOOKINGS.TABS.' + t.toUpperCase() | translate }}
          </button>
        }
      </div>

      @if (error(); as e) {
        <div class="alert alert-error">{{ e | translateOr: 'ERRORS.GENERIC' }}</div>
      } @else if (loading()) {
        @for (i of [1, 2]; track i) {
          <div class="card skeleton list-skeleton"></div>
        }
      } @else if (!bookings().length) {
        <div class="empty-state card">
          <app-icon name="ticket" [size]="40" />
          <h2>{{ 'BOOKINGS.EMPTY.' + current().toUpperCase() | translate }}</h2>
          <a routerLink="/" class="btn btn-primary">{{ 'BOOKINGS.BOOK_NOW' | translate }}</a>
        </div>
      } @else {
        <div class="booking-list">
          @for (b of bookings(); track b.id) {
            <a class="booking-card card" [routerLink]="['/bookings', b.id]">
              <div class="bc-main">
                <div class="bc-route">
                  <strong>{{ b.journey.from | city }}</strong>
                  <app-icon name="chevron-right" [size]="16" />
                  <strong>{{ b.journey.to | city }}</strong>
                </div>
                <div class="muted small">{{ b.journey.departureTime | appDate: 'datetime' }} · {{ b.journey.operatorName }}</div>
                <div class="small">
                  {{ 'TRIP.SEATS' | translate }}: {{ b.seats.join(', ') }}
                  @if (b.pnr) {
                    · {{ 'BOOKING.PNR' | translate }} <strong class="pnr">{{ b.pnr }}</strong>
                  }
                </div>
                @if (b.status === 'pending') {
                  <span class="small text-warning">{{ 'BOOKING.PENDING_NOTE' | translate }}</span>
                }
              </div>
              <div class="bc-side">
                <span [class]="'badge ' + badge(b)">{{ 'BOOKING.STATUS.' + b.status.toUpperCase() | translate }}</span>
                <strong>{{ b.totalAmount | inr }}</strong>
              </div>
            </a>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .booking-list { display: grid; gap: 0.9rem; }
    .booking-card { display: flex; justify-content: space-between; gap: 1rem; color: var(--color-text); text-decoration: none; }
    .booking-card:hover { box-shadow: var(--shadow-md); }
    .bc-main { display: grid; gap: 0.3rem; min-width: 0; }
    .bc-route { display: flex; align-items: center; gap: 0.3rem; font-size: 1.05rem; }
    .bc-side { display: flex; flex-direction: column; align-items: flex-end; justify-content: space-between; gap: 0.5rem; }
    .list-skeleton { height: 110px; margin-bottom: 1rem; }
  `,
})
export class MyBookingsPage {
  /** ?tab=upcoming|completed|cancelled */
  readonly tab = input<string | undefined>(undefined);

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly tabs = TABS;
  protected readonly current = signal<Tab>('upcoming');
  protected readonly bookings = signal<Booking[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly badge = (b: Booking) => statusBadge(b.status);

  constructor() {
    effect(() => {
      const t = this.tab();
      const tab = TABS.includes(t as Tab) ? (t as Tab) : 'upcoming';
      this.current.set(tab);
      untracked(() => this.load(tab));
    });
  }

  protected select(tab: Tab): void {
    this.router.navigate([], { queryParams: { tab }, replaceUrl: true });
  }

  private async load(tab: Tab): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.bookings.set((await this.api.myBookings(tab)).bookings);
    } catch (err) {
      this.error.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }
}
