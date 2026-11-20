import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

/**
 * Translates `key`, or `fallbackKey` when `key` has no translation.
 * Used for backend error codes: {{ errorKey | translateOr: 'ERRORS.GENERIC' }}
 */
@Pipe({ name: 'translateOr', pure: false })
export class TranslateOrPipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(key: string | null | undefined, fallbackKey: string, params?: Record<string, unknown>): string {
    if (!key) return '';
    const value = this.translate.instant(key, params);
    return value === key ? this.translate.instant(fallbackKey, params) : value;
  }
}
