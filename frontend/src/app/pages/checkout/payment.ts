import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorCode, errorKey } from '../../core/api-error';
import { Booking, PaymentMethod } from '../../core/models';
import { FieldError } from '../../shared/field-error';
import { HoldTimer } from '../../shared/hold-timer';
import { Icon } from '../../shared/icons';
import { InrPipe } from '../../shared/pipes';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';
import { BookingSummary } from './booking-summary';

/** Step 3 of booking: mock payment. No real gateway is involved and nothing is charged. */
@Component({
  selector: 'app-payment',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, FieldError, HoldTimer, Icon, BookingSummary, InrPipe, TranslateOrPipe],
  templateUrl: './payment.html',
  styleUrl: './checkout.scss',
})
export class PaymentPage {
  readonly id = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly booking = signal<Booking | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly expired = signal(false);
  protected readonly paying = signal(false);
  protected readonly releasing = signal(false);
  protected readonly submitted = signal(false);
  protected readonly method = signal<PaymentMethod>('upi');
  /** Demo only: lets reviewers exercise the declined-payment path. */
  protected readonly outcome = signal<'success' | 'failure'>('success');
  protected readonly methods: PaymentMethod[] = ['upi', 'card', 'netbanking'];
  protected readonly banks = ['SBI', 'HDFC', 'ICICI', 'AXIS', 'KOTAK'];

  // Mock gateway fields: validated in the browser only and never sent to the server.
  protected readonly upiForm = this.fb.group({ upiId: ['', [Validators.required, Validators.pattern(/^[\w.-]{2,}@[a-zA-Z]{2,}$/)]] });
  protected readonly cardForm = this.fb.group({
    number: ['', [Validators.required, Validators.pattern(/^\d{4}\s?\d{4}\s?\d{4}\s?\d{4}$/)]],
    name: ['', [Validators.required, Validators.minLength(2)]],
    expiry: ['', [Validators.required, Validators.pattern(/^(0[1-9]|1[0-2])\/\d{2}$/)]],
    cvv: ['', [Validators.required, Validators.pattern(/^\d{3}$/)]],
  });
  protected readonly bankForm = this.fb.group({ bank: ['', Validators.required] });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    try {
      const { booking } = await this.api.booking(id);
      if (booking.status === 'expired') {
        this.booking.set(booking);
        this.expired.set(true);
      } else if (booking.status !== 'pending') {
        this.router.navigate(['/bookings', booking.id], { replaceUrl: true });
      } else if (!booking.detailsComplete) {
        this.router.navigate(['/bookings', booking.id, 'passengers'], { replaceUrl: true });
      } else {
        this.booking.set(booking);
      }
    } catch (err) {
      this.loadError.set(errorKey(err));
    }
  }

  protected async onExpired(): Promise<void> {
    try {
      this.booking.set((await this.api.booking(this.id())).booking);
    } catch {
      /* show the expired state regardless */
    }
    this.expired.set(true);
  }

  private activeForm() {
    return { upi: this.upiForm, card: this.cardForm, netbanking: this.bankForm }[this.method()];
  }

  protected selectMethod(m: PaymentMethod): void {
    this.method.set(m);
    this.submitted.set(false);
    this.error.set(null);
  }

  protected async pay(): Promise<void> {
    this.submitted.set(true);
    this.error.set(null);
    const form = this.activeForm();
    if (form.invalid) {
      form.markAllAsTouched();
      return;
    }
    this.paying.set(true);
    try {
      const { booking } = await this.api.pay(this.id(), this.method(), this.outcome() === 'failure');
      this.router.navigate(['/bookings', booking.id], { queryParams: { confirmed: 1 }, replaceUrl: true });
    } catch (err) {
      if (errorCode(err) === 'BOOKING_EXPIRED') this.expired.set(true);
      else this.error.set(errorKey(err));
    } finally {
      this.paying.set(false);
    }
  }

  protected async changeSeats(): Promise<void> {
    const b = this.booking();
    if (!b) return;
    this.releasing.set(true);
    try {
      await this.api.cancelBooking(b.id);
    } catch {
      /* the hold may already have expired */
    }
    this.router.navigate(['/trip', b.tripId]);
  }
}
