import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { BusType, DepartureSlot, SearchResponse } from '../../core/models';
import { istDate, isIsoDate, shiftDate } from '../../core/time';
import { Icon } from '../../shared/icons';
import { AppDatePipe, CityPipe, DurationPipe, InrPipe, NumPipe } from '../../shared/pipes';
import { SearchForm } from '../../shared/search-form';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';
import { TripDetailsPanel } from '../../shared/trip-details';

type SortKey = 'departure' | 'price' | 'duration' | 'seats';
type ListParam = 'busType' | 'ac' | 'slots' | 'operators';
const SORT_KEYS: SortKey[] = ['departure', 'price', 'duration', 'seats'];
const list = (v: string | undefined) => (v ? v.split(',').filter(Boolean) : []);
const num = (v: string | undefined) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Search results. All search state (route, date, filters, sort) lives in the URL query string,
 * so a results page can be bookmarked, reloaded and navigated with the back button.
 */
@Component({
  selector: 'app-search',
  imports: [RouterLink, TranslatePipe, SearchForm, Icon, TripDetailsPanel, AppDatePipe, CityPipe, DurationPipe, InrPipe, NumPipe, TranslateOrPipe],
  templateUrl: './search.html',
  styleUrl: './search.scss',
})
export class SearchPage {
  // Bound from query params (withComponentInputBinding).
  readonly from = input<string | undefined>(undefined);
  readonly to = input<string | undefined>(undefined);
  readonly date = input<string | undefined>(undefined);
  readonly busType = input<string | undefined>(undefined);
  readonly ac = input<string | undefined>(undefined);
  readonly slots = input<string | undefined>(undefined);
  readonly operators = input<string | undefined>(undefined);
  readonly minPrice = input<string | undefined>(undefined);
  readonly maxPrice = input<string | undefined>(undefined);
  readonly sort = input<string | undefined>(undefined);
  readonly order = input<string | undefined>(undefined);

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  protected readonly today = istDate();
  protected readonly allSlots: DepartureSlot[] = ['night', 'morning', 'afternoon', 'evening'];
  protected readonly busTypeOptions: BusType[] = ['seater', 'sleeper'];
  protected readonly acOptions = ['ac', 'nonac'] as const;
  protected readonly sortKeys = SORT_KEYS;

  protected readonly selectedBusTypes = computed(() => list(this.busType()));
  protected readonly selectedAc = computed(() => list(this.ac()));
  protected readonly selectedSlots = computed(() => list(this.slots()));
  protected readonly selectedOperators = computed(() => list(this.operators()));
  protected readonly minPriceValue = computed(() => num(this.minPrice()));
  protected readonly maxPriceValue = computed(() => num(this.maxPrice()));
  protected readonly sortKey = computed<SortKey>(() => (SORT_KEYS.includes(this.sort() as SortKey) ? (this.sort() as SortKey) : 'departure'));
  protected readonly sortOrder = computed(() => (this.order() === 'desc' ? 'desc' : 'asc'));
  protected readonly validDate = computed(() => (isIsoDate(this.date()) ? this.date()! : this.today));
  protected readonly hasQuery = computed(() => !!this.from() && !!this.to());
  protected readonly activeFilters = computed(
    () =>
      this.selectedBusTypes().length +
      this.selectedAc().length +
      this.selectedSlots().length +
      this.selectedOperators().length +
      (this.minPriceValue() !== null ? 1 : 0) +
      (this.maxPriceValue() !== null ? 1 : 0),
  );

  protected readonly result = signal<SearchResponse | null>(null);
  /** Filter options (fare range, operators) come from the unfiltered result for the current route/date. */
  protected readonly facets = signal<SearchResponse['meta'] | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly filtersOpen = signal(false);
  protected readonly openDetails = signal<string | null>(null);

  private searchKey = '';
  private requestId = 0;

  constructor() {
    effect(() => {
      if (!this.hasQuery()) return;
      // A past or malformed date is replaced by today.
      if (this.date() !== this.validDate() || this.validDate() < this.today) {
        untracked(() => this.setParams({ date: this.today }));
        return;
      }
      const params = {
        from: this.from(),
        to: this.to(),
        date: this.validDate(),
        busType: this.busType(),
        ac: this.ac(),
        slots: this.slots(),
        operators: this.operators(),
        minPrice: this.minPrice(),
        maxPrice: this.maxPrice(),
        sort: this.sortKey(),
        order: this.sortOrder(),
      };
      untracked(() => this.load(params));
    });
  }

  private async load(params: Record<string, string | undefined>): Promise<void> {
    const key = `${params['from']}|${params['to']}|${params['date']}`;
    if (key !== this.searchKey) {
      this.searchKey = key;
      this.facets.set(null);
      this.result.set(null);
      this.openDetails.set(null);
    }
    const id = ++this.requestId;
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.search(params);
      if (id !== this.requestId) return;
      this.result.set(res);
      if (!this.facets()) this.facets.set(res.meta);
    } catch (err) {
      if (id === this.requestId) this.error.set(errorKey(err));
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  /** Filter and sort changes replace the current history entry so Back returns to the previous search. */
  private setParams(params: Record<string, string | null>, replaceUrl = true): void {
    this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl });
  }

  protected toggle(param: ListParam, value: string): void {
    const current = list(this[param]());
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    this.setParams({ [param]: next.length ? next.join(',') : null });
  }

  protected isSelected(param: ListParam, value: string): boolean {
    return list(this[param]()).includes(value);
  }

  protected setSort(key: SortKey): void {
    const order = this.sortKey() === key ? (this.sortOrder() === 'asc' ? 'desc' : 'asc') : key === 'seats' ? 'desc' : 'asc';
    this.setParams({ sort: key, order });
  }

  protected setPrice(bound: 'min' | 'max', raw: string): void {
    const meta = this.facets();
    if (!meta) return;
    let min = bound === 'min' ? Number(raw) : (this.minPriceValue() ?? meta.minFare);
    let max = bound === 'max' ? Number(raw) : (this.maxPriceValue() ?? meta.maxFare);
    if (min > max) [min, max] = bound === 'min' ? [min, min] : [max, max];
    this.setParams({
      minPrice: min <= meta.minFare ? null : String(min),
      maxPrice: max >= meta.maxFare ? null : String(max),
    });
  }

  protected clearFilters(): void {
    this.setParams({ busType: null, ac: null, slots: null, operators: null, minPrice: null, maxPrice: null });
  }

  protected changeDay(days: number): void {
    const next = shiftDate(this.validDate(), days);
    if (next >= this.today) this.setParams({ date: next }, false);
  }

  protected toggleDetails(id: string): void {
    this.openDetails.set(this.openDetails() === id ? null : id);
  }

  protected arrivesNextDay(arrival: string, departure: string): boolean {
    return istDate(new Date(arrival)) !== istDate(new Date(departure));
  }
}
