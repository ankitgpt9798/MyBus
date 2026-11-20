import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{8,14}$/;

/** Error key `phone` -> VALIDATION.PHONE */
export const phoneValidator: ValidatorFn = (c: AbstractControl): ValidationErrors | null =>
  !c.value || PHONE_PATTERN.test(String(c.value).trim()) ? null : { phone: true };

/** At least one letter and one digit. Error key `weakpassword` -> VALIDATION.WEAKPASSWORD */
export const passwordStrength: ValidatorFn = (c: AbstractControl): ValidationErrors | null =>
  !c.value || (/[A-Za-z]/.test(c.value) && /\d/.test(c.value)) ? null : { weakpassword: true };

/** Group validator: `password` and `confirmPassword` must match. Error set on confirmPassword. */
export const matchPasswords =
  (field = 'password', confirm = 'confirmPassword'): ValidatorFn =>
  (group: AbstractControl): ValidationErrors | null => {
    const a = group.get(field);
    const b = group.get(confirm);
    if (!a || !b) return null;
    const mismatch = a.value !== b.value;
    const errors = { ...(b.errors ?? {}) };
    if (mismatch) errors['mismatch'] = true;
    else delete errors['mismatch'];
    b.setErrors(Object.keys(errors).length ? errors : null);
    return null;
  };

/** Trims and rejects whitespace-only input. Error key `required`. */
export const notBlank: ValidatorFn = (c: AbstractControl): ValidationErrors | null =>
  typeof c.value === 'string' && c.value.length && !c.value.trim() ? { required: true } : null;
