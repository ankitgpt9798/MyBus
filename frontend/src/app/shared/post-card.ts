import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Board, CommunityPost } from '../core/models';
import { Icon } from './icons';
import { AppDatePipe, CityPipe, NumPipe } from './pipes';
import { PluralPipe } from './plural.pipe';

/** Icon per discussion board. */
export const BOARD_ICONS: Record<Board, string> = { stories: 'bus', tips: 'check', routes: 'map', destinations: 'pin', advice: 'users' };

/** A post in the community feed: board, tags, excerpt, first photo, likes and comments. */
@Component({
  selector: 'app-post-card',
  imports: [RouterLink, TranslatePipe, Icon, AppDatePipe, CityPipe, NumPipe, PluralPipe],
  template: `
    <article class="post-card card" [attr.data-post]="post().id">
      <div class="pc-main">
        <div class="pc-chips">
          @if (post().popular) {
            <span class="badge badge-warning popular-badge"><app-icon name="trending" [size]="12" /> {{ 'COMMUNITY.POPULAR' | translate }}</span>
          }
          @if (post().status !== 'visible') {
            <span class="badge badge-danger status-badge">{{ 'COMMUNITY.STATUS.' + post().status | translate }}</span>
          }
          <span class="badge board-chip"><app-icon [name]="icons[post().board]" [size]="12" /> {{ 'COMMUNITY.BOARDS.' + post().board + '.NAME' | translate }}</span>
          @if (post().route; as r) {
            <span class="badge">{{ r.from | city }} → {{ r.to | city }}</span>
          }
          @if (post().city) {
            <span class="badge"><app-icon name="pin" [size]="12" /> {{ post().city | city }}</span>
          }
        </div>
        <h3 class="pc-title"><a [routerLink]="['/community/posts', post().id]">{{ post().title }}</a></h3>
        <p class="pc-meta small muted">
          @if (post().author.id && linkAuthor()) {
            <a class="pc-author" [routerLink]="['/users', post().author.id]">{{ post().author.name }}</a>
          } @else {
            {{ post().author.name }}
          }
          · {{ post().createdAt | appDate: 'date' }}
        </p>
        <p class="pc-excerpt" [attr.lang]="post().language">{{ post().body }}</p>
        <p class="pc-stats small muted">
          <span>{{ 'COMMUNITY.LIKES' | plural: post().likeCount : { count: (post().likeCount | num) } }}</span> ·
          <span>{{ 'COMMUNITY.COMMENTS_COUNT' | plural: post().commentCount : { count: (post().commentCount | num) } }}</span>
        </p>
      </div>
      @if (post().photos[0]; as ph) {
        <a class="pc-thumb" [routerLink]="['/community/posts', post().id]" tabindex="-1" aria-hidden="true">
          <img [src]="ph.url" [alt]="ph.alt" loading="lazy" />
          @if (post().photos.length > 1) {
            <span class="more">+{{ post().photos.length - 1 }}</span>
          }
        </a>
      }
    </article>
  `,
  styles: `
    .post-card { display: flex; gap: 1rem; }
    .pc-main { display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; flex: 1; }
    .pc-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .board-chip, .popular-badge { gap: 0.25rem; }
    .pc-author { color: inherit; font-weight: 600; }
    .pc-title { margin: 0.1rem 0 0; font-size: 1.08rem; overflow-wrap: anywhere; }
    .pc-title a { color: var(--color-text); text-decoration: none; }
    .pc-title a:hover { color: var(--color-primary); text-decoration: underline; }
    .pc-meta, .pc-stats { margin: 0; }
    .pc-excerpt { margin: 0; white-space: pre-line; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
    .pc-thumb { position: relative; flex: none; width: 140px; height: 105px; border-radius: var(--radius-sm); overflow: hidden; background: var(--color-surface-2); }
    .pc-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .more { position: absolute; right: 6px; bottom: 6px; padding: 0.05rem 0.4rem; border-radius: 999px; background: rgb(0 0 0 / 0.65); color: #fff; font-size: 0.78rem; font-weight: 700; }
    @media (max-width: 560px) {
      .post-card { flex-direction: column-reverse; }
      .pc-thumb { width: 100%; height: 160px; }
    }
  `,
})
export class PostCard {
  readonly post = input.required<CommunityPost>();
  /** Off on a profile page, where every post is by the same person. */
  readonly linkAuthor = input(true);
  protected readonly icons = BOARD_ICONS;
}
