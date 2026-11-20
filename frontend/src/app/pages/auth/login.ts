import { Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { errorKey } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { FieldError } from '../../shared/field-error';
import { applyServerErrors } from '../../shared/form-errors';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';

/** Only allow in-app return URLs (prevents open redirects via ?returnUrl=https://…). */
export const safeReturnUrl = (url: string | undefined) => (url && url.startsWith('/') && !url.startsWith('//') ? url : '/');

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, FieldError, TranslateOrPipe],
  template: `
    <div class="auth-page">
      <div class="auth-card card">
        <h1>{{ 'AUTH.LOGIN_TITLE' | translate }}</h1>
        <p class="muted">{{ 'AUTH.LOGIN_SUBTITLE' | translate }}</p>

        @if (expired()) {
          <div class="alert alert-info">{{ 'AUTH.SESSION_EXPIRED' | translate }}</div>
        }
        @if (error(); as e) {
          <div class="alert alert-error" role="alert">{{ e | translateOr: 'ERRORS.GENERIC' }}</div>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="form-field">
            <label for="email">{{ 'AUTH.EMAIL' | translate }}</label>
            <input id="email" type="email" formControlName="email" autocomplete="email" />
            <app-field-error [control]="form.controls.email" [submitted]="submitted()" />
          </div>
          <div class="form-field">
            <label for="password">{{ 'AUTH.PASSWORD' | translate }}</label>
            <div class="password-input">
              <input id="password" [type]="showPassword() ? 'text' : 'password'" formControlName="password" autocomplete="current-password" />
              <button type="button" class="link" (click)="showPassword.set(!showPassword())">
                {{ (showPassword() ? 'AUTH.HIDE' : 'AUTH.SHOW') | translate }}
              </button>
            </div>
            <app-field-error [control]="form.controls.password" [submitted]="submitted()" />
          </div>
          <button type="submit" class="btn btn-primary btn-block btn-lg" [disabled]="loading()">
            {{ (loading() ? 'COMMON.PLEASE_WAIT' : 'AUTH.LOGIN') | translate }}
          </button>
        </form>

        <p class="auth-switch">
          {{ 'AUTH.NO_ACCOUNT' | translate }}
          <a routerLink="/register" [queryParams]="returnUrl() ? { returnUrl: returnUrl() } : {}">{{ 'AUTH.CREATE_ACCOUNT' | translate }}</a>
        </p>
      </div>
    </div>
  `,
})
export class LoginPage {
  readonly returnUrl = input<string | undefined>(undefined);
  readonly expired = input<string | undefined>(undefined);

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  protected readonly submitted = signal(false);
  protected readonly loading = signal(false);
  protected readonly showPassword = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    try {
      const { email, password } = this.form.getRawValue();
      const user = await this.auth.login(email.trim(), password);
      this.toast.success('AUTH.WELCOME_BACK', { name: user.name.split(' ')[0] });
      await this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
    } catch (err) {
      if (!applyServerErrors(this.form, err)) this.error.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }
}
