import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { PlanResponse, PlannedRoute, PlannerPlace, PlannerStatus } from '../../core/models';
import { Icon } from '../../shared/icons';
import { AppDatePipe, CityPipe, DurationPipe, NumPipe } from '../../shared/pipes';
import { PluralPipe } from '../../shared/plural.pipe';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';
import { PlaceInput } from './place-input';
import { MapStop, PlannerMap } from './planner-map';

type Field = 'start' | 'end' | number; // a number is a waypoint key
type City = { name: string; lat: number; lon: number };
const MAX_WAYPOINTS = 5;
const COORD = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,(.*))?$/;

/** "lat,lon,label" in the URL so a plan can be bookmarked and shared. */
const encodePlace = (p: PlannerPlace) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)},${p.label}`;
function decodePlace(value: string | undefined): PlannerPlace | null {
  const m = value?.match(COORD);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const label = (m[3] ?? '').trim().slice(0, 120) || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  return { id: `url:${lat},${lon}`, label, address: '', lat, lon, type: 'pin' };
}
const point = (p: PlannerPlace) => ({ lat: p.lat, lon: p.lon });

/**
 * Route planner (R3): start, destination and up to five stops with typeahead search, suggested routes with
 * alternatives, ETAs and traffic delays on an interactive map. The plan lives in the URL (?start&end&via).
 */
@Component({
  selector: 'app-route-planner',
  imports: [TranslatePipe, Icon, PlaceInput, PlannerMap, AppDatePipe, CityPipe, DurationPipe, NumPipe, PluralPipe, TranslateOrPipe],
  templateUrl: './route-planner.html',
  styleUrl: './route-planner.scss',
})
export class RoutePlannerPage {
  readonly startParam = input<string | undefined>(undefined, { alias: 'start' });
  readonly endParam = input<string | undefined>(undefined, { alias: 'end' });
  readonly viaParam = input<string | string[] | undefined>(undefined, { alias: 'via' });
  /** City names from links on route and trip pages (?from=Mumbai&to=Pune). */
  readonly fromCity = input<string | undefined>(undefined, { alias: 'from' });
  readonly toCity = input<string | undefined>(undefined, { alias: 'to' });

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  protected readonly maxWaypoints = MAX_WAYPOINTS;

  protected readonly status = signal<PlannerStatus | null>(null);
  protected readonly cities = signal<City[]>([]);
  protected readonly start = signal<PlannerPlace | null>(null);
  protected readonly end = signal<PlannerPlace | null>(null);
  protected readonly waypoints = signal<{ key: number; place: PlannerPlace | null }[]>([]);
  protected readonly activeField = signal<Field>('start');
  protected readonly departLater = signal(false);
  protected readonly departAt = signal('');
  protected readonly result = signal<PlanResponse | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly planning = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly tilesFallback = signal(false);

  /** Id of the quickest suggested route (labelled "Fastest"); the others are numbered alternatives. */
  protected readonly fastestId = computed(() => {
    const routes = this.result()?.routes ?? [];
    return routes.length ? routes.reduce((best, r) => (r.summary.travelTimeS < best.summary.travelTimeS ? r : best)).id : null;
  });
  protected readonly canPlan = computed(() => !!this.start() && !!this.end() && !this.planning());
  /** False while the planner works without live traffic (no provider key or provider unavailable). */
  protected readonly liveTraffic = computed(() => this.result()?.liveTraffic ?? this.status()?.liveTraffic ?? true);
  protected readonly tiles = computed(() => (this.tilesFallback() ? 'osm' : (this.status()?.tiles ?? null)));
  protected readonly stops = computed<MapStop[]>(() => {
    const list: MapStop[] = [];
    const s = this.start();
    if (s) list.push({ place: s, role: 'start', badge: 'A' });
    this.waypoints().forEach((w, i) => w.place && list.push({ place: w.place, role: 'via', badge: String(i + 1) }));
    const e = this.end();
    if (e) list.push({ place: e, role: 'end', badge: 'B' });
    return list;
  });
  protected readonly minDepart = computed(() => {
    const d = new Date(Date.now() + 5 * 60_000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });

  private nextKey = 1;
  private restored = false;

  constructor() {
    void this.api
      .plannerStatus()
      .then((s) => this.status.set(s))
      .catch(() => this.status.set({ provider: 'osrm', liveTraffic: false, tiles: 'osm' }));
    const citiesLoaded = this.api
      .plannerCities()
      .then((r) => {
        this.cities.set(r.cities);
        return r.cities;
      })
      .catch(() => [] as City[]);
    // Restore the plan once from the URL; later URL changes come from this page itself.
    effect(() => {
      const q = { start: this.startParam(), end: this.endParam(), via: this.viaParam(), from: this.fromCity(), to: this.toCity() };
      if (this.restored) return;
      this.restored = true;
      untracked(() => void this.restore(q, citiesLoaded));
    });
  }

  private cityLabel(name: string): string {
    const key = `CITY.${name}`;
    const t = this.translate.instant(key);
    return t === key ? name : t;
  }

  private cityPlace(c: City): PlannerPlace {
    return { id: `city:${c.name}`, label: this.cityLabel(c.name), address: '', lat: c.lat, lon: c.lon, type: 'city' };
  }

  private async restore(q: { start?: string; end?: string; via?: string | string[]; from?: string; to?: string }, citiesLoaded: Promise<City[]>): Promise<void> {
    let start = decodePlace(q.start);
    let end = decodePlace(q.end);
    const via = (Array.isArray(q.via) ? q.via : q.via ? [q.via] : [])
      .map((v) => decodePlace(v))
      .filter((p): p is PlannerPlace => !!p)
      .slice(0, MAX_WAYPOINTS);
    if ((!start && q.from) || (!end && q.to)) {
      const list = await citiesLoaded;
      const find = (name?: string) => list.find((c) => c.name === name);
      if (!start && find(q.from)) start = this.cityPlace(find(q.from)!);
      if (!end && find(q.to)) end = this.cityPlace(find(q.to)!);
    }
    this.start.set(start);
    this.end.set(end);
    this.waypoints.set(via.map((place) => ({ key: this.nextKey++, place })));
    this.activeField.set(!start ? 'start' : !end ? 'end' : 'start');
    if (start && end) await this.plan();
  }

  protected setField(field: Field, place: PlannerPlace | null): void {
    if (field === 'start') this.start.set(place);
    else if (field === 'end') this.end.set(place);
    else this.waypoints.update((list) => list.map((w) => (w.key === field ? { ...w, place } : w)));
    // The suggested routes no longer match the places.
    this.result.set(null);
    this.selectedId.set(null);
    this.error.set(null);
  }

  /** Quick picks and map clicks fill the field in focus, then move on to the destination. */
  private fillActive(place: PlannerPlace): void {
    const field = this.activeField();
    this.setField(field, place);
    if (field === 'start' && !this.end()) this.activeField.set('end');
  }

  protected pickCity(c: City): void {
    this.fillActive(this.cityPlace(c));
  }

  protected onMapClick(p: { lat: number; lon: number }): void {
    this.fillActive({ id: `pin:${p.lat},${p.lon}`, label: `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`, address: '', lat: p.lat, lon: p.lon, type: 'pin' });
  }

  protected swap(): void {
    const [s, e] = [this.start(), this.end()];
    const had = !!this.result();
    this.start.set(e);
    this.end.set(s);
    this.waypoints.update((list) => [...list].reverse());
    this.result.set(null);
    this.selectedId.set(null);
    if (had && e && s) void this.plan();
  }

  protected addWaypoint(): void {
    if (this.waypoints().length >= MAX_WAYPOINTS) return;
    const key = this.nextKey++;
    this.waypoints.update((list) => [...list, { key, place: null }]);
    this.activeField.set(key);
    setTimeout(() => document.getElementById(`via-${key}`)?.focus());
  }

  protected removeWaypoint(key: number): void {
    const hadPlace = !!this.waypoints().find((w) => w.key === key)?.place;
    this.waypoints.update((list) => list.filter((w) => w.key !== key));
    if (this.activeField() === key) this.activeField.set('end');
    if (hadPlace) {
      this.result.set(null);
      this.selectedId.set(null);
    }
  }

  protected moveWaypoint(key: number, step: -1 | 1): void {
    const list = [...this.waypoints()];
    const i = list.findIndex((w) => w.key === key);
    const j = i + step;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.waypoints.set(list);
    this.result.set(null);
    this.selectedId.set(null);
    setTimeout(() => document.querySelector<HTMLElement>(`[data-key="${key}"] .${step < 0 ? 'via-up' : 'via-down'}:not([disabled])`)?.focus());
  }

  protected async plan(): Promise<void> {
    const s = this.start();
    const e = this.end();
    if (!s || !e || this.planning()) return;
    const via = this.waypoints()
      .map((w) => w.place)
      .filter((p): p is PlannerPlace => !!p);
    this.planning.set(true);
    this.error.set(null);
    try {
      const departAt = this.departLater() && this.departAt() ? new Date(this.departAt()).toISOString() : undefined;
      const res = await this.api.planRoutes({ start: point(s), end: point(e), waypoints: via.map(point), departAt });
      this.result.set(res);
      this.selectedId.set(this.fastestId());
      void this.router.navigate([], {
        queryParams: { start: encodePlace(s), end: encodePlace(e), via: via.length ? via.map(encodePlace) : null, from: null, to: null },
        replaceUrl: true,
      });
    } catch (err) {
      this.result.set(null);
      this.error.set(errorKey(err));
    } finally {
      this.planning.set(false);
    }
  }

  protected submit(event: Event): void {
    event.preventDefault();
    void this.plan();
  }

  /** "Fastest route" or "Alternative n" (alternatives numbered in the provider's order). */
  protected routeTitle(r: PlannedRoute): { key: string; n: number } {
    if (r.id === this.fastestId()) return { key: 'PLANNER.FASTEST', n: 0 };
    const others = (this.result()?.routes ?? []).filter((x) => x.id !== this.fastestId());
    return { key: 'PLANNER.ALTERNATIVE', n: others.findIndex((x) => x.id === r.id) + 1 };
  }

  protected minutes(seconds: number): number {
    return Math.round(seconds / 60);
  }

  /** Arrival as a time, or with the date when it is not on the departure day (IST). */
  protected arrivalStyle(r: PlannedRoute): 'time' | 'datetime' {
    const day = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
    return day(r.summary.arrivalTime) === day(r.summary.departureTime) ? 'time' : 'datetime';
  }
}
