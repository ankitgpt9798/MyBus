import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { Booking } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/icons';
import { AppDatePipe, CityPipe, InrPipe } from '../../shared/pipes';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';
import { statusBadge } from './status-badge';

/** Ticket / booking detail, including in-page cancellation with the refund amount. */
@Component({
  selector: 'app-booking-detail',
  imports: [FormsModule, RouterLink, TranslatePipe, Icon, AppDatePipe, CityPipe, InrPipe, TranslateOrPipe],
  templateUrl: './booking-detail.html',
  styleUrl: './booking-detail.scss',
})
export class BookingDetailPage {
  readonly id = input.required<string>();
  /** ?confirmed=1 right after a successful payment. */
  readonly confirmed = input<string | undefined>(undefined);

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  protected readonly booking = signal<Booking | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmCancel = signal(false);
  protected readonly cancelling = signal(false);
  protected readonly cancelError = signal<string | null>(null);
  protected reason = '';

  protected readonly badge = computed(() => statusBadge(this.booking()?.status));
  protected readonly canCancel = computed(() => {
    const b = this.booking();
    return !!b && (b.status === 'pending' || (b.status === 'confirmed' && !!b.cancellationQuote?.allowed));
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    try {
      this.booking.set((await this.api.booking(id)).booking);
    } catch (err) {
      this.error.set(errorKey(err));
    }
  }

  protected async cancel(): Promise<void> {
    this.cancelling.set(true);
    this.cancelError.set(null);
    try {
      const { booking } = await this.api.cancelBooking(this.id(), this.reason.trim() || undefined);
      this.booking.set(booking);
      this.confirmCancel.set(false);
      this.toast.success('BOOKING.CANCELLED_TOAST');
    } catch (err) {
      this.cancelError.set(errorKey(err));
    } finally {
      this.cancelling.set(false);
    }
  }

  protected print(): void {
    window.print();
  }
}
