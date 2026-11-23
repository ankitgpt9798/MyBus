import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { AppNotification, DeliveryStatus, NotificationType } from '../../core/models';
import { NotificationService } from '../../core/notification.service';
import { Icon } from '../../shared/icons';
import { NotificationText } from '../../shared/notification-text';
import { AppDatePipe, NumPipe } from '../../shared/pipes';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';

const PAGE_SIZE = 15;
const FILTERS: { type: NotificationType | ''; key: string }[] = [
  { type: '', key: 'NOTIFY.HISTORY.ALL' },
  { type: 'booking_confirmed', key: 'NOTIFY.HISTORY.BOOKINGS' },
  { type: 'booking_cancelled', key: 'NOTIFY.HISTORY.CANCELLATIONS' },
  { type: 'schedule_changed', key: 'NOTIFY.HISTORY.SCHEDULE' },
  { type: 'journey_reminder', key: 'NOTIFY.HISTORY.REMINDERS' },
  { type: 'promotion', key: 'NOTIFY.HISTORY.OFFERS' },
];
const STATUS_BADGE: Record<DeliveryStatus, string> = { sent: 'badge-success', pending: 'badge-info', failed: 'badge-danger', skipped: '' };

/** Notification history: everything the user received, rendered in the current UI language from stored params. */
@Component({
  selector: 'app-notifications-page',
  imports: [RouterLink, TranslatePipe, Icon, NotificationText, AppDatePipe, NumPipe, TranslateOrPipe],
  template: `
    <div class="container section narrow">
      <div class="page-head">
        <div>
          <h1 class="page-title">{{ 'NOTIFY.HISTORY.TITLE' | translate }}</h1>
          <p class="muted small unread-line">{{ 'NOTIFY.HISTORY.UNREAD_COUNT' | translate: { count: (notifications.unread() | num) } }}</p>
        </div>
        <button type="button" class="btn btn-outline btn-sm mark-all" [disabled]="!notifications.unread() || busy()" (click)="markAll()">
          {{ 'NOTIFY.MARK_ALL_READ' | translate }}
        </button>
      </div>

      <div class="filters" role="group" [attr.aria-label]="'NOTIFY.HISTORY.FILTER' | translate">
        <div class="chips">
          @for (f of filters; track f.type) {
            <button type="button" class="chip" [class.active]="type() === f.type" [attr.aria-pressed]="type() === f.type" [attr.data-type]="f.type || 'all'" (click)="setType(f.type)">
              {{ f.key | translate }}
            </button>
          }
        </div>
        <label class="check unread-only">
          <input type="checkbox" [checked]="unreadOnly()" (change)="setUnread($any($event.target).checked)" />
          {{ 'NOTIFY.HISTORY.UNREAD_ONLY' | translate }}
        </label>
      </div>

      @if (error(); as e) {
        <div class="alert alert-error" role="alert">{{ e | translateOr: 'ERRORS.GENERIC' }}</div>
      }

      @if (items().length) {
        <ul class="history" [class.dim]="loading()">
          @for (n of items(); track n.id) {
            <li class="card item" [class.unread]="!n.read" [attr.data-id]="n.id" [attr.data-type]="n.type">
              <span class="dot" [attr.aria-label]="n.read ? null : ('NOTIFY.UNREAD' | translate)"></span>
              <div class="content">
                <app-notification-text [n]="n" />
                <div class="meta">
                  <time class="small muted" [attr.datetime]="n.createdAt">{{ n.createdAt | appDate: 'datetime' }}</time>
                  <span class="deliveries">
                    @for (d of n.deliveries; track d.channel) {
                      <span [class]="'badge delivery ' + badge(d.status)" [attr.data-channel]="d.channel"
                        [title]="d.skipReason ? ('NOTIFY.SKIP.' + d.skipReason | translate) : ''">
                        {{ 'NOTIFY.CHANNEL.' + d.channel | translate }}: {{ 'NOTIFY.STATUS.' + d.status | translate }}
                      </span>
                    }
                  </span>
                </div>
                <div class="actions">
                  @if (n.bookingId) {
                    <a class="btn btn-sm btn-ghost view-booking" [routerLink]="['/bookings', n.bookingId]" (click)="markRead(n)">
                      <app-icon name="ticket" [size]="16" /> {{ 'NOTIFY.HISTORY.VIEW_BOOKING' | translate }}
                    </a>
                  }
                  @if (!n.read) {
                    <button type="button" class="btn btn-sm btn-ghost mark-read" (click)="markRead(n)">
                      <app-icon name="check" [size]="16" /> {{ 'NOTIFY.HISTORY.MARK_READ' | translate }}
                    </button>
                  }
                </div>
              </div>
            </li>
          }
        </ul>
        <div class="more">
          <p class="small muted">{{ 'NOTIFY.HISTORY.SHOWING' | translate: { shown: (items().length | num), total: (total() | num) } }}</p>
          @if (items().length < total()) {
            <button type="button" class="btn btn-outline load-more" [disabled]="loading()" (click)="loadMore()">
              {{ (loading() ? 'COMMON.PLEASE_WAIT' : 'NOTIFY.HISTORY.LOAD_MORE') | translate }}
            </button>
          }
        </div>
      } @else if (!loading()) {
        <div class="card empty-state">
          <app-icon name="bell" [size]="40" />
          @if (filtered()) {
            <h2>{{ 'NOTIFY.HISTORY.NONE_MATCH' | translate }}</h2>
            <button type="button" class="btn btn-outline clear-filters" (click)="clearFilters()">{{ 'NOTIFY.HISTORY.CLEAR_FILTERS' | translate }}</button>
          } @else {
            <h2>{{ 'NOTIFY.HISTORY.EMPTY_TITLE' | translate }}</h2>
            <p>{{ 'NOTIFY.HISTORY.EMPTY_TEXT' | translate }}</p>
            <a routerLink="/" class="btn btn-primary">{{ 'NOTIFY.HISTORY.FIND_BUSES' | translate }}</a>
          }
        </div>
      } @else {
        <div class="card skeleton loading-card"></div>
      }
    </div>
  `,
  styles: `
    .page-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
    .page-head .page-title { margin-bottom: 0.15rem; }
    .unread-line { margin: 0 0 1rem; }
    .filters { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 1rem; }
    .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .history { display: grid; gap: 0.6rem; margin: 0; padding: 0; list-style: none; }
    .history.dim { opacity: 0.6; }
    .item { display: flex; gap: 0.75rem; padding: 0.9rem 1rem; }
    .item.unread { border-color: var(--color-primary); background: var(--color-primary-soft); }
    .dot { flex: none; width: 9px; height: 9px; margin-top: 0.45rem; border-radius: 50%; }
    .item.unread .dot { background: var(--color-primary); }
    .content { display: flex; flex-direction: column; gap: 0.45rem; min-width: 0; flex: 1; }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.75rem; }
    .deliveries { display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .delivery { font-weight: 500; }
    .actions { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-left: -0.6rem; }
    .actions .btn { min-height: 32px; }
    .more { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; margin-top: 1rem; }
    .more p { margin: 0; }
    .loading-card { height: 120px; }
  `,
})
export class NotificationsPage implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly notifications = inject(NotificationService);
  protected readonly filters = FILTERS;

  protected readonly type = signal<NotificationType | ''>('');
  protected readonly unreadOnly = signal(false);
  protected readonly items = signal<AppNotification[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly filtered = computed(() => !!this.type() || this.unreadOnly());

  constructor() {
    // New notifications arrive live; read state is synced from the user's other tabs.
    this.notifications.events.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((e) => {
      if (e.kind === 'notification') {
        const n = e.notification;
        if ((this.type() && n.type !== this.type()) || this.items().some((x) => x.id === n.id)) return;
        this.items.update((list) => [n, ...list]);
        this.total.update((t) => t + 1);
      } else if (e.unread === 0) {
        this.items.update((list) => (this.unreadOnly() ? [] : list.map((x) => ({ ...x, read: true }))));
        if (this.unreadOnly()) this.total.set(0);
      }
    });
  }

  ngOnInit(): void {
    void this.load(1);
  }

  protected async load(page: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.notifications(page, PAGE_SIZE, { type: this.type(), unread: this.unreadOnly() });
      this.items.update((list) => (page === 1 ? res.notifications : [...list, ...res.notifications.filter((n) => !list.some((x) => x.id === n.id))]));
      this.total.set(res.total);
      this.page.set(page);
      this.notifications.unread.set(res.unread);
    } catch (err) {
      this.error.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected loadMore(): void {
    void this.load(this.page() + 1);
  }

  protected setType(type: NotificationType | ''): void {
    if (type === this.type()) return;
    this.type.set(type);
    void this.load(1);
  }

  protected setUnread(on: boolean): void {
    this.unreadOnly.set(on);
    void this.load(1);
  }

  protected clearFilters(): void {
    this.type.set('');
    this.unreadOnly.set(false);
    void this.load(1);
  }

  protected async markRead(n: AppNotification): Promise<void> {
    if (n.read) return;
    try {
      await this.notifications.markRead(n);
      this.items.update((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    } catch (err) {
      this.error.set(errorKey(err));
    }
  }

  protected async markAll(): Promise<void> {
    this.busy.set(true);
    try {
      await this.notifications.markAllRead();
      if (this.unreadOnly()) {
        this.items.set([]);
        this.total.set(0);
      } else {
        this.items.update((list) => list.map((x) => ({ ...x, read: true })));
      }
    } catch (err) {
      this.error.set(errorKey(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected badge(status: DeliveryStatus): string {
    return STATUS_BADGE[status];
  }
}
