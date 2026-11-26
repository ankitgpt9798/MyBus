import { Component, computed, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PlannedRoute } from '../../core/models';
import { AppDatePipe, DurationPipe, NumPipe } from '../../shared/pipes';

export type CompareSort = 'time' | 'distance' | 'traffic';
type Column = 'distance' | 'time' | 'noTraffic' | 'delay' | 'congested' | 'congestion' | 'arrival' | 'incidents';
const CONGESTION_RANK = { low: 0, moderate: 1, heavy: 2 } as const;

/** Value used to compare routes in a column (lower is better). Null when there is no live traffic data. */
function value(r: PlannedRoute, c: Column): number | null {
  const s = r.summary;
  switch (c) {
    case 'distance':
      return s.distanceM;
    case 'time':
      return s.travelTimeS;
    case 'noTraffic':
      return s.noTrafficTimeS;
    case 'delay':
      return s.congestion === null ? null : s.trafficDelayS;
    case 'congested':
      return s.congestedPct;
    case 'congestion':
      return s.congestion === null ? null : CONGESTION_RANK[s.congestion];
    case 'arrival':
      return new Date(s.arrivalTime).getTime();
    case 'incidents':
      return s.incidents;
  }
}

/** Traffic impact for sorting: delay first, then the share of the route in traffic. */
const trafficImpact = (r: PlannedRoute) => r.summary.trafficDelayS * 1000 + (r.summary.congestedPct ?? 0);

