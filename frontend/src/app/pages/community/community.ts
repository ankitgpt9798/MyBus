import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { errorKey } from '../../core/api-error';
import { Board, BoardInfo, CommunityPost, Contributor, PostSort } from '../../core/models';
import { Icon } from '../../shared/icons';
import { CityPipe, NumPipe } from '../../shared/pipes';
import { PluralPipe } from '../../shared/plural.pipe';
import { BOARD_ICONS, PostCard } from '../../shared/post-card';
import { TranslateOrPipe } from '../../shared/translate-or.pipe';

const BOARDS: Board[] = ['stories', 'tips', 'routes', 'destinations', 'advice'];
const SORTS: PostSort[] = ['latest', 'trending', 'top', 'discussed'];
const PAGE_SIZE = 10;

/** Community home: discussion boards and a feed filtered by board, route or destination (?board&routeId&city&sort). */
@Component({
  selector: 'app-community',
  imports: [RouterLink, TranslatePipe, Icon, CityPipe, NumPipe, PluralPipe, PostCard, TranslateOrPipe],
  templateUrl: './community.html',
  styleUrl: './community.scss',
})
export class CommunityPage {
  readonly board = input<string | undefined>(undefined);
  readonly routeId = input<string | undefined>(undefined);
  readonly city = input<string | undefined>(undefined);
  readonly sort = input<string | undefined>(undefined);

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly boards = BOARDS;
  protected readonly sorts = SORTS;
  protected readonly icons = BOARD_ICONS;

  protected readonly boardInfo = signal<BoardInfo[]>([]);
  protected readonly routes = signal<{ id: string; from: string; to: string }[]>([]);
  protected readonly cities = signal<string[]>([]);
  protected readonly trending = signal<CommunityPost[]>([]);
  protected readonly contributors = signal<Contributor[]>([]);
  protected readonly posts = signal<CommunityPost[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly activeBoard = computed(() => (BOARDS.includes(this.board() as Board) ? (this.board() as Board) : null));
  protected readonly activeSort = computed<PostSort>(() => (SORTS.includes(this.sort() as PostSort) ? (this.sort() as PostSort) : 'latest'));
  protected readonly filtered = computed(() => !!(this.activeBoard() || this.routeId() || this.city()));

  constructor() {
    void this.api.communityBoards().then((r) => this.boardInfo.set(r.boards)).catch(() => undefined);
    void this.api.allRoutes().then((r) => this.routes.set(r.routes)).catch(() => undefined);
    void this.api.cities().then((r) => this.cities.set(r.cities)).catch(() => undefined);
    void this.api.trendingPosts(4).then((r) => this.trending.set(r.posts)).catch(() => undefined);
    void this.api.topContributors().then((r) => this.contributors.set(r.contributors)).catch(() => undefined);
    effect(() => {
      const query = { board: this.activeBoard() ?? undefined, routeId: this.routeId() || undefined, city: this.city() || undefined, sort: this.activeSort() };
      untracked(() => void this.load(query, 1));
    });
  }

  protected postsOn(board: Board): number {
    return this.boardInfo().find((b) => b.id === board)?.posts ?? 0;
  }

  private async load(query: { board?: string; routeId?: string; city?: string; sort: PostSort }, page: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.communityPosts({ ...query, page, limit: PAGE_SIZE });
      this.posts.update((list) => (page === 1 ? res.posts : [...list, ...res.posts.filter((p) => !list.some((x) => x.id === p.id))]));
      this.total.set(res.total);
      this.page.set(page);
    } catch (err) {
      this.error.set(errorKey(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected loadMore(): void {
    void this.load(
      { board: this.activeBoard() ?? undefined, routeId: this.routeId() || undefined, city: this.city() || undefined, sort: this.activeSort() },
      this.page() + 1,
    );
  }

  /** Filters live in the URL so a filtered feed can be linked to (e.g. from a route page). */
  protected setFilter(patch: { board?: string | null; routeId?: string | null; city?: string | null; sort?: string | null }): void {
    void this.router.navigate([], { queryParams: patch, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected clearFilters(): void {
    void this.router.navigate([], { queryParams: { board: null, routeId: null, city: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
}
