import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { errorKey } from './core/api-error';
import { AuthService } from './core/auth.service';
import { ToastService } from './core/toast.service';
import { Footer } from './shared/footer';
import { Header } from './shared/header';
import { Icon } from './shared/icons';
import { Toasts } from './shared/toasts';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, TranslatePipe, Header, Footer, Toasts, Icon],
  template: `
    <a class="skip-link" href="#main">{{ 'COMMON.SKIP_TO_CONTENT' | translate }}</a>
    <app-header />
    @if (auth.user(); as user) {
      @if (!user.emailVerified) {
        <div class="verify-banner" role="status">
          <div class="container verify-inner">
            <app-icon name="alert" [size]="18" />
            <span>{{ 'VERIFY.BANNER' | translate: { email: user.email } }}</span>
            <button type="button" class="btn btn-sm btn-outline" [disabled]="resending() || resent()" (click)="resend()">
              {{ (resent() ? 'VERIFY.RESENT_SHORT' : 'VERIFY.RESEND') | translate }}
            </button>
            <a routerLink="/profile" class="verify-link">{{ 'NAV.PROFILE' | translate }}</a>
          </div>
        </div>
      }
    }
    <main id="main" class="site-main">
      <router-outlet />
    </main>
    <app-footer />
    <app-toasts />
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly resending = signal(false);
  protected readonly resent = signal(false);

  protected async resend(): Promise<void> {
    this.resending.set(true);
    try {
      await this.auth.resendVerification();
      this.resent.set(true);
      this.toast.success('VERIFY.RESENT');
    } catch (err) {
      this.toast.error(errorKey(err));
    } finally {
      this.resending.set(false);
    }
  }
}
