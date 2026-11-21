import { Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Seat } from '../core/models';
import { Icon } from './icons';

interface DeckView {
  deck: 'lower' | 'upper';
  rows: number;
  cols: number;
  seats: Seat[];
}

/**
 * Bus seat layout with available / selected / held / booked states. Grid positions come from the bus layout.
 * `booked` lists every unavailable seat; `held` marks the ones only reserved by someone's unpaid hold.
 */
@Component({
  selector: 'app-seat-map',
  imports: [TranslatePipe, Icon],
  template: `
    <div class="seat-legend">
      <span><i class="seat-swatch available"></i>{{ 'SEATS.AVAILABLE' | translate }}</span>
      <span><i class="seat-swatch selected"></i>{{ 'SEATS.SELECTED' | translate }}</span>
      <span><i class="seat-swatch held"></i>{{ 'SEATS.HELD' | translate }}</span>
      <span><i class="seat-swatch booked"></i>{{ 'SEATS.BOOKED' | translate }}</span>
      <span><i class="seat-swatch ladies"></i>{{ 'SEATS.LADIES' | translate }}</span>
      <span><i class="seat-swatch female"></i>{{ 'SEATS.BOOKED_FEMALE' | translate }}</span>
    </div>
    <div class="decks">
      @for (d of decks(); track d.deck) {
        <div class="deck">
          <div class="deck-head">
            <span>{{ (d.deck === 'lower' ? 'SEATS.LOWER_DECK' : 'SEATS.UPPER_DECK') | translate }}</span>
            @if (d.deck === 'lower') {
              <span class="steering" [title]="'SEATS.DRIVER' | translate"><app-icon name="steering" [size]="22" /></span>
            }
          </div>
          <div class="deck-grid" [style.grid-template-columns]="'repeat(' + d.cols + ', var(--seat-w))'"
            [style.grid-template-rows]="'repeat(' + d.rows + ', var(--seat-h-' + kind() + '))'">
            @for (s of d.seats; track s.number) {
              <button type="button" class="seat" [class.sleeper]="s.kind === 'sleeper'"
                [class.booked]="isBooked(s.number) && !isHeld(s.number)" [class.held]="isHeld(s.number)" [class.selected]="isSelected(s.number)"
                [class.ladies]="!!s.ladiesOnly" [class.female]="isFemale(s.number)"
                [style.grid-row]="s.row + 1" [style.grid-column]="s.col + 1"
                [disabled]="disabled() || isBooked(s.number)"
                [attr.aria-pressed]="isSelected(s.number)"
                [attr.aria-label]="('SEATS.SEAT' | translate: { n: s.number }) + ' — ' + (stateKey(s) | translate)"
                [title]="('SEATS.SEAT' | translate: { n: s.number }) + ' — ' + (stateKey(s) | translate)"
                (click)="toggle.emit(s.number)">
                <span>{{ s.number }}</span>
              </button>
            }
          </div>
        </div>
      }
    </div>
  `,
  styleUrl: './seat-map.scss',
})
export class SeatMap {
  readonly seats = input.required<Seat[]>();
  readonly booked = input<string[]>([]);
  readonly held = input<string[]>([]);
  /** Booked seats whose passenger is female. */
  readonly female = input<string[]>([]);
  readonly selected = input<string[]>([]);
  readonly disabled = input(false);
  readonly toggle = output<string>();

  protected readonly kind = computed(() => (this.seats().some((s) => s.kind === 'sleeper') ? 'sleeper' : 'seater'));
  private readonly bookedSet = computed(() => new Set(this.booked()));
  private readonly heldSet = computed(() => new Set(this.held()));
  private readonly femaleSet = computed(() => new Set(this.female()));
  private readonly selectedSet = computed(() => new Set(this.selected()));

  protected readonly decks = computed<DeckView[]>(() =>
    (['lower', 'upper'] as const)
      .map((deck) => {
        const seats = this.seats().filter((s) => s.deck === deck);
        return {
          deck,
          seats,
          rows: Math.max(0, ...seats.map((s) => s.row)) + 1,
          cols: Math.max(0, ...seats.map((s) => s.col)) + 1,
        };
      })
      .filter((d) => d.seats.length > 0),
  );

  protected isBooked(n: string) {
    return this.bookedSet().has(n);
  }
  protected isHeld(n: string) {
    return this.heldSet().has(n);
  }
  protected isFemale(n: string) {
    return this.femaleSet().has(n);
  }
  protected isSelected(n: string) {
    return this.selectedSet().has(n);
  }
  protected stateKey(seat: Seat): string {
    const n = seat.number;
    if (this.isFemale(n)) return 'SEATS.BOOKED_FEMALE';
    if (this.isHeld(n)) return 'SEATS.HELD';
    if (this.isBooked(n)) return 'SEATS.BOOKED';
    if (seat.ladiesOnly) return this.isSelected(n) ? 'SEATS.LADIES_SELECTED' : 'SEATS.LADIES_AVAILABLE';
    return this.isSelected(n) ? 'SEATS.SELECTED' : 'SEATS.AVAILABLE';
  }
}
