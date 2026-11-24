import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { Booking, BookingStatus } from '../../core/models';
import { AppDatePipe, CityPipe, InrPipe, NumPipe } from '../../shared/pipes';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';
import { statusBadge } from '../bookings/status-badge';
import { PluralPipe } from '../../shared/plural.pipe';

const STATUSES: BookingStatus[] = ['pending', 'confirmed', 'completed', 'cancelled', 'expired'];

/** Bookings overview. Search (PNR, user name or email) and status live in the URL. */
@Component({
  selector: 'app-admin-bookings',
  imports: [FormsModule, RouterLink, TranslatePipe, AppDatePipe, CityPipe, InrPipe, NumPipe, TranslateOrPipe, PluralPipe],
  template: `
    <form class="card filter-bar" (ngSubmit)="search()">
      <div class="form-field">
        <label for="b-q">{{ 'ADMIN.SEARCH_BOOKINGS' | translate }}</label>
        <input id="b-q" name="q" [(ngModel)]="query" [placeholder]="'ADMIN.SEARCH_PLACEHOLDER' | translate" />
      </div>
      <div class="form-field">
        <label for="b-status">{{ 'ADMIN.STATUS' | translate }}</label>
        <select id="b-status" name="status" [(ngModel)]="statusFilter">
          <option value="">{{ 'ADMIN.ALL' | translate }}</option>
          @for (s of statuses; track s) {
            <option [value]="s">{{ 'BOOKING.STATUS.' + s.toUpperCase() | translate }}</option>
          }
        </select>
      </div>
      <div class="filter-actions">
        <button type="submit" class="btn btn-primary">{{ 'ADMIN.APPLY' | translate }}</button>
      </div>
    </form>

    @if (error(); as e) {
      <div class="alert alert-error">{{ e | translateOr: 'ERRORS.GENERIC' }}</div>
    }
    <div class="card table-card" [class.dim]="loading()">
      <p class="muted small">{{ 'ADMIN.BOOKINGS_FOUND' | plural: total() : { count: (total() | num) } }}</p>
      @if (bookings().length) {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>{{ 'BOOKING.PNR' | translate }}</th>
                <th>{{ 'ADMIN.CUSTOMER' | translate }}</th>
                <th>{{ 'ADMIN.ROUTE' | translate }}</th>
                <th>{{ 'ADMIN.DEPARTURE' | translate }}</th>
                <th>{{ 'ADMIN.SEATS' | translate }}</th>
                <th>{{ 'ADMIN.AMOUNT' | translate }}</th>
                <th>{{ 'ADMIN.STATUS' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (b of bookings(); track b.id) {
                <tr>
                  <td><a [routerLink]="['/bookings', b.id]">{{ b.pnr ?? '—' }}</a></td>
                  <td>{{ b.user?.name }}<div class="muted small">{{ b.user?.email }}</div></td>
                  <td>{{ b.journey.from | city }} → {{ b.journey.to | city }}</td>
                  <td>{{ b.journey.departureTime | appDate: 'datetime' }}</td>
                  <td>{{ b.seats.join(', ') }}</td>
                  <td>{{ b.totalAmount | inr }}</td>
                  <td><span [class]="'badge ' + badge(b)">{{ 'BOOKING.STATUS.' + b.status.toUpperCase() | translate }}</span></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="pager">
          <button type="button" class="btn btn-sm btn-outline" [disabled]="page() <= 1" (click)="goTo(page() - 1)">{{ 'ADMIN.PREV' | translate }}</button>
          <span class="small">{{ 'ADMIN.PAGE_OF' | translate: { page: page(), pages: pages() } }}</span>
          <button type="button" class="btn btn-sm btn-outline" [disabled]="page() >= pages()" (click)="goTo(page() + 1)">{{ 'ADMIN.NEXT' | translate }}</button>
        </div>
      } @else if (!loading()) {
        <p class="empty-row">{{ 'ADMIN.NO_BOOKINGS' | translate }}</p>
      }
    </div>
  `,
  styleUrl: './admin.scss',
})
export class AdminBookingsPage {
  readonly q = input<string | undefined>(undefined);
  readonly status = input<string | undefined>(undefined);

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly statuses = STATUSES;
  protected readonly bookings = signal<Booking[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly limit = 20;
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.limit)));
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly badge = (b: Booking) => statusBadge(b.status);
  protected query = '';
  protected statusFilter = '';

  constructor() {
    effect(() => {
      const q = this.q() ?? '';
      const status = STATUSES.includes(this.status() as BookingStatus) ? this.status()! : '';
      untracked(() => {
        this.query = q;
        this.statusFilter = status;
        this.load(1);
      });
    });
  }

  protected search(): void {
    this.router.navigate([], { queryParams: { q: this.query.trim() || null, status: this.statusFilter || null }, replaceUrl: true });
  }

  protected goTo(page: number): void {
    this.load(page);
  }

  private async load(page: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const status = STATUSES.includes(this.status() as BookingStatus) ? this.status() : undefined;
      const res = await this.api.adminBookings({ q: this.q(), status, page, limit: this.limit });
      this.bookings.set(res.bookings);
      this.total.set(res.total);
      this.page.set(res.page);
    } catch (err) {
      this.error.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }
}
