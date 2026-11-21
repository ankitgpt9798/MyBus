import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorCode, errorKey } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { Booking, Gender } from '../../core/models';
import { FieldError } from '../../shared/field-error';
import { applyServerErrors } from '../../shared/form-errors';
import { HoldTimer } from '../../shared/hold-timer';
import { Icon } from '../../shared/icons';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';
import { femaleOnly, notBlank, phoneValidator } from '../../shared/validators';
import { BookingSummary } from './booking-summary';

type PassengerForm = FormGroup<{
  seat: FormControl<string>;
  name: FormControl<string>;
  age: FormControl<number | null>;
  gender: FormControl<Gender | ''>;
}>;

/** Step 2 of booking: passenger and contact details while the seats are held. */
@Component({
  selector: 'app-passengers',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, FieldError, HoldTimer, Icon, BookingSummary, TranslateOrPipe],
  templateUrl: './passengers.html',
  styleUrl: './checkout.scss',
})
export class PassengersPage {
  readonly id = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly booking = signal<Booking | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly expired = signal(false);
  protected readonly saving = signal(false);
  protected readonly releasing = signal(false);
  protected readonly submitted = signal(false);
  protected readonly genders: Gender[] = ['male', 'female', 'other'];

  protected readonly form = this.fb.group({
    passengers: this.fb.array<PassengerForm>([]),
    contact: this.fb.group({
      email: ['', [Validators.required, Validators.email, Validators.maxLength(120)]],
      phone: ['', [Validators.required, phoneValidator]],
    }),
  });

  get passengers(): FormArray<PassengerForm> {
    return this.form.controls.passengers;
  }

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
        return;
      }
      if (booking.status !== 'pending') {
        this.router.navigate(['/bookings', booking.id], { replaceUrl: true });
        return;
      }
      this.passengers.clear();
      for (const seat of booking.seats) {
        const saved = booking.passengers.find((p) => p.seat === seat);
        const ladies = booking.ladiesSeats.includes(seat);
        this.passengers.push(
          this.fb.group({
            seat: [seat],
            name: [saved?.name ?? '', [Validators.required, notBlank, Validators.minLength(2), Validators.maxLength(60)]],
            age: this.fb.control<number | null>(saved?.age ?? null, [Validators.required, Validators.min(1), Validators.max(120)]),
            // Women-reserved seats start as Female and reject any other choice.
            gender: this.fb.control<Gender | ''>(saved?.gender ?? (ladies ? 'female' : ''), ladies ? [Validators.required, femaleOnly] : Validators.required),
          }),
        );
      }
      const user = this.auth.user();
      this.form.controls.contact.patchValue({
        email: booking.contact.email || user?.email || '',
        phone: booking.contact.phone || user?.phone || '',
      });
      this.booking.set(booking);
    } catch (err) {
      this.loadError.set(errorKey(err));
    }
  }

  protected isLadiesSeat(seat: string): boolean {
    return !!this.booking()?.ladiesSeats.includes(seat);
  }

  /** The countdown hit zero: re-read the booking so the server releases the seats, then show the expired state. */
  protected async onExpired(): Promise<void> {
    try {
      const { booking } = await this.api.booking(this.id());
      this.booking.set(booking);
      this.expired.set(booking.status === 'expired' || booking.status === 'pending');
    } catch {
      this.expired.set(true);
    }
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    this.saving.set(true);
    try {
      await this.api.saveDetails(this.id(), {
        passengers: value.passengers.map((p) => ({ seat: p.seat, name: p.name.trim(), age: Number(p.age), gender: p.gender as Gender })),
        contact: { email: value.contact.email.trim(), phone: value.contact.phone.trim() },
      });
      this.router.navigate(['/bookings', this.id(), 'pay']);
    } catch (err) {
      if (errorCode(err) === 'BOOKING_EXPIRED') this.expired.set(true);
      else if (!applyServerErrors(this.form, err)) this.error.set(errorKey(err));
    } finally {
      this.saving.set(false);
    }
  }

  /** Releases the hold and returns to the seat map. */
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
