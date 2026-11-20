import { Component, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { errorKey } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { FieldError } from '../../shared/field-error';
import { applyServerErrors } from '../../shared/form-errors';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';
import { matchPasswords, notBlank, passwordStrength, phoneValidator } from '../../shared/validators';

@Component({
  selector: 'app-profile',
  imports: [ReactiveFormsModule, TranslatePipe, FieldError, TranslateOrPipe],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class ProfilePage {
  /** ?verify=1 is set by verifiedGuard when a feature needs a verified account. */
  readonly verify = input<string | undefined>(undefined);

  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly profileForm = this.fb.group({
    name: ['', [Validators.required, notBlank, Validators.minLength(2), Validators.maxLength(80)]],
    phone: ['', [phoneValidator]],
  });
  protected readonly passwordForm = this.fb.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(72), passwordStrength]],
      confirmPassword: ['', Validators.required],
    },
    { validators: matchPasswords('newPassword', 'confirmPassword') },
  );

  protected readonly savingProfile = signal(false);
  protected readonly profileSubmitted = signal(false);
  protected readonly profileError = signal<string | null>(null);
  protected readonly savingPassword = signal(false);
  protected readonly passwordSubmitted = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly resending = signal(false);
  protected readonly resent = signal(false);

  constructor() {
    effect(() => {
      const user = this.auth.user();
      if (user && !this.profileForm.dirty) this.profileForm.reset({ name: user.name, phone: user.phone });
    });
  }

  protected async saveProfile(): Promise<void> {
    this.profileSubmitted.set(true);
    this.profileError.set(null);
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }
    this.savingProfile.set(true);
    try {
      const { name, phone } = this.profileForm.getRawValue();
      const user = await this.auth.updateProfile({ name: name.trim(), phone: phone.trim() });
      this.profileForm.reset({ name: user.name, phone: user.phone });
      this.profileSubmitted.set(false);
      this.toast.success('PROFILE.SAVED');
    } catch (err) {
      if (!applyServerErrors(this.profileForm, err)) this.profileError.set(errorKey(err));
    } finally {
      this.savingProfile.set(false);
    }
  }

  protected async changePassword(): Promise<void> {
    this.passwordSubmitted.set(true);
    this.passwordError.set(null);
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    this.savingPassword.set(true);
    try {
      const { currentPassword, newPassword } = this.passwordForm.getRawValue();
      await this.auth.changePassword(currentPassword, newPassword);
      this.passwordForm.reset();
      this.passwordSubmitted.set(false);
      this.toast.success('PROFILE.PASSWORD_CHANGED');
    } catch (err) {
      if (!applyServerErrors(this.passwordForm, err)) this.passwordError.set(errorKey(err));
    } finally {
      this.savingPassword.set(false);
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
