import { Component, ElementRef, OnDestroy, ViewEncapsulation, afterNextRender, effect, input, output, signal, untracked, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import * as L from 'leaflet/dist/leaflet-src.esm.js';
import { PlannedRoute, PlannerPlace } from '../../core/models';

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
 * or OpenStreetMap, the suggested routes (selected one highlighted, others dimmed and clickable) and A / 1…5 / B markers.
 */
@Component({
  selector: 'app-planner-map',
  encapsulation: ViewEncapsulation.None,
  imports: [TranslatePipe],
  template: `<div #map class="planner-map" [class.osm-dark]="dark() && activeTiles() === 'osm'" role="region" [attr.aria-label]="'PLANNER.MAP_LABEL' | translate"></div>`,
  styles: `
    app-planner-map { display: block; }
    .planner-map { width: 100%; height: 100%; min-height: 320px; border-radius: var(--radius-sm); background: var(--color-surface-2); z-index: 0; }
    .planner-map.osm-dark .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9); }
    .planner-map .leaflet-control-attribution { font-size: 11px; background: rgb(255 255 255 / 0.85); color: #333; }
    .planner-map .leaflet-control-attribution a { color: #0b57d0; }
    .planner-map .leaflet-bar a { color: #1f2329; }
    .map-pin { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 4px rgb(0 0 0 / 0.45);
      color: #fff; font: 800 12px/1 system-ui, sans-serif; }
    .map-pin.start { background: #1e7a46; }
    .map-pin.end { background: #b5363e; }
    .map-pin.via { background: #3b5bdb; }
    .leaflet-div-icon.pin-icon { background: none; border: 0; }
  `,
})
export class PlannerMap implements OnDestroy {
  readonly routes = input<PlannedRoute[]>([]);
  readonly selectedId = input<string | null>(null);
  readonly stops = input<MapStop[]>([]);
  /** Tile source from the planner status (null while unknown). */
  readonly tiles = input<'tomtom' | 'osm' | null>(null);
  readonly routeSelected = output<string>();
  readonly mapClicked = output<{ lat: number; lon: number }>();
  readonly tilesFellBack = output<void>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('map');
  /** Follows the page theme (html[data-theme]) however it is changed. */
  protected readonly dark = signal(document.documentElement.getAttribute('data-theme') === 'dark');
  private readonly themeWatch = new MutationObserver(() => this.dark.set(document.documentElement.getAttribute('data-theme') === 'dark'));
  protected readonly activeTiles = signal<'tomtom' | 'osm' | null>(null);
  private readonly ready = signal(false);
  private map?: L.Map;
  private tileLayer?: L.TileLayer;
  private readonly routeLayer = L.layerGroup();
  private readonly markerLayer = L.layerGroup();
  private resize?: ResizeObserver;
  private tileErrors = 0;
  private lastFitKey = '';

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
      const routes = this.routes();
      const selected = this.selectedId();
      this.dark(); // alternatives get a lighter grey on dark tiles
      if (!this.ready()) return;
      untracked(() => this.drawRoutes(routes, selected));
    });
    effect(() => {
      const stops = this.stops();
      if (!this.ready()) return;
      untracked(() => this.drawStops(stops));
    });
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
  }

  private color(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  private drawRoutes(routes: PlannedRoute[], selectedId: string | null): void {
    this.routeLayer.clearLayers();
    const primary = this.color('--color-primary', '#b5363e');
    const ordered = [...routes].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId));
    for (const r of ordered) {
      const latlngs = r.points as L.LatLngTuple[];
      const selected = r.id === selectedId;
      if (selected) L.polyline(latlngs, { color: this.dark() ? '#1f2329' : '#ffffff', weight: 10, opacity: 0.9, interactive: false }).addTo(this.routeLayer);
      const line = L.polyline(latlngs, {
        color: selected ? primary : this.dark() ? '#aeb6c6' : '#6b7385',
        weight: selected ? 6 : 5,
        opacity: selected ? 0.95 : 0.6,
        className: `route-line ${selected ? 'route-selected' : 'route-alt'}`,
      });
      line.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        this.routeSelected.emit(r.id);
      });
      line.addTo(this.routeLayer);
    }
    // Fit the view when a new set of routes arrives (not when only the selection changes).
    const key = routes.map((r) => r.id + r.summary.distanceM).join('|');
    if (routes.length && key !== this.lastFitKey) {
      this.lastFitKey = key;
      const bounds = L.latLngBounds(routes.flatMap((r) => r.bbox as L.LatLngTuple[]));
      this.map?.fitBounds(bounds, { padding: [32, 32] });
    }
    if (!routes.length) this.lastFitKey = '';
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
