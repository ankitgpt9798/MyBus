import { Component, OnInit, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../core/api.service';
import { istDate } from '../core/time';
import { FieldError } from './field-error';
import { Icon } from './icons';
import { CityPipe } from './pipes';

let citiesCache: string[] | null = null;

@Component({
  selector: 'app-search-form',
  imports: [ReactiveFormsModule, TranslatePipe, FieldError, Icon, CityPipe],
  template: `
    <form class="search-form" [class.compact]="compact()" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <div class="sf-field">
        <label for="sf-from"><app-icon name="pin" [size]="16" /> {{ 'SEARCH.FROM' | translate }}</label>
        <select id="sf-from" formControlName="from">
          <option value="" disabled>{{ 'SEARCH.SELECT_CITY' | translate }}</option>
          @for (c of cities(); track c) {
            <option [value]="c">{{ c | city }}</option>
          }
        </select>
        <app-field-error [control]="form.controls.from" [submitted]="submitted()" />
      </div>
      <button type="button" class="swap-btn" (click)="swap()" [attr.aria-label]="'SEARCH.SWAP' | translate" [title]="'SEARCH.SWAP' | translate">
        <app-icon name="swap" [size]="18" />
      </button>
      <div class="sf-field">
        <label for="sf-to"><app-icon name="pin" [size]="16" /> {{ 'SEARCH.TO' | translate }}</label>
        <select id="sf-to" formControlName="to">
          <option value="" disabled>{{ 'SEARCH.SELECT_CITY' | translate }}</option>
          @for (c of cities(); track c) {
            <option [value]="c">{{ c | city }}</option>
          }
        </select>
        <app-field-error [control]="form.controls.to" [submitted]="submitted()" />
        @if (sameCity()) {
          <p class="field-error" role="alert">{{ 'ERRORS.SEARCH_SAME_CITY' | translate }}</p>
        }
      </div>
      <div class="sf-field">
        <label for="sf-date"><app-icon name="calendar" [size]="16" /> {{ 'SEARCH.DATE' | translate }}</label>
        <input id="sf-date" type="date" formControlName="date" [min]="today" />
        <div class="quick-dates">
          <button type="button" class="chip" [class.active]="form.value.date === today" (click)="setDate(today)">{{ 'SEARCH.TODAY' | translate }}</button>
          <button type="button" class="chip" [class.active]="form.value.date === tomorrow" (click)="setDate(tomorrow)">{{ 'SEARCH.TOMORROW' | translate }}</button>
        </div>
        <app-field-error [control]="form.controls.date" [submitted]="submitted()" />
      </div>
      <button type="submit" class="btn btn-primary btn-lg sf-submit">{{ 'SEARCH.SUBMIT' | translate }}</button>
    </form>
  `,
  styleUrl: './search-form.scss',
})
export class SearchForm implements OnInit {
  readonly from = input('');
  readonly to = input('');
  readonly date = input('');
  readonly compact = input(false);

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly cities = signal<string[]>(citiesCache ?? []);
  protected readonly submitted = signal(false);
  protected readonly today = istDate();
  protected readonly tomorrow = istDate(new Date(), 1);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    from: ['', Validators.required],
    to: ['', Validators.required],
    date: [this.today, Validators.required],
  });

  constructor() {
    // Keep the form in sync when the results page navigates to a new search.
    effect(() => {
      const value = { from: this.from(), to: this.to(), date: this.date() };
      this.form.patchValue({
        from: value.from || this.form.value.from,
        to: value.to || this.form.value.to,
        date: value.date || this.form.value.date,
      });
    });
  }

  async ngOnInit(): Promise<void> {
    if (!citiesCache) {
      try {
        citiesCache = (await this.api.cities()).cities;
        this.cities.set(citiesCache);
      } catch {
        /* the select stays empty; search still validates */
      }
    }
  }

  protected sameCity(): boolean {
    const { from, to } = this.form.getRawValue();
    return !!from && from === to;
  }

  protected swap(): void {
    const { from, to } = this.form.getRawValue();
    this.form.patchValue({ from: to, to: from });
  }

  protected setDate(date: string): void {
    this.form.patchValue({ date });
  }

  protected submit(): void {
    this.submitted.set(true);
    if (this.form.invalid || this.sameCity()) return;
    const { from, to, date } = this.form.getRawValue();
    this.router.navigate(['/search'], { queryParams: { from, to, date: date < this.today ? this.today : date } });
  }
}
