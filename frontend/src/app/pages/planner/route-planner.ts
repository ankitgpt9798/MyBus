import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, TitleStrategy } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { HttpErrorResponse } from '@angular/common/http';
import { errorCode, errorKey } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { PlanResponse, PlannedRoute, PlannerPlace, PlannerStatus, SavedPlace, SavedRoute, TrafficSection } from '../../core/models';
import { TranslatedTitleStrategy } from '../../core/title.strategy';
import { ToastService } from '../../core/toast.service';
import { Dialog } from '../../shared/dialog';
import { FieldError } from '../../shared/field-error';
import { Icon } from '../../shared/icons';
import { AppDatePipe, CityPipe, DurationPipe, NumPipe } from '../../shared/pipes';
import { PluralPipe } from '../../shared/plural.pipe';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';
import { CompareTable } from './compare-table';
import { PlaceInput } from './place-input';
import { MapStop, PlannerMap } from './planner-map';
import { CHANGE_THRESHOLD_S, DEFAULT_REFRESH_MS, IDLE_STOP_MS, fasterAlternative, matchRoute, trafficLevel } from './planner.traffic';
import { SAVED_NAME_MAX, SavedRoutesPanel } from './saved-routes';

type Field = 'start' | 'end' | number; // a number is a waypoint key
type City = { name: string; lat: number; lon: number };
type PlanBody = { start: { lat: number; lon: number }; end: { lat: number; lon: number }; waypoints: { lat: number; lon: number }[]; departAt?: string };
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
const savedPlace = (p: PlannerPlace): SavedPlace => ({ label: p.label, lat: p.lat, lon: p.lon });
const fromSaved = (p: SavedPlace): PlannerPlace => ({ id: `saved:${p.lat},${p.lon}`, label: p.label, address: '', lat: p.lat, lon: p.lon, type: 'pin' });

/**
 * Route planner (R3): start, destination and up to five stops with typeahead search; suggested routes with live
 * traffic (coloured on the map), a compare table, faster-route suggestions, saved routes and live updates while
 * the plan is open. The plan lives in the URL (?start&end&via, or ?saved=<id>).
 */
