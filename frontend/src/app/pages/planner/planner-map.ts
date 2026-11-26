import { Component, ElementRef, OnDestroy, ViewEncapsulation, afterNextRender, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import * as L from 'leaflet/dist/leaflet-src.esm.js';
import { PlannedRoute, PlannerPlace, TrafficSection } from '../../core/models';
import { TRAFFIC_COLORS, TRAFFIC_LEVELS, trafficLevel } from './planner.traffic';

export interface MapStop {
  place: PlannerPlace;
  role: 'start' | 'via' | 'end';
  badge: string;
}

const INDIA: L.LatLngTuple = [21.5, 78.9];
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const TOMTOM_ATTRIBUTION = `&copy; ${new Date().getFullYear()} <a href="https://www.tomtom.com/" target="_blank" rel="noopener">TomTom</a>`;
/** After this many failed provider tiles, the map switches to OpenStreetMap. */
const TILE_ERRORS_BEFORE_FALLBACK = 4;

/**
 * Leaflet map for the route planner: provider tiles through the app's tile proxy (TomTom, night style in dark mode)
 * or OpenStreetMap, the suggested routes (selected one coloured by live traffic, others dimmed and clickable),
 * delay markers with details, an optional live traffic flow layer and A / 1…5 / B markers.
 */
@Component({
  selector: 'app-planner-map',
  encapsulation: ViewEncapsulation.None,
  imports: [TranslatePipe],
  template: `
    <div class="map-shell">
      <div #map class="planner-map" [class.osm-dark]="dark() && activeTiles() === 'osm'" role="region" [attr.aria-label]="'PLANNER.MAP_LABEL' | translate"></div>
      @if (liveTraffic()) {
        <label class="map-control traffic-toggle">
          <input type="checkbox" [checked]="showTraffic()" (change)="toggleTraffic($any($event.target).checked)" />
          {{ 'PLANNER.TRAFFIC_LAYER' | translate }}
        </label>
      }
      @if (legend()) {
        <div class="map-control map-legend" role="group" [attr.aria-label]="'PLANNER.LEGEND' | translate">
          @for (level of levels; track level) {
            <span class="legend-item" [attr.data-level]="level"><span [class]="'swatch ' + level" [style.background]="colors[level]"></span>{{ 'PLANNER.LEVELS.' + level | translate }}</span>
          }
        </div>
      }
    </div>
  `,
  styles: `
    app-planner-map { display: block; }
    .map-shell { position: relative; width: 100%; height: 100%; }
    .planner-map { width: 100%; height: 100%; min-height: 320px; border-radius: var(--radius-sm); background: var(--color-surface-2); z-index: 0; }
    .planner-map.osm-dark .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9); }
    .planner-map .leaflet-control-attribution { font-size: 11px; background: rgb(255 255 255 / 0.85); color: #333; }
    .planner-map .leaflet-control-attribution a { color: #0b57d0; }
    .planner-map .leaflet-bar a { color: #1f2329; }
    .map-control { position: absolute; z-index: 500; padding: 0.35rem 0.6rem; border-radius: 8px; background: rgb(255 255 255 / 0.94); color: #1f2329;
      box-shadow: 0 1px 4px rgb(0 0 0 / 0.3); font-size: 0.8rem; }
    .traffic-toggle { top: 10px; right: 10px; display: flex; align-items: center; gap: 0.35rem; font-weight: 600; cursor: pointer; }
    .map-legend { left: 10px; bottom: 26px; display: flex; flex-wrap: wrap; gap: 0.25rem 0.7rem; max-width: calc(100% - 20px); }
    .legend-item { display: inline-flex; align-items: center; gap: 0.3rem; }
    .swatch { display: inline-block; width: 18px; height: 5px; border-radius: 3px; }
    .swatch.closed { background: repeating-linear-gradient(90deg, #343a40 0 5px, transparent 5px 8px) !important; }
    .map-pin { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 4px rgb(0 0 0 / 0.45);
      color: #fff; font: 800 12px/1 system-ui, sans-serif; }
    .map-pin.start { background: #1e7a46; }
    .map-pin.end { background: #b5363e; }
    .map-pin.via { background: #3b5bdb; }
    .leaflet-div-icon.pin-icon { background: none; border: 0; }
    .delay-popup { display: grid; gap: 0.15rem; font: 13px/1.4 system-ui, sans-serif; color: #1f2329; strong { font-size: 14px; } }
  `,
})
export class PlannerMap implements OnDestroy {
  readonly routes = input<PlannedRoute[]>([]);
  readonly selectedId = input<string | null>(null);
  readonly stops = input<MapStop[]>([]);
  /** Tile source from the planner status (null while unknown). */
  readonly tiles = input<'tomtom' | 'osm' | null>(null);
  /** Traffic colours, delay markers and the traffic layer need live traffic. */
  readonly liveTraffic = input(false);
  /** Changes when a new plan arrives: the view is fitted to it (refreshes keep the user's view). */
  readonly fitKey = input(0);
  readonly routeSelected = output<string>();
  readonly mapClicked = output<{ lat: number; lon: number }>();
  readonly tilesFellBack = output<void>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private readonly translate = inject(TranslateService);
  protected readonly levels = TRAFFIC_LEVELS;
  protected readonly colors = TRAFFIC_COLORS;
  /** Follows the page theme (html[data-theme]) however it is changed. */
  protected readonly dark = signal(document.documentElement.getAttribute('data-theme') === 'dark');
  private readonly themeWatch = new MutationObserver(() => this.dark.set(document.documentElement.getAttribute('data-theme') === 'dark'));
  protected readonly activeTiles = signal<'tomtom' | 'osm' | null>(null);
  protected readonly showTraffic = signal(false);
  protected readonly legend = signal(false);
  private readonly ready = signal(false);
  private map?: L.Map;
  private tileLayer?: L.TileLayer;
  private trafficLayer?: L.TileLayer;
  private readonly routeLayer = L.layerGroup();
  private readonly markerLayer = L.layerGroup();
  private resize?: ResizeObserver;
  private tileErrors = 0;
  private lastFit = -1;

  constructor() {
    afterNextRender(() => {
      const el = this.host().nativeElement;
      this.map = L.map(el, { center: INDIA, zoom: 5, minZoom: 4, maxZoom: 19, worldCopyJump: false, zoomControl: true });
      this.map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
      this.routeLayer.addTo(this.map);
      this.markerLayer.addTo(this.map);
      this.map.on('click', (e: L.LeafletMouseEvent) => this.mapClicked.emit({ lat: e.latlng.lat, lon: e.latlng.lng }));
      this.resize = new ResizeObserver(() => this.map?.invalidateSize());
      this.resize.observe(el);
      this.themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      this.ready.set(true);
    });
    // Tile layer: provider choice from the status, the theme (TomTom night style) and a fallback after errors.
    effect(() => {
      const requested = this.tiles();
      const dark = this.dark();
      if (!this.ready() || !requested) return;
      untracked(() => this.setTiles(this.activeTiles() === 'osm' ? 'osm' : requested, dark));
    });
    effect(() => {
      const show = this.showTraffic() && this.liveTraffic() && this.activeTiles() === 'tomtom';
      const dark = this.dark();
      if (!this.ready()) return;
      untracked(() => this.setTrafficLayer(show, dark));
    });
    effect(() => {
      const routes = this.routes();
      const selected = this.selectedId();
      const live = this.liveTraffic();
      this.dark();
      this.translate.currentLang(); // popups are translated
      if (!this.ready()) return;
      untracked(() => this.drawRoutes(routes, selected, live));
    });
    effect(() => {
      const fit = this.fitKey();
      const routes = this.routes();
      if (!this.ready() || !routes.length || fit === this.lastFit) return;
      this.lastFit = fit;
      untracked(() => this.map?.fitBounds(L.latLngBounds(routes.flatMap((r) => r.bbox as L.LatLngTuple[])), { padding: [32, 32] }));
    });
    effect(() => {
      const stops = this.stops();
      if (!this.ready()) return;
      untracked(() => this.drawStops(stops));
    });
  }

  protected toggleTraffic(on: boolean): void {
    this.showTraffic.set(on);
  }

  private setTiles(source: 'tomtom' | 'osm', dark: boolean): void {
    if (!this.map) return;
    this.tileLayer?.remove();
    this.activeTiles.set(source);
    if (source === 'tomtom') {
      this.tileLayer = L.tileLayer(`/api/planner/tiles/{z}/{x}/{y}.png?style=${dark ? 'night' : 'main'}`, { maxZoom: 19, attribution: TOMTOM_ATTRIBUTION });
      this.tileLayer.on('tileerror', () => {
        if (++this.tileErrors >= TILE_ERRORS_BEFORE_FALLBACK && this.activeTiles() === 'tomtom') {
          this.setTiles('osm', this.dark());
          this.tilesFellBack.emit();
        }
      });
    } else {
      this.tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM_ATTRIBUTION });
    }
    this.tileLayer.addTo(this.map);
    this.tileLayer.bringToBack();
  }

  private setTrafficLayer(show: boolean, dark: boolean): void {
    this.trafficLayer?.remove();
    this.trafficLayer = undefined;
    if (!show || !this.map) return;
    this.trafficLayer = L.tileLayer(`/api/planner/traffic-tiles/{z}/{x}/{y}.png?style=${dark ? 'relative0-dark' : 'relative0'}`, {
      maxZoom: 19,
      opacity: 0.8,
      zIndex: 5,
      className: 'traffic-flow-tiles',
    });
    this.trafficLayer.addTo(this.map);
  }

  private popup(s: TrafficSection): HTMLElement {
    const t = (key: string, params?: Record<string, unknown>) => this.translate.instant(key, params);
    const minutes = Math.round(s.delayS / 60);
    const box = document.createElement('div');
    box.className = 'delay-popup';
    const title = document.createElement('strong');
    const form = new Intl.PluralRules(this.translate.currentLang() ?? 'en').select(minutes) === 'one' ? 'one' : 'other';
    title.textContent = minutes >= 1 ? t(`PLANNER.DELAY_MIN.${form}`, { count: minutes }) : t('PLANNER.NO_EXTRA_DELAY');
    const what = document.createElement('span');
    const key = `PLANNER.CATEGORY.${s.simpleCategory}`;
    what.textContent = `${t(key) === key ? t('PLANNER.CATEGORY.OTHER') : t(key)} · ${t(`PLANNER.LEVELS.${trafficLevel(s)}`)}`;
    box.append(title, what);
    if (s.effectiveSpeedKmh !== null) {
      const speed = document.createElement('span');
      speed.textContent = t('PLANNER.SPEED', { speed: Math.round(s.effectiveSpeedKmh) });
      box.append(speed);
    }
    return box;
  }

  private drawRoutes(routes: PlannedRoute[], selectedId: string | null, live: boolean): void {
    this.routeLayer.clearLayers();
    const dark = this.dark();
    const ordered = [...routes].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId));
    let sections = 0;
    for (const r of ordered) {
      const latlngs = r.points as L.LatLngTuple[];
      const selected = r.id === selectedId;
      if (selected) L.polyline(latlngs, { color: dark ? '#1f2329' : '#ffffff', weight: 10, opacity: 0.9, interactive: false }).addTo(this.routeLayer);
      const line = L.polyline(latlngs, {
        color: selected ? TRAFFIC_COLORS.free : dark ? '#aeb6c6' : '#6b7385',
        weight: selected ? 6 : 5,
        opacity: selected ? 0.95 : 0.6,
        className: `route-line ${selected ? 'route-selected' : 'route-alt'}`,
      });
      line.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        this.routeSelected.emit(r.id);
      });
      line.addTo(this.routeLayer);
      if (!selected || !live) continue;
      // Congested sections of the selected route in traffic colours, each with a delay marker.
      for (const s of r.trafficSections) {
        const part = latlngs.slice(s.startIndex, s.endIndex + 1);
        if (part.length < 2) continue;
        const level = trafficLevel(s);
        sections++;
        L.polyline(part, {
          color: TRAFFIC_COLORS[level],
          weight: 6,
          opacity: 1,
          dashArray: level === 'closed' ? '6 5' : undefined,
          className: `traffic-section traffic-${level}`,
          interactive: false,
        }).addTo(this.routeLayer);
        const mid = part[Math.floor(part.length / 2)];
        L.circleMarker(mid, { radius: 7, color: '#ffffff', weight: 2, fillColor: TRAFFIC_COLORS[level], fillOpacity: 1, className: `delay-marker delay-${level}` })
          .bindPopup(this.popup(s), { closeButton: true, autoPan: true })
          .addTo(this.routeLayer);
      }
    }
    this.legend.set(live && sections > 0);
  }

  private drawStops(stops: MapStop[]): void {
    this.markerLayer.clearLayers();
    for (const s of stops) {
      L.marker([s.place.lat, s.place.lon], {
        icon: L.divIcon({ className: 'pin-icon', html: `<span class="map-pin ${s.role}">${s.badge}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
        title: s.place.label,
        alt: s.place.label,
        keyboard: false,
      }).addTo(this.markerLayer);
    }
    if (!this.routes().length && stops.length) {
      if (stops.length === 1) this.map?.setView([stops[0].place.lat, stops[0].place.lon], Math.max(this.map.getZoom(), 9));
      else this.map?.fitBounds(L.latLngBounds(stops.map((s) => [s.place.lat, s.place.lon] as L.LatLngTuple)), { padding: [40, 40], maxZoom: 11 });
    }
  }

  ngOnDestroy(): void {
    this.resize?.disconnect();
    this.themeWatch.disconnect();
    this.map?.remove();
  }
}
