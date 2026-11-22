import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../core/auth.service';
import { AppNotification } from '../core/models';
import { NotificationService } from '../core/notification.service';
import { Icon } from './icons';
import { AppDatePipe, CityPipe, InrPipe } from './pipes';

/**
 * Header bell: unread badge and a panel with the latest notifications.
 * Messages are rendered from their stored params in the current UI language.
 */
@Component({
  selector: 'app-notification-bell',
  imports: [RouterLink, TranslatePipe, Icon, AppDatePipe, CityPipe, InrPipe],
  template: `
    @if (auth.isLoggedIn()) {
      <button type="button" class="icon-btn bell-btn" (click)="toggle()" aria-haspopup="dialog" [attr.aria-expanded]="open()"
        [attr.aria-label]="(notifications.unread() ? 'NOTIFY.BELL_UNREAD' : 'NOTIFY.BELL') | translate: { count: notifications.unread() }"
        [title]="'NOTIFY.BELL' | translate">
        <app-icon name="bell" />
        @if (notifications.unread()) {
          <span class="bell-badge" aria-hidden="true">{{ notifications.unread() > 9 ? '9+' : notifications.unread() }}</span>
        }
      </button>
      @if (open()) {
        <div class="bell-panel" role="dialog" [attr.aria-label]="'NOTIFY.PANEL_TITLE' | translate">
          <div class="bell-head">
            <strong>{{ 'NOTIFY.PANEL_TITLE' | translate }}</strong>
            @if (notifications.unread()) {
              <button type="button" class="link mark-all" (click)="markAll()">{{ 'NOTIFY.MARK_ALL_READ' | translate }}</button>
            }
          </div>
          <div class="bell-list">
            @for (n of notifications.latest(); track n.id) {
              <button type="button" class="bell-item" [class.unread]="!n.read" (click)="openItem(n)">
                <span class="dot" [attr.aria-label]="n.read ? null : ('NOTIFY.UNREAD' | translate)"></span>
                <span class="text">
                  <strong>{{ 'NOTIFY.TYPES.' + n.type | translate }}</strong>
                  <span class="body">
                    @if (n.type === 'promotion') {
                      {{ n.body }}
                    } @else {
                      {{ bodyKey(n) | translate: {
                        route: (n.params.from | city) + ' → ' + (n.params.to | city),
                        date: (n.params.departureTime | appDate: 'datetime'),
                        pnr: n.pnr,
                        refund: (n.params.refundAmount | inr)
                      } }}
                    }
                  </span>
                  <small>{{ n.createdAt | appDate: 'datetime' }}</small>
                </span>
              </button>
            } @empty {
              <p class="empty">{{ (notifications.loading() ? 'COMMON.PLEASE_WAIT' : 'NOTIFY.EMPTY') | translate }}</p>
            }
          </div>
          <a routerLink="/notifications" class="bell-all">{{ 'NOTIFY.SEE_ALL' | translate }}</a>
        </div>
      }
    } @else {
      <a routerLink="/notifications" class="icon-btn" [attr.aria-label]="'NAV.NOTIFICATIONS' | translate" [title]="'NAV.NOTIFICATIONS' | translate">
        <app-icon name="bell" />
      </a>
    }
  `,
  styleUrl: './notification-bell.scss',
})
export class NotificationBell {
  protected readonly auth = inject(AuthService);
  protected readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly open = signal(false);

  protected toggle(): void {
    this.open.set(!this.open());
    if (this.open()) void this.notifications.loadLatest();
  }

  protected bodyKey(n: AppNotification): string {
    if (n.type === 'booking_cancelled') {
      return n.params.paid && n.params.refundAmount ? 'NOTIFY.BODY.booking_cancelled' : 'NOTIFY.BODY.booking_cancelled_plain';
    }
    return `NOTIFY.BODY.${n.type}`;
  }

  protected async openItem(n: AppNotification): Promise<void> {
    this.open.set(false);
    await this.notifications.markRead(n).catch(() => undefined);
    if (n.bookingId) await this.router.navigate(['/bookings', n.bookingId]);
  }

  protected async markAll(): Promise<void> {
    await this.notifications.markAllRead().catch(() => undefined);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.open.set(false);
  }
}
