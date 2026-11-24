import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { EligibleJourney, MyReview } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { FieldError } from '../../shared/field-error';
import { applyServerErrors } from '../../shared/form-errors';
import { AppDatePipe, CityPipe, NumPipe } from '../../shared/pipes';
import { Stars } from '../../shared/stars';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';

export const REVIEW_MIN = 30;
export const REVIEW_MAX = 1000;

/** Length after trimming, as the server counts it. */
const trimmedLength =
  (min: number) =>
  (c: AbstractControl): ValidationErrors | null => {
    const len = String(c.value ?? '').trim().length;
    return len && len < min ? { minlength: { requiredLength: min } } : null;
  };

/** Write (/reviews/new?booking=…) or edit (/reviews/:id/edit, within 24 h) a route review. */
@Component({
  selector: 'app-review-form',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, FieldError, Stars, AppDatePipe, CityPipe, NumPipe, TranslateOrPipe],
  templateUrl: './review-form.html',
  styleUrl: './review-form.scss',
})
export class ReviewFormPage {
  /** Query param for a new review. */
  readonly booking = input<string | undefined>(undefined);
  /** Route param when editing. */
  readonly id = input<string | undefined>(undefined);

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  protected readonly min = REVIEW_MIN;
  protected readonly max = REVIEW_MAX;
  protected readonly ratings = [1, 2, 3, 4, 5];

  protected readonly form = inject(FormBuilder).group({
    rating: [null as number | null, Validators.required],
    text: ['', [Validators.required, trimmedLength(REVIEW_MIN), Validators.maxLength(REVIEW_MAX)]],
  });
  private readonly textValue = toSignal(this.form.controls.text.valueChanges, { initialValue: '' });
  private readonly ratingValue = toSignal(this.form.controls.rating.valueChanges, { initialValue: null });
  protected readonly length = computed(() => String(this.textValue() ?? '').trim().length);
  protected readonly hover = signal<number | null>(null);
  protected readonly shownRating = computed(() => this.hover() ?? this.ratingValue() ?? 0);

  protected readonly loading = signal(true);
  protected readonly journey = signal<EligibleJourney | null>(null);
  protected readonly existing = signal<MyReview | null>(null);
  /** Translation key explaining why the form can't be shown (not eligible, already reviewed, window closed…). */
  protected readonly blocked = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly resent = signal(false);
  protected readonly editing = computed(() => !!this.id());

  /** Header info for either mode. */
  protected readonly info = computed(() => {
    const j = this.journey();
    const r = this.existing();
    return j ? { from: j.from, to: j.to, date: j.departureTime, routeId: j.routeId } : r ? { from: r.from ?? '', to: r.to ?? '', date: null, routeId: r.routeId } : null;
  });

  constructor() {
    effect(() => {
      const booking = this.booking();
      const id = this.id();
      untracked(() => void this.load(booking, id));
    });
  }

  private async load(bookingId: string | undefined, reviewId: string | undefined): Promise<void> {
    this.loading.set(true);
    this.blocked.set(null);
    try {
      const { eligible, reviews } = await this.api.eligibleReviews();
      if (reviewId) {
        const r = reviews.find((x) => x.id === reviewId);
        if (!r) return this.blocked.set('ERRORS.REVIEW_NOT_FOUND');
        this.existing.set(r);
        this.form.reset({ rating: r.rating, text: r.text });
        if (r.status === 'removed') this.blocked.set('ERRORS.REVIEW_REMOVED');
        else if (!r.editable) this.blocked.set('ERRORS.REVIEW_EDIT_WINDOW_CLOSED');
      } else {
        const j = eligible.find((x) => x.bookingId === bookingId);
        const done = reviews.find((x) => x.bookingId === bookingId);
        if (j) this.journey.set(j);
        else if (done) {
          this.existing.set(done);
          this.blocked.set('ERRORS.REVIEW_ALREADY_EXISTS');
        } else this.blocked.set('REVIEWS.NOT_ELIGIBLE');
      }
    } catch (err) {
      this.error.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected labelFor(n: number): string {
    return `REVIEWS.RATING_LABELS.${n}`;
  }

  protected async resend(): Promise<void> {
    try {
      await this.auth.resendVerification();
      this.resent.set(true);
    } catch (err) {
      this.toast.error(errorKey(err));
    }
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const rating = this.form.controls.rating.value!;
    const text = String(this.form.controls.text.value ?? '').trim();
    this.saving.set(true);
    this.error.set(null);
    try {
      const existing = this.existing();
      const res = existing
        ? await this.api.updateReview(existing.id, { rating, text })
        : await this.api.createReview({ bookingId: this.journey()!.bookingId, rating, text });
      this.toast.success(existing ? 'REVIEWS.UPDATED' : 'REVIEWS.POSTED');
      await this.router.navigate(['/routes', res.review.routeId], { fragment: 'reviews' });
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.error?.code === 'REVIEW_EDIT_WINDOW_CLOSED') this.blocked.set('ERRORS.REVIEW_EDIT_WINDOW_CLOSED');
      else if (!applyServerErrors(this.form, err)) this.error.set(errorKey(err));
    } finally {
      this.saving.set(false);
    }
  }
}
