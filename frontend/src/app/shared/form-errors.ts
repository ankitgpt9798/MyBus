import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, FormGroup, ValidationErrors } from '@angular/forms';

interface ServerFieldError {
  field: string;
  rule: string;
  params?: { min?: number; max?: number };
}

function toControlError(e: ServerFieldError, code: string): ValidationErrors {
  // Review content guidelines: link / email / phone / banned → VALIDATION.GUIDELINE_*
  if (code === 'REVIEW_GUIDELINES') return { [`guideline_${e.rule}`]: true };
  switch (e.rule) {
    case 'integer':
      return { integer: true };
    case 'min':
      return { min: { min: e.params?.min } };
    case 'max':
      return { max: { max: e.params?.max } };
    case 'required':
      return { required: true };
    case 'email':
      return { email: true };
    case 'minlength':
      return { minlength: { requiredLength: e.params?.min } };
    case 'maxlength':
      return { maxlength: { requiredLength: e.params?.max } };
    case 'pattern':
      return e.field.endsWith('phone') ? { phone: true } : { pattern: true };
    case 'ladiesOnly':
      return { ladiesonly: true };
    default:
      return { invalid: true };
  }
}

const FIELD_ERROR_CODES = ['VALIDATION_ERROR', 'SEAT_LADIES_ONLY', 'REVIEW_GUIDELINES'];

/**
 * Copies backend field errors (VALIDATION_ERROR / SEAT_LADIES_ONLY with details: [{ field, rule }]) onto the matching form controls,
 * so server-side validation shows up next to the field as a translated message.
 * Returns true when at least one field error was applied.
 */
export function applyServerErrors(form: FormGroup, err: unknown): boolean {
  if (!(err instanceof HttpErrorResponse) || !FIELD_ERROR_CODES.includes(err.error?.code) || !Array.isArray(err.error.details)) return false;
  let applied = false;
  for (const detail of err.error.details as ServerFieldError[]) {
    const control: AbstractControl | null = form.get(detail.field);
    if (!control) continue;
    control.setErrors({ ...(control.errors ?? {}), ...toControlError(detail, err.error.code) });
    control.markAsTouched();
    applied = true;
  }
  return applied;
}
