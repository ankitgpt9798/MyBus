import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { RouteSummary } from '../../core/models';
import { istDate } from '../../core/time';
import { Icon } from '../../shared/icons';
import { RouteRating } from '../../shared/route-rating';
import { CityPipe, DurationPipe, NumPipe } from '../../shared/pipes';
import { SearchForm } from '../../shared/search-form';

@Component({
  selector: 'app-home',
  imports: [RouterLink, TranslatePipe, SearchForm, Icon, CityPipe, DurationPipe, NumPipe, RouteRating],
  template: `
    <section class="hero">
      <div class="container">
        <h1>{{ 'HOME.TITLE' | translate }}</h1>
        <p class="hero-sub">{{ 'HOME.SUBTITLE' | translate }}</p>
        <app-search-form />
      </div>
    </section>

    <section class="container section">
      <div class="features">
        @for (f of features; track f.key) {
          <div class="feature card">
            <span class="feature-icon"><app-icon [name]="f.icon" [size]="22" /></span>
            <div>
              <h2>{{ 'HOME.FEATURES.' + f.key + '.TITLE' | translate }}</h2>
              <p class="muted">{{ 'HOME.FEATURES.' + f.key + '.TEXT' | translate }}</p>
            </div>
          </div>
        }
      </div>
    </section>

    <section class="container section">
      <h2 class="section-title">{{ 'HOME.POPULAR_ROUTES' | translate }}</h2>
      @if (routes().length) {
        <div class="route-grid">
          @for (r of routes(); track r.id) {
            <div class="route-card card">
              <a class="route-link" [routerLink]="['/search']" [queryParams]="{ from: r.from, to: r.to, date: tomorrow }">
                <div class="route-cities">
                  <strong>{{ r.from | city }}</strong>
                  <app-icon name="chevron-right" [size]="16" />
                  <strong>{{ r.to | city }}</strong>
                </div>
                <div class="muted small">
                  {{ 'HOME.ROUTE_META' | translate: { km: (r.distanceKm | num), duration: (r.durationMinutes | duration) } }}
                </div>
              </a>
              <app-route-rating class="card-rating" [routeId]="r.id" [avg]="r.ratingAvg" [count]="r.ratingCount" />
            </div>
          }
        </div>
      } @else if (loadingRoutes()) {
        <div class="route-grid">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="card skeleton route-skeleton"></div>
          }
        </div>
      }
    </section>

    <section class="container section">
      <div class="promo card">
        <div>
          <h2>{{ 'HOME.COMMUNITY_TITLE' | translate }}</h2>
          <p class="muted">{{ 'HOME.COMMUNITY_TEXT' | translate }}</p>
        </div>
        <div class="promo-actions">
          <a routerLink="/community" class="btn btn-outline">{{ 'NAV.COMMUNITY' | translate }}</a>
          <a routerLink="/route-planner" class="btn btn-ghost">{{ 'NAV.ROUTE_PLANNER' | translate }}</a>
        </div>
      </div>
    </section>
  `,
  styleUrl: './home.scss',
})
export class HomePage implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly routes = signal<RouteSummary[]>([]);
  protected readonly loadingRoutes = signal(true);
  protected readonly tomorrow = istDate(new Date(), 1);
  protected readonly features = [
    { key: 'SAFE', icon: 'shield' },
    { key: 'PRICE', icon: 'ticket' },
    { key: 'SUPPORT', icon: 'clock' },
  ];

  async ngOnInit(): Promise<void> {
    try {
      this.routes.set((await this.api.popularRoutes()).routes);
    } catch {
      /* popular routes are optional on the home page */
    } finally {
      this.loadingRoutes.set(false);
    }
  }
}
