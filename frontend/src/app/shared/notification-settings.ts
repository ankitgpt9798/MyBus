import { Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../core/auth.service';
import { NotificationPreferences } from '../core/models';
import { PushService } from '../core/push.service';
import { ToastService } from '../core/toast.service';

type PrefKey = 'email' | 'inApp' | 'promotional';

/**
 * Notification preferences (profile). Channels: email, push (this browser's subscription) and in-app, plus a
 * separate opt-in for offers (off by default). Each switch saves immediately and applies to new notifications.
 * Booking, schedule and reminder messages always stay in-app; the in-app switch only affects offers.
 */
@Component({
  selector: 'app-notification-settings',
  imports: [TranslatePipe],
  template: `
    <section class="card notif-settings" aria-labelledby="notif-settings-title">
      <h2 class="sub-title" id="notif-settings-title">{{ 'NOTIFY.SETTINGS.TITLE' | translate }}</h2>
      <p class="muted small">{{ 'NOTIFY.SETTINGS.HINT' | translate }}</p>

      <h3 class="group-title">{{ 'NOTIFY.SETTINGS.CHANNELS' | translate }}</h3>
      <div class="pref-row" data-pref="email">
        <div class="pref-text">
          <label for="pref-email">{{ 'NOTIFY.CHANNEL.email' | translate }}</label>
          <small>{{ 'NOTIFY.SETTINGS.EMAIL_HINT' | translate }}</small>
        </div>
        <input id="pref-email" type="checkbox" role="switch" class="switch" [checked]="prefs().email" [disabled]="saving() === 'email'" (change)="save('email', $event)" />
      </div>

      <div class="pref-row" data-pref="push" [attr.data-push-state]="push.state()">
        <div class="pref-text">
          <label for="pref-push">{{ 'NOTIFY.CHANNEL.push' | translate }}</label>
          <small>{{ pushHint() | translate }}</small>
        </div>
        <input id="pref-push" type="checkbox" role="switch" class="switch" [checked]="pushOn()" [disabled]="pushLocked()" (change)="togglePush($event)" />
      </div>
      @if (push.message(); as m) {
        <p class="note warn" role="status">{{ m | translate }}</p>
      }

      <div class="pref-row" data-pref="inApp">
        <div class="pref-text">
          <label for="pref-inapp">{{ 'NOTIFY.CHANNEL.in_app' | translate }}</label>
          <small>{{ 'NOTIFY.SETTINGS.IN_APP_HINT' | translate }}</small>
        </div>
        <input id="pref-inapp" type="checkbox" role="switch" class="switch" [checked]="prefs().inApp" [disabled]="saving() === 'inApp'" (change)="save('inApp', $event)" />
      </div>

      <h3 class="group-title">{{ 'NOTIFY.SETTINGS.OFFERS' | translate }}</h3>
      <div class="pref-row" data-pref="promotional">
        <div class="pref-text">
          <label for="pref-promo">{{ 'NOTIFY.SETTINGS.PROMO' | translate }}</label>
          <small>{{ 'NOTIFY.SETTINGS.PROMO_HINT' | translate }}</small>
        </div>
        <input id="pref-promo" type="checkbox" role="switch" class="switch" [checked]="prefs().promotional" [disabled]="saving() === 'promotional'" (change)="save('promotional', $event)" />
      </div>
    </section>
  `,
  styles: `
    .group-title { margin: 1.1rem 0 0.25rem; font-size: 0.8rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--color-text-muted); }
    .pref-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.75rem 0; border-bottom: 1px solid var(--color-border); }
    .pref-row:last-child { border-bottom: 0; }
    .pref-text { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
    .pref-text label { font-weight: 600; cursor: pointer; }
    .pref-text small { color: var(--color-text-muted); font-size: 0.84rem; }
    .note.warn { margin: 0.25rem 0 0.5rem; padding: 0.45rem 0.6rem; border-radius: var(--radius-sm); background: var(--color-warning-soft); color: var(--color-warning); font-size: 0.86rem; }
    .switch {
      appearance: none; flex: none; position: relative; width: 46px; height: 26px; min-height: 0; margin: 0; padding: 0;
      border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-surface-2); cursor: pointer;
      transition: background-color 0.15s, border-color 0.15s;
    }
    .switch::after {
      content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%;
      background: var(--color-text-muted); transition: transform 0.15s, background-color 0.15s;
    }
    .switch:checked { background: var(--color-primary-fill); border-color: var(--color-primary-fill); }
    .switch:checked::after { transform: translateX(20px); background: #fff; }
    .switch:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .switch:disabled { opacity: 0.5; cursor: not-allowed; }
  `,
})
export class NotificationSettings {
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly push = inject(PushService);
  protected readonly saving = signal<PrefKey | null>(null);

  protected readonly prefs = computed<NotificationPreferences>(
    () => this.auth.user()?.notificationPreferences ?? { email: true, push: true, inApp: true, promotional: false },
  );
  /** On when this browser is subscribed and the account preference is on. */
  protected readonly pushOn = computed(() => this.push.state() === 'on' && this.prefs().push !== false);
  protected readonly pushLocked = computed(() => ['unsupported', 'denied', 'busy'].includes(this.push.state()));
  protected readonly pushHint = computed(() => {
    switch (this.push.state()) {
      case 'unsupported':
        return 'NOTIFY.PUSH.UNSUPPORTED';
      case 'denied':
        return 'NOTIFY.PUSH.DENIED';
      default:
        return this.pushOn() ? 'NOTIFY.PUSH.ON' : 'NOTIFY.SETTINGS.PUSH_HINT';
    }
  });

  protected async save(key: PrefKey, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const value = input.checked;
    this.saving.set(key);
    try {
      await this.auth.updateProfile({ notificationPreferences: { [key]: value } });
      this.toast.success('NOTIFY.SETTINGS.SAVED');
    } catch {
      input.checked = !value;
      this.toast.error('ERRORS.GENERIC');
    } finally {
      this.saving.set(null);
    }
  }

  /** Push asks for browser permission only here, on the user's click. */
  protected async togglePush(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.checked) {
      const ok = await this.push.enable();
      input.checked = ok;
      if (ok) {
        this.auth.setLocalPreferences({ push: true });
        this.toast.success('NOTIFY.PUSH.ENABLED');
      }
    } else {
      await this.push.disable(true);
      this.auth.setLocalPreferences({ push: false });
      this.toast.show('NOTIFY.PUSH.DISABLED');
    }
  }
}
