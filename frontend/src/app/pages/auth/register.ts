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
import { matchPasswords, notBlank, passwordStrength } from '../../shared/validators';
import { safeReturnUrl } from './login';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, FieldError, TranslateOrPipe],
  template: `
    <div class="auth-page">
      <div class="auth-card card">
        <h1>{{ 'AUTH.REGISTER_TITLE' | translate }}</h1>
        <p class="muted">{{ 'AUTH.REGISTER_SUBTITLE' | translate }}</p>

        @if (error(); as e) {
          <div class="alert alert-error" role="alert">{{ e | translateOr: 'ERRORS.GENERIC' }}</div>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="form-field">
            <label for="name">{{ 'AUTH.FULL_NAME' | translate }}</label>
            <input id="name" formControlName="name" autocomplete="name" />
            <app-field-error [control]="form.controls.name" [submitted]="submitted()" />
          </div>
          <div class="form-field">
            <label for="email">{{ 'AUTH.EMAIL' | translate }}</label>
            <input id="email" type="email" formControlName="email" autocomplete="email" />
            <app-field-error [control]="form.controls.email" [submitted]="submitted()" />
          </div>
          <div class="form-field">
            <label for="password">{{ 'AUTH.PASSWORD' | translate }}</label>
            <input id="password" type="password" formControlName="password" autocomplete="new-password" />
            <small class="muted">{{ 'AUTH.PASSWORD_HINT' | translate }}</small>
            <app-field-error [control]="form.controls.password" [submitted]="submitted()" />
          </div>
          <div class="form-field">
            <label for="confirm">{{ 'AUTH.CONFIRM_PASSWORD' | translate }}</label>
            <input id="confirm" type="password" formControlName="confirmPassword" autocomplete="new-password" />
            <app-field-error [control]="form.controls.confirmPassword" [submitted]="submitted()" />
          </div>
          <button type="submit" class="btn btn-primary btn-block btn-lg" [disabled]="loading()">
            {{ (loading() ? 'COMMON.PLEASE_WAIT' : 'AUTH.CREATE_ACCOUNT') | translate }}
          </button>
        </form>

        <p class="auth-switch">
          {{ 'AUTH.HAVE_ACCOUNT' | translate }}
          <a routerLink="/login" [queryParams]="returnUrl() ? { returnUrl: returnUrl() } : {}">{{ 'AUTH.LOGIN' | translate }}</a>
        </p>
      </div>
    </div>
  `,
})
export class RegisterPage {
  readonly returnUrl = input<string | undefined>(undefined);

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      name: ['', [Validators.required, notBlank, Validators.minLength(2), Validators.maxLength(80)]],
      email: ['', [Validators.required, Validators.email, Validators.maxLength(120)]],
      password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(72), passwordStrength]],
      confirmPassword: ['', Validators.required],
    },
    { validators: matchPasswords() },
  );
  protected readonly submitted = signal(false);
  protected readonly loading = signal(false);
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
      const { name, email, password } = this.form.getRawValue();
      const user = await this.auth.register({ name: name.trim(), email: email.trim(), password });
      this.toast.success('AUTH.REGISTERED', { email: user.email });
      await this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
    } catch (err) {
      if (!applyServerErrors(this.form, err)) this.error.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }
}
