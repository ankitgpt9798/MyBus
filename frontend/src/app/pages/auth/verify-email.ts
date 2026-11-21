import { Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { errorKey } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/icons';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';

/** Landing page for the emailed link: /verify-email?token=… */
@Component({
  selector: 'app-verify-email',
  imports: [RouterLink, TranslatePipe, Icon, TranslateOrPipe],
  template: `
    <div class="auth-page">
      <div class="auth-card card verify-card">
        @switch (state()) {
          @case ('verifying') {
            <h1>{{ 'VERIFY.VERIFYING' | translate }}</h1>
            <div class="skeleton" style="height: 8px; border-radius: 4px"></div>
          }
          @case ('success') {
            <span class="status-icon success"><app-icon name="check" [size]="30" /></span>
            <h1>{{ 'VERIFY.SUCCESS_TITLE' | translate }}</h1>
            <p class="muted">{{ 'VERIFY.SUCCESS_TEXT' | translate }}</p>
            @if (auth.isLoggedIn()) {
              <a routerLink="/" class="btn btn-primary">{{ 'COMMON.BACK_HOME' | translate }}</a>
            } @else {
              <a routerLink="/login" class="btn btn-primary">{{ 'AUTH.LOGIN' | translate }}</a>
            }
          }
          @case ('error') {
            <span class="status-icon error"><app-icon name="alert" [size]="30" /></span>
            <h1>{{ 'VERIFY.FAILED_TITLE' | translate }}</h1>
            <p class="muted">{{ error() | translateOr: 'ERRORS.GENERIC' }}</p>
            @if (auth.user(); as user) {
              @if (user.emailVerified) {
                <p>{{ 'VERIFY.ALREADY_VERIFIED' | translate }}</p>
                <a routerLink="/" class="btn btn-primary">{{ 'COMMON.BACK_HOME' | translate }}</a>
              } @else {
                <button type="button" class="btn btn-primary" [disabled]="resent() || resending()" (click)="resend()">
                  {{ (resent() ? 'VERIFY.RESENT_SHORT' : 'VERIFY.RESEND') | translate }}
                </button>
              }
            } @else {
              <p>{{ 'VERIFY.LOGIN_TO_RESEND' | translate }}</p>
              <a routerLink="/login" [queryParams]="{ returnUrl: '/profile' }" class="btn btn-primary">{{ 'AUTH.LOGIN' | translate }}</a>
            }
          }
        }
      </div>
    </div>
  `,
  styles: `
    .verify-card { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 0.75rem; }
    .status-icon { display: grid; place-items: center; width: 60px; height: 60px; border-radius: 50%; color: #fff; }
    .status-icon.success { background: var(--color-success-fill); }
    .status-icon.error { background: var(--color-danger-fill); }
    h1 { margin: 0; font-size: 1.4rem; }
    p { margin: 0; }
  `,
})
export class VerifyEmailPage implements OnInit {
  readonly token = input<string | undefined>(undefined);

  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly state = signal<'verifying' | 'success' | 'error'>('verifying');
  protected readonly error = signal<string | null>(null);
  protected readonly resending = signal(false);
  protected readonly resent = signal(false);

  async ngOnInit(): Promise<void> {
    const token = this.token();
    if (!token) {
      this.error.set('ERRORS.VERIFY_TOKEN_INVALID');
      this.state.set('error');
      return;
    }
    try {
      await this.auth.verifyEmail(token);
      this.state.set('success');
    } catch (err) {
      this.error.set(errorKey(err));
      this.state.set('error');
    }
  }

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
