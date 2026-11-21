import { Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Icon } from './icons';

/** Countdown for a seat hold. Emits `expired` once when the hold runs out. */
@Component({
  selector: 'app-hold-timer',
  imports: [TranslatePipe, Icon],
  template: `
    <div class="hold-timer" [class.urgent]="secondsLeft() < 120" role="timer" aria-live="off">
      <app-icon name="clock" [size]="18" />
      <span>{{ 'HOLD.TIMER' | translate: { time: countdown() } }}</span>
    </div>
  `,
  styles: `
    .hold-timer {
      display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; padding: 0.7rem 1rem;
      border-radius: var(--radius-md); background: var(--color-info-soft); color: var(--color-info); font-weight: 600;
    }
    .hold-timer.urgent { background: var(--color-danger-soft); color: var(--color-danger); }
  `,
})
export class HoldTimer {
  readonly expiresAt = input.required<string | null>();
  readonly expired = output<void>();

  private readonly now = signal(Date.now());
  private fired = false;

  protected readonly secondsLeft = computed(() => {
    const exp = this.expiresAt();
    return exp ? Math.max(0, Math.ceil((new Date(exp).getTime() - this.now()) / 1000)) : 0;
  });
  protected readonly countdown = computed(() => {
    const s = this.secondsLeft();
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    effect(() => {
      if (this.expiresAt() && this.secondsLeft() === 0 && !this.fired) {
        this.fired = true;
        this.expired.emit();
      }
    });
  }
}
