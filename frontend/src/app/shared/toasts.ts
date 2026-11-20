import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ToastService } from '../core/toast.service';
import { Icon } from './icons';

@Component({
  selector: 'app-toasts',
  imports: [TranslatePipe, Icon],
  template: `
    <div class="toasts" aria-live="polite">
      @for (t of toast.toasts(); track t.id) {
        <div [class]="'toast toast-' + t.kind" role="status">
          <app-icon [name]="t.kind === 'error' ? 'alert' : 'check'" [size]="18" />
          <span>{{ t.key | translate: t.params }}</span>
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
