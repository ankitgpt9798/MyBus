import { Component, computed, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { of, startWith, switchMap } from 'rxjs';
import { PluralPipe } from './plural.pipe';

/** Shows the first validation error of a control as a translated message (VALIDATION.*). */
@Component({
  selector: 'app-field-error',
  imports: [TranslatePipe, PluralPipe],
  template: `
    @if (message(); as m) {
      <p class="field-error" role="alert">{{ m.count !== undefined ? (m.key | plural: m.count : m.params) : (m.key | translate: m.params) }}</p>
    }
  `,
})
export class FieldError {
  readonly control = input.required<AbstractControl | null>();
  readonly submitted = input(false);

  // Components are OnPush by default: re-evaluate on every value/status/touched event of the control.
  private readonly controlEvent = toSignal(
    toObservable(this.control).pipe(switchMap((c) => (c ? c.events.pipe(startWith(null)) : of(null)))),
    { initialValue: null },
  );

  protected readonly message = computed<{ key: string; params: Record<string, unknown>; count?: number } | null>(() => {
    this.controlEvent();
    const c = this.control();
    if (!c || !c.errors || !(c.touched || this.submitted())) return null;
    const [name, detail] = Object.entries(c.errors)[0];
    switch (name) {
      case 'minlength':
      case 'maxlength':
        return { key: `VALIDATION.${name.toUpperCase()}`, params: { n: detail.requiredLength }, count: Number(detail.requiredLength) };
      case 'min':
        return { key: 'VALIDATION.MIN', params: { n: detail.min } };
      case 'max':
        return { key: 'VALIDATION.MAX', params: { n: detail.max } };
      default:
        return { key: `VALIDATION.${name.toUpperCase()}`, params: {} };
    }
  });
}
