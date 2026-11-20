import { HttpErrorResponse } from '@angular/common/http';

/**
 * Maps any thrown error to a translation key under ERRORS.*.
 * Backend errors carry a stable `code` (e.g. AUTH_INVALID_CREDENTIALS); unknown codes fall back to ERRORS.GENERIC.
 */
export function errorKey(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'ERRORS.NETWORK';
    const code = err.error?.code;
    if (typeof code === 'string' && /^[A-Z_]+$/.test(code)) return `ERRORS.${code}`;
    return err.status >= 500 ? 'ERRORS.SERVER_ERROR' : 'ERRORS.GENERIC';
  }
  return 'ERRORS.GENERIC';
}

export function errorCode(err: unknown): string | null {
  return err instanceof HttpErrorResponse && typeof err.error?.code === 'string' ? err.error.code : null;
}