/** All suggested routes side by side; sort by distance, time or traffic impact; best value per column highlighted. */
@Component({
  selector: 'app-compare-table',
  imports: [TranslatePipe, AppDatePipe, DurationPipe, NumPipe],
  template: `
    <div class="compare-head">
      <label for="cmp-sort" class="small">{{ 'PLANNER.COMPARE_BY' | translate }}</label>
      <select id="cmp-sort" [value]="sort()" (change)="sort.set($any($event.target).value)">
        <option value="time">{{ 'PLANNER.SORT.time' | translate }}</option>
        <option value="distance">{{ 'PLANNER.SORT.distance' | translate }}</option>
        @if (live()) {
          <option value="traffic">{{ 'PLANNER.SORT.traffic' | translate }}</option>
        }
      </select>
    </div>
    <div class="table-scroll" tabindex="0" role="region" [attr.aria-label]="'PLANNER.COMPARE_TITLE' | translate">
      <table class="compare">
        <caption class="sr-only">{{ 'PLANNER.COMPARE_CAPTION' | translate }}</caption>
        <thead>
          <tr>
            <th scope="col">{{ 'PLANNER.COL.route' | translate }}</th>
            <th scope="col" [attr.aria-sort]="sort() === 'distance' ? 'ascending' : null">{{ 'PLANNER.COL.distance' | translate }}</th>
            <th scope="col" [attr.aria-sort]="sort() === 'time' ? 'ascending' : null">{{ 'PLANNER.COL.time' | translate }}</th>
            <th scope="col">{{ 'PLANNER.COL.noTraffic' | translate }}</th>
            @if (live()) {
              <th scope="col" [attr.aria-sort]="sort() === 'traffic' ? 'ascending' : null">{{ 'PLANNER.COL.delay' | translate }}</th>
              <th scope="col">{{ 'PLANNER.COL.congested' | translate }}</th>
              <th scope="col">{{ 'PLANNER.COL.congestion' | translate }}</th>
            }
            <th scope="col">{{ 'PLANNER.COL.arrival' | translate }}</th>
            @if (live()) {
              <th scope="col">{{ 'PLANNER.COL.incidents' | translate }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (r of rows(); track r.id) {
            <tr [class.selected]="r.id === selectedId()" [attr.data-route]="r.id">
              <th scope="row">
                <button type="button" class="link pick" [attr.aria-pressed]="r.id === selectedId()" (click)="selected.emit(r.id)">{{ title()(r) }}</button>
              </th>
              <td data-col="distance" [class.best]="best('distance', r)">{{ 'PLANNER.KM' | translate: { km: (r.summary.distanceM / 1000 | num) } }}</td>
              <td data-col="time" [class.best]="best('time', r)">{{ minutes(r.summary.travelTimeS) | duration }}</td>
              <td data-col="noTraffic" [class.best]="best('noTraffic', r)">{{ minutes(r.summary.noTrafficTimeS) | duration }}</td>
              @if (live()) {
                <td data-col="delay" [class.best]="best('delay', r)">{{ 'PLANNER.MIN' | translate: { n: minutes(r.summary.trafficDelayS) } }}</td>
                <td data-col="congested" [class.best]="best('congested', r)">{{ r.summary.congestedPct ?? 0 | num }}%</td>
                <td data-col="congestion" [class.best]="best('congestion', r)">
                  <span [class]="'congestion ' + (r.summary.congestion ?? 'low')">{{ 'PLANNER.CONGESTION.' + (r.summary.congestion ?? 'low') | translate }}</span>
                </td>
              }
              <td data-col="arrival" [class.best]="best('arrival', r)">{{ r.summary.arrivalTime | appDate: 'time' }}</td>
              @if (live()) {
                <td data-col="incidents" [class.best]="best('incidents', r)">{{ r.summary.incidents ?? 0 | num }}</td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
    <p class="small muted best-note"><span class="best-chip" aria-hidden="true"></span>{{ 'PLANNER.BEST_NOTE' | translate }}</p>
  `,
  styles: `
    :host { display: grid; gap: 0.5rem; }
    .compare-head { display: flex; align-items: center; gap: 0.5rem; select { width: auto; min-width: 10rem; } }
    .table-scroll { overflow-x: auto; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); }
    .table-scroll:focus-visible { outline: 3px solid var(--color-primary); outline-offset: 2px; }
    .compare { width: 100%; border-collapse: collapse; font-size: 0.85rem; white-space: nowrap; }
    th, td { padding: 0.45rem 0.6rem; text-align: left; border-bottom: 1px solid var(--color-border); }
    thead th { font-size: 0.78rem; color: var(--color-text-muted); background: var(--color-surface-2); }
    tbody tr.selected { background: var(--color-primary-soft); }
    .pick { font-weight: 700; text-align: left; }
    td.best { font-weight: 700; color: var(--color-success); }
    .best-note { display: flex; align-items: center; gap: 0.35rem; margin: 0; }
    .best-chip { width: 10px; height: 10px; border-radius: 2px; background: var(--color-success); }
  `,
})
export class CompareTable {
  readonly routes = input.required<PlannedRoute[]>();
  readonly selectedId = input<string | null>(null);
  readonly live = input(false);
  /** Route title ("Fastest route" / "Alternative n"), provided by the planner. */
  readonly title = input.required<(r: PlannedRoute) => string>();
  readonly selected = output<string>();

  protected readonly sort = signal<CompareSort>('time');
  protected readonly rows = computed(() => {
    const list = [...this.routes()];
    const by = this.sort();
    return list.sort((a, b) =>
      by === 'distance' ? a.summary.distanceM - b.summary.distanceM : by === 'traffic' ? trafficImpact(a) - trafficImpact(b) : a.summary.travelTimeS - b.summary.travelTimeS,
    );
  });

  /** True when this route has the best (lowest) value in the column and the routes differ in it. */
  protected best(column: Column, r: PlannedRoute): boolean {
    const values = this.routes().map((x) => value(x, column));
    const mine = value(r, column);
    if (mine === null || values.some((v) => v === null) || this.routes().length < 2) return false;
    const min = Math.min(...(values as number[]));
    return mine === min && (values as number[]).some((v) => v !== min);
  }

  protected minutes(seconds: number): number {
    return Math.round(seconds / 60);
  }
}
