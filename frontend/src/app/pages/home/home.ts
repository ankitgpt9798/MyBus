import { Component, OnInit, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CommunityPost, RouteSummary, SavedRoute } from '../../core/models';
import { istDate } from '../../core/time';
import { Icon } from '../../shared/icons';
import { RouteRating } from '../../shared/route-rating';
import { CityPipe, DurationPipe, NumPipe } from '../../shared/pipes';
import { PluralPipe } from '../../shared/plural.pipe';
import { BOARD_ICONS } from '../../shared/post-card';
import { SearchForm } from '../../shared/search-form';

@Component({
  selector: 'app-home',
  imports: [RouterLink, TranslatePipe, SearchForm, Icon, CityPipe, DurationPipe, NumPipe, PluralPipe, RouteRating],
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

    @if (saved().length) {
      <section class="container section my-routes" aria-labelledby="my-routes-title">
        <div class="fc-head">
          <h2 class="section-title" id="my-routes-title">{{ 'HOME.SAVED_ROUTES' | translate }}</h2>
          <a routerLink="/route-planner" class="small fc-all">{{ 'HOME.OPEN_PLANNER' | translate }}</a>
        </div>
        <div class="fc-grid">
          @for (s of saved(); track s.id) {
            <a class="card fc-card saved-quick" [routerLink]="['/route-planner']" [queryParams]="{ saved: s.id }" [attr.data-saved]="s.id">
              <span class="badge"><app-icon name="map" [size]="12" /> {{ 'PLANNER.USED_TIMES' | plural: s.useCount : { count: (s.useCount | num) } }}</span>
              <strong class="fc-title">{{ s.name }}</strong>
              <span class="small muted fc-meta">{{ s.start.label }} → {{ s.end.label }}</span>
            </a>
          }
        </div>
      </section>
    }

    @if (trending().length) {
      <section class="container section from-community" aria-labelledby="fc-title">
        <div class="fc-head">
          <h2 class="section-title" id="fc-title">{{ 'HOME.FROM_COMMUNITY' | translate }}</h2>
          <a routerLink="/community" [queryParams]="{ sort: 'trending' }" class="small fc-all">{{ 'HOME.SEE_TRENDING' | translate }}</a>
        </div>
        <div class="fc-grid">
          @for (p of trending(); track p.id) {
            <article class="card fc-card" [attr.data-post]="p.id">
              <span class="badge fc-board"><app-icon [name]="icons[p.board]" [size]="12" /> {{ 'COMMUNITY.BOARDS.' + p.board + '.NAME' | translate }}</span>
              <h3 class="fc-title"><a [routerLink]="['/community/posts', p.id]" [attr.lang]="p.language">{{ p.title }}</a></h3>
              <p class="small muted fc-meta">
                {{ p.author.name }} · {{ 'COMMUNITY.LIKES' | plural: p.likeCount : { count: (p.likeCount | num) } }} ·
                {{ 'COMMUNITY.COMMENTS_COUNT' | plural: p.commentCount : { count: (p.commentCount | num) } }}
              </p>
            </article>
          }
        </div>
      </section>
    }

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
  protected readonly trending = signal<CommunityPost[]>([]);
  /** The signed-in user's three most used saved routes (quick access to the route planner). */
  protected readonly saved = signal<SavedRoute[]>([]);
  private readonly auth = inject(AuthService);

  constructor() {
    effect(() => {
      const user = this.auth.user();
      untracked(() => {
        if (!user) return this.saved.set([]);
        void this.api
          .savedRoutes('used', 3)
          .then((r) => this.saved.set(r.saved))
          .catch(() => this.saved.set([]));
      });
    });
  }
  protected readonly icons = BOARD_ICONS;
  protected readonly tomorrow = istDate(new Date(), 1);
  protected readonly features = [
    { key: 'SAFE', icon: 'shield' },
    { key: 'PRICE', icon: 'ticket' },
    { key: 'SUPPORT', icon: 'clock' },
  ];

  async ngOnInit(): Promise<void> {
    void this.api
      .trendingPosts(3)
      .then((r) => this.trending.set(r.posts))
      .catch(() => undefined); // the community strip is optional on the home page
    try {
      this.routes.set((await this.api.popularRoutes()).routes);
    } catch {
      /* popular routes are optional on the home page */
    } finally {
      this.loadingRoutes.set(false);
    }
  }
}
