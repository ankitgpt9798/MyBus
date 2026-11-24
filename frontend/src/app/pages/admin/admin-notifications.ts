import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { AdminNotification, DeliveryLog, DeliveryStatus, NotificationChannel, NotificationType } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { AppDatePipe, NumPipe } from '../../shared/pipes';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';
import { PluralPipe } from '../../shared/plural.pipe';

const STATUS_BADGE: Record<DeliveryStatus, string> = {
  sent: 'badge-success',
  pending: 'badge-info',
  failed: 'badge-danger',
  skipped: 'badge',
};

/** Delivery log: every notification with its per-channel status, attempts and last error. */
@Component({
  selector: 'app-admin-notifications',
  imports: [ReactiveFormsModule, TranslatePipe, AppDatePipe, NumPipe, TranslateOrPipe, PluralPipe],
  template: `
    <form class="card filter-bar" [formGroup]="filters" (ngSubmit)="load(1)">
      <div class="form-field">
        <label for="n-type">{{ 'ADMIN.TYPE' | translate }}</label>
        <select id="n-type" formControlName="type">
          <option value="">{{ 'ADMIN.ALL_TYPES' | translate }}</option>
          @for (t of types; track t) {
            <option [value]="t">{{ 'NOTIFY.TYPES.' + t | translate }}</option>
          }
        </select>
      </div>
      <div class="form-field">
        <label for="n-channel">{{ 'ADMIN.CHANNEL' | translate }}</label>
        <select id="n-channel" formControlName="channel">
          <option value="">{{ 'ADMIN.ALL_CHANNELS' | translate }}</option>
          @for (c of channels; track c) {
            <option [value]="c">{{ 'NOTIFY.CHANNEL.' + c | translate }}</option>
          }
        </select>
      </div>
      <div class="form-field">
        <label for="n-status">{{ 'ADMIN.STATUS' | translate }}</label>
        <select id="n-status" formControlName="status">
          <option value="">{{ 'ADMIN.ALL' | translate }}</option>
          @for (s of statuses; track s) {
            <option [value]="s">{{ 'NOTIFY.STATUS.' + s | translate }}</option>
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
      <p class="muted small">{{ 'ADMIN.NOTIFICATIONS_FOUND' | plural: total() : { count: (total() | num) } }}</p>
      @if (items().length) {
        <div class="table-wrap">
          <table class="table notif-table">
            <thead>
              <tr>
                <th>{{ 'ADMIN.TIME' | translate }}</th>
                <th>{{ 'ADMIN.CUSTOMER' | translate }}</th>
                <th>{{ 'ADMIN.TYPE' | translate }}</th>
                @for (c of channels; track c) {
                  <th>{{ 'NOTIFY.CHANNEL.' + c | translate }}</th>
                }
                <th>{{ 'ADMIN.ACTIONS' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (n of items(); track n.id) {
                <tr [attr.data-notification]="n.id">
                  <td class="nowrap">{{ n.createdAt | appDate: 'datetime' }}</td>
                  <td>{{ n.user?.name }}<div class="muted small">{{ n.emailTo ?? n.user?.email }}</div></td>
                  <td>
                    {{ 'NOTIFY.TYPES.' + n.type | translate }}
                    @if (n.pnr) {
                      <div class="muted small">PNR {{ n.pnr }}</div>
                    }
                  </td>
                  @for (c of channels; track c) {
                    <td [attr.data-channel]="c">
                      @if (delivery(n, c); as d) {
                        <span [class]="'badge ' + badge(d.status)">{{ 'NOTIFY.STATUS.' + d.status | translate }}</span>
                        @if (d.attempts) {
                          <div class="muted small">{{ 'NOTIFY.ATTEMPTS' | plural: d.attempts : { n: d.attempts } }}</div>
                        }
                        @if (d.skipReason) {
                          <div class="muted small">{{ 'NOTIFY.SKIP.' + d.skipReason | translate }}</div>
                        }
                        @if (d.lastError) {
                          <div class="error-text small" [title]="d.lastError">{{ d.lastError }}</div>
                        }
                        @if (d.status === 'failed') {
                          @if (d.gaveUp) {
                            <div class="small gave-up">{{ 'NOTIFY.GAVE_UP' | translate }}</div>
                          } @else if (d.nextAttemptAt) {
                            <div class="muted small next-retry">{{ 'NOTIFY.NEXT_RETRY' | translate: { time: (d.nextAttemptAt | appDate: 'datetime') } }}</div>
                          }
                        }
                      }
                    </td>
                  }
                  <td>
                    @if (canRetry(n)) {
                      <button type="button" class="btn btn-sm btn-outline retry-btn" [disabled]="retrying() === n.id" (click)="retry(n)">
                        {{ (retrying() === n.id ? 'COMMON.PLEASE_WAIT' : 'ADMIN.RETRY_NOW') | translate }}
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="pager">
          <button type="button" class="btn btn-sm btn-outline" [disabled]="page() <= 1" (click)="load(page() - 1)">{{ 'ADMIN.PREV' | translate }}</button>
          <span class="small">{{ 'ADMIN.PAGE_OF' | translate: { page: page(), pages: pages() } }}</span>
          <button type="button" class="btn btn-sm btn-outline" [disabled]="page() >= pages()" (click)="load(page() + 1)">{{ 'ADMIN.NEXT' | translate }}</button>
        </div>
      } @else if (!loading()) {
        <p class="empty-row">{{ 'ADMIN.NO_NOTIFICATIONS' | translate }}</p>
      }
    </div>
  `,
  styleUrl: './admin.scss',
  styles: `
    .nowrap { white-space: nowrap; }
    .error-text { max-width: 220px; color: var(--color-danger); overflow-wrap: anywhere; }
    .gave-up { color: var(--color-danger); font-weight: 600; }
    .retry-btn { white-space: nowrap; }
  `,
})
export class AdminNotificationsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly types: NotificationType[] = ['booking_confirmed', 'booking_cancelled', 'schedule_changed', 'journey_reminder', 'promotion'];
  protected readonly channels: NotificationChannel[] = ['in_app', 'email', 'push'];
  protected readonly statuses: DeliveryStatus[] = ['pending', 'sent', 'failed', 'skipped'];
  protected readonly filters = inject(FormBuilder).nonNullable.group({ type: [''], channel: [''], status: [''] });

  protected readonly items = signal<AdminNotification[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly limit = 20;
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.limit)));
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Id of the notification whose retry is running. */
  protected readonly retrying = signal<string | null>(null);

  ngOnInit(): void {
    void this.load(1);
  }

  protected async load(page: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.adminNotifications({ ...this.filters.getRawValue(), page, limit: this.limit });
      this.items.set(res.notifications);
      this.total.set(res.total);
      this.page.set(res.page);
    } catch (err) {
      this.error.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected delivery(n: AdminNotification, channel: NotificationChannel): DeliveryLog | undefined {
    return n.deliveries.find((d) => d.channel === channel);
  }

  protected canRetry(n: AdminNotification): boolean {
    return n.deliveries.some((d) => d.status === 'failed');
  }

  /** Retries the failed deliveries right away (also ones that gave up) and shows the new outcome in place. */
  protected async retry(n: AdminNotification): Promise<void> {
    this.retrying.set(n.id);
    try {
      const { notification } = await this.api.adminRetryNotification(n.id);
      this.items.update((list) => list.map((x) => (x.id === n.id ? notification : x)));
      const ok = !notification.deliveries.some((d) => d.status === 'failed');
      if (ok) this.toast.success('ADMIN.RETRY_SENT');
      else this.toast.error('ADMIN.RETRY_FAILED');
    } catch (err) {
      this.toast.error(errorKey(err));
    } finally {
      this.retrying.set(null);
    }
  }

  protected badge(status: DeliveryStatus): string {
    return STATUS_BADGE[status];
  }
}