@Component({
  selector: 'app-route-planner',
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    Icon,
    Dialog,
    FieldError,
    PlaceInput,
    PlannerMap,
    CompareTable,
    SavedRoutesPanel,
    AppDatePipe,
    CityPipe,
    DurationPipe,
    NumPipe,
    PluralPipe,
    TranslateOrPipe,
  ],
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
  /** A saved route to open (quick access links). */
  readonly savedParam = input<string | undefined>(undefined, { alias: 'saved' });

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly titles = inject(TitleStrategy) as TranslatedTitleStrategy;
  protected readonly auth = inject(AuthService);
  protected readonly maxWaypoints = MAX_WAYPOINTS;
  protected readonly nameMax = SAVED_NAME_MAX;

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
  protected readonly view = signal<'list' | 'compare'>('list');
  /** Changes on every new plan so the map fits it (refreshes keep the user's view). */
  protected readonly fitKey = signal(0);

  // Live updates
  protected readonly lastUpdated = signal<string | null>(null);
  protected readonly refreshing = signal(false);
  protected readonly updates = signal<'off' | 'live' | 'paused' | 'stopped'>('off');
  /** The last traffic change of the selected route worth mentioning (seconds, + slower / − faster). */
  protected readonly change = signal<number | null>(null);
  private readonly dismissed = signal<{ routeId: string; savingS: number } | null>(null);

  // Saving
  protected readonly saveOpen = signal(false);
  protected readonly saveSubmitted = signal(false);
  protected readonly saveBusy = signal(false);
  protected readonly saveError = signal<{ key: string; params?: Record<string, unknown> } | null>(null);
  protected readonly savedVersion = signal(0);
  protected readonly saveName = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(SAVED_NAME_MAX)] });

  protected readonly canPlan = computed(() => !!this.start() && !!this.end() && !this.planning());
  /** False while the planner works without live traffic (no provider key or provider unavailable). */
  protected readonly liveTraffic = computed(() => this.result()?.liveTraffic ?? this.status()?.liveTraffic ?? true);
  protected readonly tiles = computed(() => (this.tilesFallback() ? 'osm' : (this.status()?.tiles ?? null)));
  private readonly refreshMs = computed(() => this.status()?.refreshMs ?? DEFAULT_REFRESH_MS);
  /** Id of the quickest suggested route (labelled "Fastest"); the others are numbered alternatives. */
  protected readonly fastestId = computed(() => {
    const routes = this.result()?.routes ?? [];
    return routes.length ? routes.reduce((best, r) => (r.summary.travelTimeS < best.summary.travelTimeS ? r : best)).id : null;
  });
  protected readonly selectedRoute = computed(() => this.result()?.routes.find((r) => r.id === this.selectedId()) ?? null);
  /** Traffic-based suggestion: a clearly faster alternative, unless dismissed and not significantly better since. */
  protected readonly suggestion = computed(() => {
    const res = this.result();
    if (!res?.liveTraffic) return null;
    const s = fasterAlternative(res.routes, this.selectedId());
    const d = this.dismissed();
    if (!s || (d && d.routeId === s.route.id && s.savingS < d.savingS + CHANGE_THRESHOLD_S)) return null;
    return s;
  });
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
  protected readonly titleFor = (r: PlannedRoute) => {
    const t = this.routeTitle(r);
    return this.translate.instant(t.key, { n: t.n });
  };

  private nextKey = 1;
  private restored = false;
  private lastBody: PlanBody | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastActivity = Date.now();

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
      const q = { start: this.startParam(), end: this.endParam(), via: this.viaParam(), from: this.fromCity(), to: this.toCity(), saved: this.savedParam() };
      if (this.restored) return;
      this.restored = true;
      untracked(() => void this.restore(q, citiesLoaded));
    });

    // Live updates pause while the tab is hidden or offline and resume when the user is back.
    const onVisibility = () => (document.visibilityState === 'visible' ? this.resume() : this.pause());
    const onOnline = () => this.resume();
    const onOffline = () => this.pause();
    const onActivity = () => {
      this.lastActivity = Date.now();
      if (this.updates() === 'stopped') this.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', onOnline);
    for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(type, onActivity, { passive: true });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', onOnline);
      for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.removeEventListener(type, onActivity);
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

  private async restore(
    q: { start?: string; end?: string; via?: string | string[]; from?: string; to?: string; saved?: string },
    citiesLoaded: Promise<City[]>,
  ): Promise<void> {
    if (q.saved && this.auth.isLoggedIn()) {
      const saved = (await this.api.savedRoutes().catch(() => ({ saved: [] as SavedRoute[] }))).saved.find((s) => s.id === q.saved);
      if (saved) return this.openSaved(saved);
    }
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

  private clearResult(): void {
    this.result.set(null);
    this.selectedId.set(null);
    this.change.set(null);
    this.dismissed.set(null);
    this.stopUpdates();
  }

  protected setField(field: Field, place: PlannerPlace | null): void {
    if (field === 'start') this.start.set(place);
    else if (field === 'end') this.end.set(place);
    else this.waypoints.update((list) => list.map((w) => (w.key === field ? { ...w, place } : w)));
    // The suggested routes no longer match the places.
    this.clearResult();
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
    this.clearResult();
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
    if (hadPlace) this.clearResult();
  }

  protected moveWaypoint(key: number, step: -1 | 1): void {
    const list = [...this.waypoints()];
    const i = list.findIndex((w) => w.key === key);
    const j = i + step;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.waypoints.set(list);
    this.clearResult();
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
    this.stopUpdates();
    try {
      const departAt = this.departLater() && this.departAt() ? new Date(this.departAt()).toISOString() : undefined;
      const body: PlanBody = { start: point(s), end: point(e), waypoints: via.map(point), departAt };
      const res = await this.api.planRoutes(body);
      this.lastBody = body;
      this.result.set(res);
      this.selectedId.set(this.fastestId());
      this.change.set(null);
      this.dismissed.set(null);
      this.fitKey.update((k) => k + 1);
      this.lastUpdated.set(res.fetchedAt);
      if (res.liveTraffic) this.startUpdates();
      // The URL update is a navigation, which resets the page title; the plan's title is set after it.
      void this.router
        .navigate([], {
          queryParams: { start: encodePlace(s), end: encodePlace(e), via: via.length ? via.map(encodePlace) : null, from: null, to: null, saved: null },
          replaceUrl: true,
        })
        .then(() => this.titles.setDynamicTitle(() => this.translate.instant('PLANNER.TAB_TITLE', { from: s.label, to: e.label })));
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

  // ---------- Live updates

  private startUpdates(): void {
    this.lastActivity = Date.now();
    this.updates.set(document.visibilityState === 'visible' && navigator.onLine ? 'live' : 'paused');
    this.schedule();
  }

  private stopUpdates(): void {
    clearTimeout(this.timer);
    this.updates.set('off');
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (this.updates() !== 'live') return;
    this.timer = setTimeout(() => void this.refresh(false), this.refreshMs());
  }

  private pause(): void {
    if (this.updates() === 'off') return;
    clearTimeout(this.timer);
    if (this.updates() === 'live') this.updates.set('paused');
  }

  /** Back on the page (visible, online, focused or active again): refresh now if the data is due, then keep going. */
  private resume(): void {
    if (this.updates() === 'off' || document.visibilityState !== 'visible' || !navigator.onLine) return;
    const wasLive = this.updates() === 'live';
    this.updates.set('live');
    this.lastActivity = Date.now();
    const age = Date.now() - new Date(this.lastUpdated() ?? 0).getTime();
    if (!wasLive && age >= this.refreshMs()) void this.refresh(false);
    else if (!wasLive) this.schedule();
  }

  /** Re-fetches the open plan and updates times, delays and colours in place (selection and map view are kept). */
  protected async refresh(manual: boolean): Promise<void> {
    const res = this.result();
    if (!res || !this.lastBody || this.planning() || this.refreshing()) return;
    if (!manual) {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return this.pause();
      if (Date.now() - this.lastActivity > IDLE_STOP_MS) {
        clearTimeout(this.timer);
        this.updates.set('stopped');
        return;
      }
    }
    this.refreshing.set(true);
    const body = this.lastBody;
    try {
      const next = await this.api.planRoutes(body);
      if (this.lastBody !== body || !this.result()) return; // the plan changed meanwhile
      const prev = res.routes.find((r) => r.id === this.selectedId());
      const same = prev ? matchRoute(prev, next.routes) : null;
      this.result.set(next);
      this.selectedId.set(same?.id ?? next.routes[0]?.id ?? null);
      this.lastUpdated.set(next.fetchedAt);
      if (!next.liveTraffic) this.updates.set('off');
      if (prev && same) {
        const delta = same.summary.travelTimeS - prev.summary.travelTimeS;
        if (Math.abs(delta) >= CHANGE_THRESHOLD_S) {
          const minutes = Math.round(Math.abs(delta) / 60);
          this.change.set(delta);
          this.toast.show(delta > 0 ? 'PLANNER.UPDATE_SLOWER' : 'PLANNER.UPDATE_FASTER', 'info', { count: minutes }, { count: minutes }, 6000);
        }
      }
      if (manual && this.updates() !== 'off') this.updates.set(document.visibilityState === 'visible' ? 'live' : 'paused');
    } catch (err) {
      // Keep showing the last routes; a refused or failed refresh is tried again at the next interval.
      if (manual) this.toast.error(errorKey(err));
    } finally {
      this.refreshing.set(false);
      this.schedule();
    }
  }

  // ---------- Suggestions

  protected switchTo(id: string): void {
    this.selectedId.set(id);
    this.dismissed.set(null);
  }

  protected dismissSuggestion(): void {
    const s = this.suggestion();
    if (s) this.dismissed.set({ routeId: s.route.id, savingS: s.savingS });
  }

  // ---------- Saved routes

  protected openSave(): void {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    const s = this.start();
    const e = this.end();
    this.saveName.reset(`${s?.label ?? ''} → ${e?.label ?? ''}`.slice(0, SAVED_NAME_MAX));
    this.saveSubmitted.set(false);
    this.saveError.set(null);
    this.saveOpen.set(true);
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const s = this.start();
    const e = this.end();
    this.saveSubmitted.set(true);
    this.saveName.setValue(this.saveName.value.trim());
    if (!s || !e || this.saveName.invalid) return;
    this.saveBusy.set(true);
    this.saveError.set(null);
    try {
      const via = this.waypoints()
        .map((w) => w.place)
        .filter((p): p is PlannerPlace => !!p);
      await this.api.saveRoute({ name: this.saveName.value, start: savedPlace(s), end: savedPlace(e), waypoints: via.map(savedPlace) });
      this.saveOpen.set(false);
      this.savedVersion.update((v) => v + 1);
      this.toast.success('PLANNER.SAVED_TOAST');
    } catch (err) {
      const existing = errorCode(err) === 'PLANNER_SAVED_DUPLICATE' ? (err as HttpErrorResponse).error?.details?.[0]?.params?.name : undefined;
      this.saveError.set(typeof existing === 'string' ? { key: 'PLANNER.ALREADY_SAVED_AS', params: { name: existing } } : { key: errorKey(err) });
    } finally {
      this.saveBusy.set(false);
    }
  }

  /** One click on a saved route: fill the planner with it, count the use and plan. */
  protected async openSaved(saved: SavedRoute): Promise<void> {
    this.start.set(fromSaved(saved.start));
    this.end.set(fromSaved(saved.end));
    this.waypoints.set(saved.waypoints.map((p) => ({ key: this.nextKey++, place: fromSaved(p) })));
    this.clearResult();
    void this.api
      .useSavedRoute(saved.id)
      .then(() => this.savedVersion.update((v) => v + 1))
      .catch(() => undefined);
    await this.plan();
  }

  // ---------- Display helpers

  /** "Fastest route" or "Alternative n" (alternatives numbered in the provider's order). */
  protected routeTitle(r: PlannedRoute): { key: string; n: number } {
    if (r.id === this.fastestId()) return { key: 'PLANNER.FASTEST', n: 0 };
    const others = (this.result()?.routes ?? []).filter((x) => x.id !== this.fastestId());
    return { key: 'PLANNER.ALTERNATIVE', n: others.findIndex((x) => x.id === r.id) + 1 };
  }

  protected minutes(seconds: number): number {
    return Math.round(seconds / 60);
  }

  protected km(meters: number): number {
    return Math.round(meters / 100) / 10;
  }

  protected level(s: TrafficSection): string {
    return trafficLevel(s);
  }

  protected category(s: TrafficSection): string {
    const key = `PLANNER.CATEGORY.${s.simpleCategory}`;
    return this.translate.instant(key) === key ? 'PLANNER.CATEGORY.OTHER' : key;
  }

  /** Arrival as a time, or with the date when it is not on the departure day (IST). */
  protected arrivalStyle(r: PlannedRoute): 'time' | 'datetime' {
    const day = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
    return day(r.summary.arrivalTime) === day(r.summary.departureTime) ? 'time' : 'datetime';
  }
}
