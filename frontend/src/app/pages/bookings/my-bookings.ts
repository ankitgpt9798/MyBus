import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { Booking, EligibleJourney, MyReview } from '../../core/models';
import { Icon } from '../../shared/icons';
import { AppDatePipe, CityPipe, InrPipe, NumPipe } from '../../shared/pipes';
import { Stars } from '../../shared/stars';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';
import { statusBadge } from './status-badge';

type Tab = 'upcoming' | 'completed' | 'cancelled';
const TABS: Tab[] = ['upcoming', 'completed', 'cancelled'];

@Component({
  selector: 'app-my-bookings',
  imports: [RouterLink, TranslatePipe, Icon, AppDatePipe, CityPipe, InrPipe, NumPipe, TranslateOrPipe, Stars],
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
            <div class="booking-item card" [attr.data-booking]="b.id">
            <a class="booking-card" [routerLink]="['/bookings', b.id]">
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
            @if (b.status === 'completed') {
              <div class="review-row">
                @if (reviewFor(b.id); as r) {
                  <span class="small your-review">{{ 'REVIEWS.YOUR_REVIEW' | translate }}</span>
                  <app-stars [value]="r.rating" [size]="15" />
                  @if (r.status !== 'visible') {
                    <span class="badge badge-warning">{{ 'REVIEWS.STATUS.' + r.status | translate }}</span>
                  }
                  @if (r.editable) {
                    <a class="btn btn-sm btn-outline edit-review" [routerLink]="['/reviews', r.id, 'edit']">{{ 'REVIEWS.EDIT_LEFT' | translate: { h: (hoursLeft(r) | num) } }}</a>
                  } @else {
                    <span class="badge locked">{{ 'REVIEWS.LOCKED' | translate }}</span>
                  }
                  <a class="btn btn-sm btn-ghost" [routerLink]="['/routes', r.routeId]" fragment="reviews">{{ 'REVIEWS.SEE_ROUTE' | translate }}</a>
                } @else if (isEligible(b.id)) {
                  <span class="small muted">{{ 'REVIEWS.RATE_PROMPT' | translate }}</span>
                  <a class="btn btn-sm btn-primary rate-btn" [routerLink]="['/reviews/new']" [queryParams]="{ booking: b.id }">
                    <app-icon name="star" [size]="14" /> {{ 'REVIEWS.RATE' | translate }}
                  </a>
                }
              </div>
            }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .booking-list { display: grid; gap: 0.9rem; }
    .booking-item { padding: 0; overflow: hidden; }
    .booking-item:hover { box-shadow: var(--shadow-md); }
    .booking-card { display: flex; justify-content: space-between; gap: 1rem; padding: 1.25rem; color: var(--color-text); text-decoration: none; }
    .review-row {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem 0.6rem;
      padding: 0.65rem 1.25rem; border-top: 1px solid var(--color-border); background: var(--color-surface-2);
    }
    .your-review { font-weight: 600; }
    .rate-btn { margin-left: auto; }
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
  /** Completed tab: journeys that can be reviewed and the user's existing reviews. */
  private readonly eligible = signal<EligibleJourney[]>([]);
  private readonly myReviews = signal<MyReview[]>([]);

  protected isEligible(bookingId: string): boolean {
    return this.eligible().some((e) => e.bookingId === bookingId);
  }

  protected reviewFor(bookingId: string): MyReview | undefined {
    return this.myReviews().find((r) => r.bookingId === bookingId);
  }

  protected hoursLeft(r: MyReview): number {
    return Math.max(1, Math.ceil(r.editMsLeft / 3_600_000));
  }

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
      const [list, reviews] = await Promise.all([
        this.api.myBookings(tab),
        tab === 'completed' ? this.api.eligibleReviews().catch(() => ({ eligible: [], reviews: [] })) : null,
      ]);
      this.bookings.set(list.bookings);
      this.eligible.set(reviews?.eligible ?? []);
      this.myReviews.set(reviews?.reviews ?? []);
    } catch (err) {
      this.error.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }
}
