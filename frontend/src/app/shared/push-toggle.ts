import { Component, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PushService } from '../core/push.service';
import { ToastService } from '../core/toast.service';

/** Enable / turn off web push for this browser. Permission is requested only when the user clicks. */
@Component({
  selector: 'app-push-toggle',
  imports: [TranslatePipe],
  template: `
    <div class="push-toggle" [class.compact]="compact()" [attr.data-push-state]="push.state()">
      @switch (push.state()) {
        @case ('unsupported') {
          <p class="note">{{ 'NOTIFY.PUSH.UNSUPPORTED' | translate }}</p>
        }
        @case ('denied') {
          <p class="note warn">{{ 'NOTIFY.PUSH.DENIED' | translate }}</p>
        }
        @case ('on') {
          <p class="note ok">{{ 'NOTIFY.PUSH.ON' | translate }}</p>
          <button type="button" class="btn btn-sm btn-outline" (click)="disable()">{{ 'NOTIFY.PUSH.DISABLE' | translate }}</button>
        }
        @default {
          @if (!compact()) {
            <p class="note">{{ 'NOTIFY.PUSH.HINT' | translate }}</p>
          }
          <button type="button" class="btn btn-sm btn-primary" [disabled]="push.state() === 'busy'" (click)="enable()">
            {{ (push.state() === 'busy' ? 'COMMON.PLEASE_WAIT' : 'NOTIFY.PUSH.ENABLE') | translate }}
          </button>
        }
      }
      @if (push.message(); as m) {
        <p class="note warn" role="status">{{ m | translate }}</p>
      }
    </div>
  `,
  styles: `
    .push-toggle { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; }
    .note { flex: 1 1 220px; margin: 0; color: var(--color-text-muted); font-size: 0.88rem; }
    .note.ok { color: var(--color-success); font-weight: 600; }
    .note.warn { flex-basis: 100%; padding: 0.45rem 0.6rem; border-radius: var(--radius-sm, 6px); background: var(--color-warning-soft); color: var(--color-warning); }
    .compact { padding: 0.65rem 0.9rem; }
    .compact .note { font-size: 0.8rem; }
  `,
})
export class PushToggle {
  protected readonly push = inject(PushService);
  private readonly toast = inject(ToastService);
  readonly compact = input(false);

  protected async enable(): Promise<void> {
    if (await this.push.enable()) this.toast.success('NOTIFY.PUSH.ENABLED');
  }

  protected async disable(): Promise<void> {
    await this.push.disable();
    this.toast.show('NOTIFY.PUSH.DISABLED');
  }
}
