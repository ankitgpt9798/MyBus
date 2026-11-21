import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { AdminTrip } from '../../core/models';
import { fromIstInput, istDate, toIstInput } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import { FieldError } from '../../shared/field-error';
import { AppDatePipe, CityPipe, InrPipe, NumPipe } from '../../shared/pipes';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';

type RouteOption = { id: string; from: string; to: string; code: string };
type BusOption = { id: string; name: string; registrationNumber: string; operatorName: string };

/** Trips: filter by date/route/status, reschedule or cancel a trip, and add new trips. */
@Component({
  selector: 'app-admin-trips',
  imports: [ReactiveFormsModule, TranslatePipe, FieldError, AppDatePipe, CityPipe, InrPipe, NumPipe, TranslateOrPipe],
  templateUrl: './admin-trips.html',
  styleUrl: './admin.scss',
})
export class AdminTripsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly routes = signal<RouteOption[]>([]);
  protected readonly buses = signal<BusOption[]>([]);
  protected readonly trips = signal<AdminTrip[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly limit = 15;
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.limit)));
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly filters = this.fb.group({ date: [istDate()], routeId: [''], status: [''] });

  // Reschedule / edit
  protected readonly editing = signal<AdminTrip | null>(null);
  protected readonly editForm = this.fb.group({
    departureTime: ['', Validators.required],
    arrivalTime: ['', Validators.required],
    fare: this.fb.control<number | null>(null, [Validators.required, Validators.min(1), Validators.max(20000)]),
  });
  protected readonly editError = signal<string | null>(null);
  protected readonly saving = signal(false);

  // Cancel trip
  protected readonly cancelling = signal<AdminTrip | null>(null);
  protected readonly cancelError = signal<string | null>(null);

  // Create trip
  protected readonly creating = signal(false);
  protected readonly createForm = this.fb.group({
    routeId: ['', Validators.required],
    busId: ['', Validators.required],
    departureTime: ['', Validators.required],
    fare: this.fb.control<number | null>(null, [Validators.required, Validators.min(1), Validators.max(20000)]),
  });
  protected readonly createError = signal<string | null>(null);
  protected readonly createSubmitted = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const [{ routes }, { buses }] = await Promise.all([this.api.adminRoutes(), this.api.adminBuses()]);
      this.routes.set(routes);
      this.buses.set(buses);
    } catch (err) {
      this.error.set(errorKey(err));
    }
    await this.load();
  }

  protected async load(page = this.page()): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const f = this.filters.getRawValue();
      const res = await this.api.adminTrips({ date: f.date, routeId: f.routeId, status: f.status, page, limit: this.limit });
      this.trips.set(res.trips);
      this.total.set(res.total);
      this.page.set(res.page);
    } catch (err) {
      this.error.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected applyFilters(): void {
    this.load(1);
  }

  protected startEdit(trip: AdminTrip): void {
    this.cancelling.set(null);
    this.editError.set(null);
    this.editing.set(trip);
    this.editForm.reset({ departureTime: toIstInput(trip.departureTime), arrivalTime: toIstInput(trip.arrivalTime), fare: trip.fare });
  }

  /** Sends only what changed. Moving only the departure lets the server shift the arrival by the same amount. */
  protected async saveEdit(): Promise<void> {
    const trip = this.editing();
    if (!trip || this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }
    const v = this.editForm.getRawValue();
    const body: { departureTime?: string; arrivalTime?: string; fare?: number } = {};
    if (v.departureTime !== toIstInput(trip.departureTime)) body.departureTime = fromIstInput(v.departureTime);
    if (v.arrivalTime !== toIstInput(trip.arrivalTime)) body.arrivalTime = fromIstInput(v.arrivalTime);
    if (Number(v.fare) !== trip.fare) body.fare = Number(v.fare);
    if (!Object.keys(body).length) {
      this.editing.set(null);
      return;
    }
    this.saving.set(true);
    this.editError.set(null);
    try {
      const res = await this.api.adminUpdateTrip(trip.id, body);
      this.toast.success(body.departureTime || body.arrivalTime ? 'ADMIN.TRIP_RESCHEDULED' : 'ADMIN.TRIP_UPDATED', { n: res.affectedBookings });
      this.editing.set(null);
      await this.load();
    } catch (err) {
      this.editError.set(errorKey(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected startCancel(trip: AdminTrip): void {
    this.editing.set(null);
    this.cancelError.set(null);
    this.cancelling.set(trip);
  }

  protected async confirmCancel(): Promise<void> {
    const trip = this.cancelling();
    if (!trip) return;
    this.saving.set(true);
    try {
      const res = await this.api.adminUpdateTrip(trip.id, { status: 'cancelled' });
      this.toast.success('ADMIN.TRIP_CANCELLED', { n: res.affectedBookings });
      this.cancelling.set(null);
      await this.load();
    } catch (err) {
      this.cancelError.set(errorKey(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected async create(): Promise<void> {
    this.createSubmitted.set(true);
    this.createError.set(null);
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }
    const v = this.createForm.getRawValue();
    this.saving.set(true);
    try {
      await this.api.adminCreateTrip({ routeId: v.routeId, busId: v.busId, departureTime: fromIstInput(v.departureTime), fare: Number(v.fare) });
      this.toast.success('ADMIN.TRIP_CREATED');
      this.creating.set(false);
      this.createForm.reset();
      this.createSubmitted.set(false);
      this.filters.patchValue({ date: v.departureTime.slice(0, 10), routeId: v.routeId, status: '' });
      await this.load(1);
    } catch (err) {
      this.createError.set(errorKey(err));
    } finally {
      this.saving.set(false);
    }
  }
}
