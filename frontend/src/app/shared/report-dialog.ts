import { Component, effect, inject, input, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ContentReportReason } from '../core/models';
import { Dialog } from './dialog';
import { TranslateOrPipe } from './translate-or.pipe';

const REASONS: ContentReportReason[] = ['spam', 'offensive', 'irrelevant', 'misleading', 'other'];

/** Report a community post or comment: a reason from the list and an optional note. */
@Component({
  selector: 'app-report-dialog',
  imports: [ReactiveFormsModule, TranslatePipe, Dialog, TranslateOrPipe],
  template: `
    <app-dialog [title]="title() | translate" (closed)="closed.emit()">
      <form [formGroup]="form" (ngSubmit)="submit()" class="report-form" novalidate>
        <blockquote class="quote">{{ quote() }}</blockquote>
        <p class="muted small">{{ 'COMMUNITY.REPORT_HINT' | translate }}</p>
        @if (error(); as e) {
          <div class="alert alert-error" role="alert">{{ e | translateOr: 'ERRORS.GENERIC' }}</div>
        }
        <fieldset class="reasons">
          <legend>{{ 'COMMUNITY.REPORT_REASON' | translate }}</legend>
          @for (reason of reasons; track reason) {
            <label class="check"><input type="radio" formControlName="reason" [value]="reason" [attr.data-reason]="reason" /> {{ 'COMMUNITY.REPORT_REASONS.' + reason | translate }}</label>
          }
          @if (form.controls.reason.invalid && form.controls.reason.touched) {
            <p class="field-error" role="alert">{{ 'REVIEWS.REPORT_PICK_REASON' | translate }}</p>
          }
        </fieldset>
        <div class="form-field">
          <label for="report-note">{{ 'REVIEWS.REPORT_NOTE' | translate }}</label>
          <textarea id="report-note" formControlName="note" rows="3" maxlength="300"></textarea>
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" (click)="closed.emit()">{{ 'COMMON.CANCEL' | translate }}</button>
          <button type="submit" class="btn btn-danger submit-report" [disabled]="busy()">{{ 'REVIEWS.REPORT_SUBMIT' | translate }}</button>
        </div>
      </form>
    </app-dialog>
  `,
  styles: `
    .quote { margin: 0 0 0.5rem; padding: 0.4rem 0.75rem; border-left: 3px solid var(--color-border); font-size: 0.9rem; overflow-wrap: anywhere; white-space: pre-line; max-height: 7.5em; overflow: hidden; }
    .reasons { margin: 0 0 0.75rem; padding: 0; border: 0; legend { font-weight: 600; margin-bottom: 0.25rem; } }
    .dialog-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 0.5rem; }
  `,
})
export class ReportDialog {
  readonly title = input.required<string>();
  /** What is being reported (title or text), shown at the top. */
  readonly quote = input('');
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly send = output<{ reason: ContentReportReason; note?: string }>();
  readonly closed = output<void>();

  protected readonly reasons = REASONS;
  protected readonly form = inject(FormBuilder).nonNullable.group({
    reason: ['' as ContentReportReason | '', Validators.required],
    note: ['', Validators.maxLength(300)],
  });

  constructor() {
    // A new item to report starts with an empty form.
    effect(() => {
      this.quote();
      this.form.reset({ reason: '', note: '' });
    });
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { reason, note } = this.form.getRawValue();
    this.send.emit({ reason: reason as ContentReportReason, note: note.trim() || undefined });
  }
}
