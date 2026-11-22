import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ToastService } from '../core/toast.service';
import { Icon } from './icons';
import { NotificationText } from './notification-text';

@Component({
  selector: 'app-toasts',
  imports: [TranslatePipe, Icon, RouterLink, NotificationText],
  template: `
    <div class="toasts" aria-live="polite">
      @for (t of toast.toasts(); track t.id) {
        <div [class]="'toast toast-' + t.kind" role="status" [attr.data-toast]="t.notification ? 'notification' : t.key">
          <app-icon [name]="t.kind === 'error' ? 'alert' : t.notification ? 'bell' : 'check'" [size]="18" />
          @if (t.notification; as n) {
            <span class="sr-only">{{ t.key | translate }}</span>
            @if (n.bookingId) {
              <a class="toast-link" [routerLink]="['/bookings', n.bookingId]" (click)="toast.dismiss(t.id)"><app-notification-text [n]="n" /></a>
            } @else {
              <span><app-notification-text [n]="n" /></span>
            }
          } @else {
            <span>{{ t.key | translate: t.params }}</span>
          }
          <button type="button" (click)="toast.dismiss(t.id)" [attr.aria-label]="'COMMON.CLOSE' | translate">
            <app-icon name="close" [size]="16" />
          </button>
        </div>
      }
    </div>
  `,
})
export class Toasts {
  protected readonly toast = inject(ToastService);
}
