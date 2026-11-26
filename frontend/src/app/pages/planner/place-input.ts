import { Component, effect, inject, input, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { PlaceType, PlannerPlace } from '../../core/models';
import { Icon } from '../../shared/icons';
import { PluralPipe } from '../../shared/plural.pipe';

const ICONS: Record<PlaceType, string> = { city: 'map', stop: 'bus', poi: 'pin', street: 'swap', address: 'pin', pin: 'pin' };
const DEBOUNCE_MS = 250;

/** Place search box with typeahead suggestions (WAI-ARIA combobox: arrows, Enter, Esc). */
@Component({
  selector: 'app-place-input',
  imports: [TranslatePipe, Icon, PluralPipe],
  template: `
    <div class="place-field" [class.selected]="!!value()">
      <label [for]="inputId()">{{ label() }}</label>
      <div class="combo">
        <span class="marker" aria-hidden="true">{{ badge() }}</span>
        <input
          #box
          [id]="inputId()"
          type="text"
          role="combobox"
          autocomplete="off"
          spellcheck="false"
          aria-autocomplete="list"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="inputId() + '-list'"
          [attr.aria-activedescendant]="open() && active() >= 0 ? inputId() + '-opt-' + active() : null"
          [value]="text()"
          [placeholder]="placeholder()"
          (input)="onInput(box.value)"
          (keydown)="onKey($event)"
          (focus)="focused.emit()"
          (blur)="onBlur()"
        />
        @if (text()) {
          <button type="button" class="icon-btn clear-place" (click)="clear(box)" [attr.aria-label]="'PLANNER.CLEAR_FIELD' | translate: { field: label() }">
            <app-icon name="close" [size]="14" />
          </button>
        }
      </div>
      @if (open()) {
        <ul class="suggestions" role="listbox" [id]="inputId() + '-list'" [attr.aria-label]="label()">
          @for (s of suggestions(); track s.id; let i = $index) {
            <li role="option" class="suggestion" [id]="inputId() + '-opt-' + i" [attr.aria-selected]="i === active()" [class.active]="i === active()"
              [attr.data-type]="s.type" (mousedown)="$event.preventDefault()" (click)="select(s)">
              <app-icon [name]="icons[s.type]" [size]="16" />
              <span class="s-text">
                <strong>{{ s.label }}</strong>
                @if (s.address && s.address !== s.label) {
                  <small>{{ s.address }}</small>
                }
              </span>
            </li>
          } @empty {
            <li class="s-empty">{{ (loading() ? 'PLANNER.SEARCHING' : 'PLANNER.NO_SUGGESTIONS') | translate }}</li>
          }
        </ul>
      }
      <span class="sr-only" aria-live="polite">{{ open() && !loading() ? ('PLANNER.SUGGESTION_COUNT' | plural: suggestions().length : { count: suggestions().length }) : '' }}</span>
    </div>
  `,
  styles: `
    :host { display: block; }
    .place-field { position: relative; display: grid; gap: 0.25rem; }
    label { font-size: 0.82rem; font-weight: 600; color: var(--color-text-muted); }
    .combo { position: relative; display: flex; align-items: center; }
    .marker {
      position: absolute; left: 0.5rem; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%;
      background: var(--color-surface-2); border: 1px solid var(--color-border); font-size: 0.72rem; font-weight: 800; color: var(--color-text);
    }
    .selected .marker { background: var(--color-primary-fill); border-color: var(--color-primary-fill); color: #fff; }
    input { width: 100%; padding-left: 2.25rem; padding-right: 2.2rem; }
    .clear-place { position: absolute; right: 0.25rem; width: 30px; height: 30px; }
    .suggestions {
      position: absolute; z-index: 1100; top: 100%; left: 0; right: 0; margin: 0.2rem 0 0; padding: 0.25rem; list-style: none; max-height: 280px; overflow-y: auto;
      background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); box-shadow: var(--shadow-md);
    }
    .suggestion { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.45rem 0.55rem; border-radius: 6px; cursor: pointer; color: var(--color-text); }
    .suggestion app-icon { flex: none; margin-top: 0.15rem; color: var(--color-primary); }
    .suggestion.active, .suggestion:hover { background: var(--color-primary-soft); }
    .s-text { display: grid; min-width: 0; strong { font-weight: 600; overflow-wrap: anywhere; } small { color: var(--color-text-muted); overflow-wrap: anywhere; } }
    .s-empty { padding: 0.5rem; color: var(--color-text-muted); font-size: 0.9rem; }
  `,
})
export class PlaceInput {
  readonly inputId = input.required<string>();
  readonly label = input.required<string>();
  /** Letter or number shown in the field (A, B, 1…), matching the map marker. */
  readonly badge = input('');
  readonly value = input<PlannerPlace | null>(null);
  readonly placeholder = input('');
  /** Suggestions are biased towards this point (e.g. the start when typing the destination). */
  readonly near = input<{ lat: number; lon: number } | null>(null);
  readonly picked = output<PlannerPlace | null>();
  readonly focused = output<void>();

  private readonly api = inject(ApiService);
  private readonly translate = inject(TranslateService);
  protected readonly icons = ICONS;
  protected readonly text = signal('');
  protected readonly suggestions = signal<PlannerPlace[]>([]);
  protected readonly open = signal(false);
  protected readonly active = signal(-1);
  protected readonly loading = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;

  constructor() {
    // The field shows the chosen place (also when it is set from outside: swap, quick picks, map clicks).
    effect(() => this.text.set(this.value()?.label ?? ''));
  }

  protected onInput(v: string): void {
    this.text.set(v);
    if (this.value()) this.picked.emit(null); // typing replaces the chosen place
    clearTimeout(this.timer);
    const q = v.trim();
    if (q.length < 2) {
      this.open.set(false);
      this.suggestions.set([]);
      return;
    }
    this.timer = setTimeout(() => void this.search(q), DEBOUNCE_MS);
  }

  private async search(q: string): Promise<void> {
    const seq = ++this.seq;
    this.loading.set(true);
    this.open.set(true);
    try {
      const res = await this.api.plannerSearch(q, this.translate.currentLang() ?? 'en', this.near());
      if (seq !== this.seq) return; // a newer search is on its way
      this.suggestions.set(res.results);
      this.active.set(res.results.length ? 0 : -1);
    } catch {
      if (seq === this.seq) this.suggestions.set([]);
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  protected onKey(event: KeyboardEvent): void {
    const list = this.suggestions();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.open() && list.length) this.open.set(true);
        else this.active.set(list.length ? (this.active() + 1) % list.length : -1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.active.set(list.length ? (this.active() - 1 + list.length) % list.length : -1);
        break;
      case 'Enter':
        if (this.open() && this.active() >= 0 && list[this.active()]) {
          event.preventDefault();
          this.select(list[this.active()]);
        }
        break;
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          this.open.set(false);
        }
        break;
      case 'Tab':
        this.open.set(false);
        break;
    }
  }

  protected onBlur(): void {
    setTimeout(() => this.open.set(false), 120);
  }

  protected select(place: PlannerPlace): void {
    clearTimeout(this.timer);
    this.seq++;
    this.text.set(place.label);
    this.open.set(false);
    this.loading.set(false);
    this.picked.emit(place);
  }

  protected clear(box: HTMLInputElement): void {
    this.text.set('');
    this.suggestions.set([]);
    this.open.set(false);
    this.picked.emit(null);
    box.focus();
  }
}
