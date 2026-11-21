import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorCode, errorKey } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { TripDetails } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { FieldError } from '../../shared/field-error';
import { Icon } from '../../shared/icons';
import { AppDatePipe, CityPipe, DurationPipe, InrPipe, NumPipe } from '../../shared/pipes';
import { SeatMap } from '../../shared/seat-map';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';
import { TripDetailsPanel } from '../../shared/trip-details';

const PENDING_KEY = 'mybus.pendingSelection';

/** Step 1 of booking: pick seats and boarding/dropping points, then hold the seats. */
@Component({
  selector: 'app-trip',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, SeatMap, FieldError, Icon, TripDetailsPanel, AppDatePipe, CityPipe, DurationPipe, InrPipe, NumPipe, TranslateOrPipe],
  templateUrl: './trip.html',
  styleUrl: './trip.scss',
})
export class TripPage {
  readonly id = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);

  protected readonly data = signal<TripDetails | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly holdError = signal<string | null>(null);
  protected readonly selected = signal<string[]>([]);
  protected readonly holding = signal(false);
  protected readonly submitted = signal(false);

  protected readonly boardingPoints = computed(() => this.data()?.route.stops.filter((s) => s.type === 'boarding') ?? []);
  protected readonly droppingPoints = computed(() => this.data()?.route.stops.filter((s) => s.type === 'dropping') ?? []);
  protected readonly maxSeats = computed(() => this.data()?.policy.maxSeats ?? 6);
  /** Selected seats that are reserved for women (shown with a note; enforced on the passenger step). */
  protected readonly selectedLadies = computed(() => {
    const ladies = new Set(this.data()?.bus.seats.filter((s) => s.ladiesOnly).map((s) => s.number));
    return this.selected().filter((s) => ladies.has(s));
  });
  protected readonly total = computed(() => (this.data()?.trip.fare ?? 0) * this.selected().length);

  protected readonly points = inject(FormBuilder).nonNullable.group({
    boardingPoint: ['', Validators.required],
    droppingPoint: ['', Validators.required],
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.load(id));
    });
  }

  private async load(id: string, keepSelection = false): Promise<void> {
    this.loadError.set(null);
    try {
      const data = await this.api.trip(id);
      this.data.set(data);
      const boarding = data.route.stops.find((s) => s.type === 'boarding');
      const dropping = data.route.stops.filter((s) => s.type === 'dropping').at(-1);
      if (!this.points.value.boardingPoint && boarding) this.points.patchValue({ boardingPoint: boarding.name });
      if (!this.points.value.droppingPoint && dropping) this.points.patchValue({ droppingPoint: dropping.name });
      if (keepSelection) this.selected.set(this.selected().filter((s) => !data.trip.bookedSeats.includes(s)));
      else this.restorePendingSelection(data);
    } catch (err) {
      this.loadError.set(errorKey(err));
    }
  }

  protected pointTime(offsetMinutes: number): string {
    const dep = this.data()?.trip.departureTime;
    return dep ? new Date(new Date(dep).getTime() + offsetMinutes * 60_000).toISOString() : '';
  }

  protected toggleSeat(seat: string): void {
    this.holdError.set(null);
    const current = this.selected();
    if (current.includes(seat)) {
      this.selected.set(current.filter((s) => s !== seat));
    } else if (current.length >= this.maxSeats()) {
      this.toast.error('SEATS.MAX_REACHED', { n: this.maxSeats() });
    } else {
      this.selected.set([...current, seat]);
    }
  }

  /** Guests keep their selection across the login redirect (sessionStorage, this tab only). */
  private savePendingSelection(): void {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ tripId: this.id(), seats: this.selected(), ...this.points.getRawValue() }));
    } catch {
      /* storage unavailable: the user simply picks again */
    }
  }

  private restorePendingSelection(data: TripDetails): void {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (!raw) return;
      sessionStorage.removeItem(PENDING_KEY);
      const saved = JSON.parse(raw);
      if (saved.tripId !== data.trip.id) return;
      this.selected.set((saved.seats as string[]).filter((s) => !data.trip.bookedSeats.includes(s)).slice(0, this.maxSeats()));
      this.points.patchValue({ boardingPoint: saved.boardingPoint, droppingPoint: saved.droppingPoint });
    } catch {
      /* ignore corrupt state */
    }
  }

  protected async continue(): Promise<void> {
    this.submitted.set(true);
    this.holdError.set(null);
    if (!this.selected().length) {
      this.holdError.set('SEATS.SELECT_AT_LEAST_ONE');
      return;
    }
    if (this.points.invalid) return;
    if (!this.auth.isLoggedIn()) {
      this.savePendingSelection();
      this.router.navigate(['/login'], { queryParams: { returnUrl: `/trip/${this.id()}` } });
      return;
    }
    this.holding.set(true);
    try {
      const { booking } = await this.api.holdSeats({ tripId: this.id(), seats: this.selected(), ...this.points.getRawValue() });
      this.router.navigate(['/bookings', booking.id, 'passengers']);
    } catch (err) {
      this.holdError.set(errorKey(err));
      if (errorCode(err) === 'SEAT_UNAVAILABLE') {
        // Someone else got there first: refresh the map and drop the seats that are gone.
        await this.load(this.id(), true);
        this.toast.error('ERRORS.SEAT_UNAVAILABLE');
      }
    } finally {
      this.holding.set(false);
    }
  }
}
