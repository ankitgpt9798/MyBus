import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink, TitleStrategy } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { RatingSummary, ReportReason, ReviewSort, RouteDetails, RouteReview, StarKey } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { Dialog } from '../../shared/dialog';
import { Icon } from '../../shared/icons';
import { AppDatePipe, CityPipe, DurationPipe, InrPipe, NumPipe } from '../../shared/pipes';
import { ShareBar } from '../../shared/share-bar';
import { Stars } from '../../shared/stars';
import { PluralPipe } from '../../shared/plural.pipe';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';
import { TranslatedTitleStrategy } from '../../core/title.strategy';
import { istDate } from '../../core/time';

const PAGE_SIZE = 5;
const SORTS: ReviewSort[] = ['recent', 'helpful', 'highest', 'lowest'];
const REPORT_REASONS: ReportReason[] = ['spam', 'offensive', 'irrelevant', 'fake', 'other'];
const STARS: StarKey[] = ['5', '4', '3', '2', '1'];

/** Route details: stops, operators, next departures, the rating summary and genuine travellers' reviews (R6). */
@Component({
  selector: 'app-route-details',
  imports: [RouterLink, ReactiveFormsModule, TranslatePipe, Icon, Stars, Dialog, ShareBar, AppDatePipe, CityPipe, DurationPipe, InrPipe, NumPipe, TranslateOrPipe, PluralPipe],
  templateUrl: './route-details.html',
  styleUrl: './route-details.scss',
})
export class RouteDetailsPage {
  readonly id = input.required<string>();
  /** Shared links point straight at the route page (no preview card needed). */
  protected readonly routeUrl = computed(() => `${location.origin}/routes/${this.id()}`);

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);
  private readonly titles = inject(TitleStrategy) as TranslatedTitleStrategy;

  protected readonly sorts = SORTS;
  protected readonly stars = STARS;
  protected readonly reasons = REPORT_REASONS;
  protected readonly today = istDate();

  protected readonly details = signal<RouteDetails | null>(null);
  protected readonly summary = signal<RatingSummary | null>(null);
  protected readonly reviews = signal<RouteReview[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly sort = signal<ReviewSort>('recent');
  protected readonly loading = signal(true);
  protected readonly loadingReviews = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly verifyPrompt = signal(false);
  protected readonly busy = signal<string | null>(null);

  protected readonly boarding = computed(() => this.details()?.route.stops.filter((s) => s.type === 'boarding') ?? []);
  protected readonly dropping = computed(() => this.details()?.route.stops.filter((s) => s.type === 'dropping') ?? []);

  // Report dialog
  protected readonly reporting = signal<RouteReview | null>(null);
  protected readonly reportError = signal<string | null>(null);
  protected readonly reportForm = inject(FormBuilder).nonNullable.group({
    reason: ['' as ReportReason | '', Validators.required],
    note: ['', Validators.maxLength(300)],
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.titles.setDynamicTitle(null); // generic "Route details" while loading or on error
    try {
      const [details] = await Promise.all([this.api.route(id), this.loadReviews(1)]);
      this.details.set(details);
      // "Delhi to Lucknow | MyBus" in the current language, re-rendered when the language changes.
      const { from, to } = details.route;
      this.titles.setDynamicTitle(() => this.translate.instant('ROUTE.TAB_TITLE', { from: this.cityName(from), to: this.cityName(to) }));
    } catch (err) {
      this.error.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadReviews(page: number): Promise<void> {
    this.loadingReviews.set(true);
    try {
      const res = await this.api.routeReviews(this.id(), this.sort(), page, PAGE_SIZE);
      this.reviews.update((list) => (page === 1 ? res.reviews : [...list, ...res.reviews.filter((r) => !list.some((x) => x.id === r.id))]));
      this.summary.set(res.summary);
      this.total.set(res.total);
      this.page.set(page);
    } finally {
      this.loadingReviews.set(false);
    }
  }

  protected setSort(sort: ReviewSort): void {
    if (sort === this.sort()) return;
    this.sort.set(sort);
    void this.loadReviews(1).catch((err) => this.toast.error(errorKey(err)));
  }

  protected loadMore(): void {
    void this.loadReviews(this.page() + 1).catch((err) => this.toast.error(errorKey(err)));
  }

  private cityName(name: string): string {
    const key = `CITY.${name}`;
    const value = this.translate.instant(key) as string;
    return value === key ? name : value;
  }

  protected starNumber(star: StarKey): number {
    return Number(star);
  }

  protected percent(star: StarKey): number {
    const s = this.summary();
    return s?.count ? Math.round((s.distribution[star] / s.count) * 100) : 0;
  }

  /** Voting and reporting need a signed-in, verified account. */
  private canAct(): boolean {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return false;
    }
    if (!this.auth.isVerified()) {
      this.verifyPrompt.set(true);
      return false;
    }
    return true;
  }

  protected async toggleHelpful(r: RouteReview): Promise<void> {
    if (!this.canAct()) return;
    this.busy.set(r.id);
    try {
      const res = await this.api.toggleHelpful(r.id);
      this.reviews.update((list) => list.map((x) => (x.id === r.id ? { ...x, helpfulByMe: res.helpful, helpfulCount: res.helpfulCount } : x)));
    } catch (err) {
      this.toast.error(errorKey(err));
    } finally {
      this.busy.set(null);
    }
  }

  protected openReport(r: RouteReview): void {
    if (!this.canAct()) return;
    this.reportForm.reset({ reason: '', note: '' });
    this.reportError.set(null);
    this.reporting.set(r);
  }

  protected async submitReport(): Promise<void> {
    const r = this.reporting();
    if (!r) return;
    if (this.reportForm.invalid) {
      this.reportForm.markAllAsTouched();
      return;
    }
    const { reason, note } = this.reportForm.getRawValue();
    this.busy.set(r.id);
    this.reportError.set(null);
    try {
      const res = await this.api.reportReview(r.id, { reason: reason as ReportReason, note: note.trim() || undefined });
      this.reporting.set(null);
      if (res.hidden) {
        // Enough reports: hidden pending moderation, and no longer in the average.
        this.reviews.update((list) => list.filter((x) => x.id !== r.id));
        this.total.update((t) => t - 1);
        const fresh = await this.api.routeReviews(this.id(), this.sort(), 1, 1);
        this.summary.set(fresh.summary);
        this.toast.success('REVIEWS.REPORT_HIDDEN');
      } else {
        this.reviews.update((list) => list.map((x) => (x.id === r.id ? { ...x, reportedByMe: true } : x)));
        this.toast.success('REVIEWS.REPORT_SENT');
      }
    } catch (err) {
      this.reportError.set(errorKey(err));
    } finally {
      this.busy.set(null);
    }
  }
}
