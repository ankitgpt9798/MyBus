import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink, TitleStrategy } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { ActivityItem, CommunityPost, ProfileComment, ProfileReview, PublicProfile } from '../../core/models';
import { TranslatedTitleStrategy } from '../../core/title.strategy';
import { Icon } from '../../shared/icons';
import { AppDatePipe, CityPipe, NumPipe } from '../../shared/pipes';
import { PluralPipe } from '../../shared/plural.pipe';
import { PostCard } from '../../shared/post-card';
import { Stars } from '../../shared/stars';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';

type Tab = 'activity' | 'posts' | 'comments' | 'reviews';
const TABS: Tab[] = ['activity', 'posts', 'comments', 'reviews'];
const ACTIVITY_ICONS: Record<ActivityItem['type'], string> = {
  post: 'users',
  comment: 'bell',
  review: 'star',
  like_post: 'check',
  like_comment: 'check',
  helpful: 'shield',
};

/** Public profile (/users/:id?tab=): badges, stats and the member's visible posts, comments, reviews and activity. */
@Component({
  selector: 'app-user-profile',
  imports: [RouterLink, TranslatePipe, Icon, AppDatePipe, CityPipe, NumPipe, PluralPipe, PostCard, Stars, TranslateOrPipe],
  templateUrl: './user-profile.html',
  styleUrl: './user-profile.scss',
})
export class UserProfilePage {
  readonly id = input.required<string>();
  readonly tab = input<string | undefined>(undefined);

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly titles = inject(TitleStrategy) as TranslatedTitleStrategy;
  protected readonly tabs = TABS;
  protected readonly icons = ACTIVITY_ICONS;

  protected readonly profile = signal<PublicProfile | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly activeTab = computed<Tab>(() => (TABS.includes(this.tab() as Tab) ? (this.tab() as Tab) : 'activity'));

  protected readonly activity = signal<ActivityItem[]>([]);
  protected readonly nextActivity = signal<string | null>(null);
  protected readonly posts = signal<CommunityPost[]>([]);
  protected readonly comments = signal<ProfileComment[]>([]);
  protected readonly reviews = signal<ProfileReview[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly listLoading = signal(false);
  protected readonly listError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.loadProfile(id));
    });
    effect(() => {
      const id = this.id();
      const tab = this.activeTab();
      untracked(() => void this.loadTab(id, tab, true));
    });
  }

  private async loadProfile(id: string): Promise<void> {
    this.error.set(null);
    this.titles.setDynamicTitle(null);
    try {
      const p = await this.api.userProfile(id);
      this.profile.set(p);
      this.titles.setDynamicTitle(() => p.user.name);
    } catch (err) {
      this.profile.set(null);
      this.error.set(errorKey(err));
    }
  }

  private async loadTab(id: string, tab: Tab, reset: boolean): Promise<void> {
    this.listLoading.set(true);
    this.listError.set(null);
    const page = reset ? 1 : this.page() + 1;
    try {
      if (tab === 'activity') {
        const res = await this.api.userActivity(id, reset ? undefined : (this.nextActivity() ?? undefined));
        this.activity.update((list) => (reset ? res.items : [...list, ...res.items.filter((i) => !list.some((x) => x.key === i.key))]));
        this.nextActivity.set(res.next);
      } else if (tab === 'posts') {
        const res = await this.api.userPosts(id, page);
        this.posts.update((list) => (reset ? res.posts : [...list, ...res.posts]));
        this.total.set(res.total);
      } else if (tab === 'comments') {
        const res = await this.api.userComments(id, page);
        this.comments.update((list) => (reset ? res.comments : [...list, ...res.comments]));
        this.total.set(res.total);
      } else {
        const res = await this.api.userReviews(id, page);
        this.reviews.update((list) => (reset ? res.reviews : [...list, ...res.reviews]));
        this.total.set(res.total);
      }
      this.page.set(page);
    } catch (err) {
      this.listError.set(errorKey(err));
    } finally {
      this.listLoading.set(false);
    }
  }

  protected more(): void {
    void this.loadTab(this.id(), this.activeTab(), false);
  }

  protected hasMore(): boolean {
    const tab = this.activeTab();
    if (tab === 'activity') return !!this.nextActivity();
    const shown = tab === 'posts' ? this.posts().length : tab === 'comments' ? this.comments().length : this.reviews().length;
    return shown < this.total();
  }

  protected setTab(tab: Tab): void {
    void this.router.navigate([], { queryParams: { tab: tab === 'activity' ? null : tab }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  /** Arrow keys move between tabs (WAI-ARIA tabs pattern). */
  protected tabKey(event: KeyboardEvent, index: number): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length];
    this.setTab(next);
    setTimeout(() => document.getElementById(`tab-${next}`)?.focus());
  }
}
