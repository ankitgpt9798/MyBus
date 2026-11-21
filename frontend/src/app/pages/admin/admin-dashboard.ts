import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { AdminStats, BookingStatus } from '../../core/models';
import { InrPipe, NumPipe } from '../../shared/pipes';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';

@Component({
  selector: 'app-admin-dashboard',
  imports: [RouterLink, TranslatePipe, InrPipe, NumPipe, TranslateOrPipe],
  template: `
    @if (error(); as e) {
      <div class="alert alert-error">{{ e | translateOr: 'ERRORS.GENERIC' }}</div>
    } @else if (stats(); as s) {
      <div class="stat-grid">
        <div class="card stat"><span class="muted small">{{ 'ADMIN.STAT_USERS' | translate }}</span><strong>{{ s.users | num }}</strong></div>
        <div class="card stat"><span class="muted small">{{ 'ADMIN.STAT_UPCOMING_TRIPS' | translate }}</span><strong>{{ s.upcomingTrips | num }}</strong></div>
        <div class="card stat"><span class="muted small">{{ 'ADMIN.STAT_REVENUE' | translate }}</span><strong>{{ s.revenue | inr }}</strong></div>
      </div>
      <h2 class="section-title">{{ 'ADMIN.BOOKINGS_BY_STATUS' | translate }}</h2>
      <div class="stat-grid">
        @for (st of statuses; track st) {
          <a class="card stat link-card" routerLink="/admin/bookings" [queryParams]="{ status: st }">
            <span class="muted small">{{ 'BOOKING.STATUS.' + st.toUpperCase() | translate }}</span>
            <strong>{{ s.bookings[st] | num }}</strong>
          </a>
        }
      </div>
    } @else {
      <div class="card skeleton" style="height: 160px"></div>
    }
  `,
  styles: `
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .stat { display: flex; flex-direction: column; gap: 0.3rem; }
    .stat strong { font-size: 1.6rem; }
    .link-card { color: var(--color-text); text-decoration: none; }
    .link-card:hover { box-shadow: var(--shadow-md); }
  `,
})
export class AdminDashboardPage implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly stats = signal<AdminStats | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly statuses: BookingStatus[] = ['confirmed', 'pending', 'completed', 'cancelled', 'expired'];

  async ngOnInit(): Promise<void> {
    try {
      this.stats.set(await this.api.adminStats());
    } catch (err) {
      this.error.set(errorKey(err));
    }
  }
}
