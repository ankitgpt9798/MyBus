import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Board, CommunityPost } from '../core/models';
import { Icon } from './icons';
import { AppDatePipe, CityPipe, NumPipe } from './pipes';
import { PluralPipe } from './plural.pipe';

/** Icon per discussion board. */
export const BOARD_ICONS: Record<Board, string> = { stories: 'bus', tips: 'lightbulb', routes: 'map', destinations: 'pin', advice: 'help' };

/** A post in a feed: author, board and tags, title, excerpt, first photo, and like / comment / share counts. */
@Component({
  selector: 'app-post-card',
  imports: [RouterLink, TranslatePipe, Icon, AppDatePipe, CityPipe, NumPipe, PluralPipe],
  template: `
    <article class="post-card card" [attr.data-post]="post().id" [class.has-photo]="!!post().photos[0]">
      <div class="pc-main">
        <header class="pc-head small">
          @if (post().author.id && linkAuthor()) {
            <a class="cm-avatar sm" [routerLink]="['/users', post().author.id]" tabindex="-1" aria-hidden="true">{{ post().author.name.charAt(0) }}</a>
            <a class="pc-author cm-link" [routerLink]="['/users', post().author.id]">{{ post().author.name }}</a>
          } @else {
            <span class="cm-avatar sm" aria-hidden="true">{{ post().author.name.charAt(0) }}</span>
            <span class="pc-name">{{ post().author.name }}</span>
          }
          <span class="muted" aria-hidden="true">·</span>
          <time class="muted" [attr.datetime]="post().createdAt">{{ post().createdAt | appDate: 'date' }}</time>
          @if (post().popular) {
            <span class="badge badge-warning popular-badge"><app-icon name="trending" [size]="12" /> {{ 'COMMUNITY.POPULAR' | translate }}</span>
          }
        </header>
        <div class="pc-chips">
          @if (post().status !== 'visible') {
            <span class="badge badge-danger status-badge">{{ 'COMMUNITY.STATUS.' + post().status | translate }}</span>
          }
          <span [class]="'badge cm-board-chip board-chip tone-' + post().board"><app-icon [name]="icons[post().board]" [size]="12" /> {{ 'COMMUNITY.BOARDS.' + post().board + '.NAME' | translate }}</span>
          @if (post().route; as r) {
            <span class="badge cm-tag">{{ r.from | city }} → {{ r.to | city }}</span>
          }
          @if (post().city) {
            <span class="badge cm-tag"><app-icon name="pin" [size]="12" /> {{ post().city | city }}</span>
          }
        </div>
        <h3 class="pc-title"><a class="cm-link" [routerLink]="['/community/posts', post().id]" [attr.lang]="post().language">{{ post().title }}</a></h3>
        <p class="pc-excerpt" [attr.lang]="post().language">{{ post().body }}</p>
      </div>
      @if (post().photos[0]; as ph) {
        <a class="pc-thumb" [routerLink]="['/community/posts', post().id]" tabindex="-1" aria-hidden="true">
          <img [src]="ph.url" [alt]="ph.alt" [attr.width]="ph.width" [attr.height]="ph.height" loading="lazy" />
          @if (post().photos.length > 1) {
            <span class="more"><app-icon name="image" [size]="12" /> +{{ post().photos.length - 1 }}</span>
          }
        </a>
      }
      <footer class="pc-stats small muted">
        <span class="cm-stat"><app-icon name="heart" [size]="15" /> {{ 'COMMUNITY.LIKES' | plural: post().likeCount : { count: (post().likeCount | num) } }}</span>
        <span class="cm-stat"><app-icon name="comment" [size]="15" /> {{ 'COMMUNITY.COMMENTS_COUNT' | plural: post().commentCount : { count: (post().commentCount | num) } }}</span>
        <span class="cm-stat"><app-icon name="share" [size]="15" /> {{ 'COMMUNITY.SHARES' | plural: post().shareCount : { count: (post().shareCount | num) } }}</span>
        <a class="pc-read" [routerLink]="['/community/posts', post().id]" tabindex="-1" aria-hidden="true">{{ 'COMMUNITY.READ_MORE' | translate }} <app-icon name="arrow-right" [size]="14" /></a>
      </footer>
    </article>
  `,
  styles: `
    .post-card { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-areas: 'main' 'stats'; gap: 0.75rem 1.25rem; padding: 1.1rem 1.25rem; transition: border-color 0.15s, box-shadow 0.15s; }
    .post-card:hover { border-color: var(--color-primary); box-shadow: var(--shadow-md); }
    .post-card.has-photo { grid-template-columns: minmax(0, 1fr) 184px; grid-template-areas: 'main thumb' 'stats stats'; }
    .pc-main { grid-area: main; display: flex; flex-direction: column; gap: 0.45rem; min-width: 0; }
    .pc-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.45rem; min-width: 0; }
    .pc-name { font-weight: 600; }
    .popular-badge { gap: 0.25rem; margin-left: auto; }
    .pc-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .pc-title { margin: 0.1rem 0 0; font-size: 1.12rem; line-height: 1.3; }
    .pc-excerpt { margin: 0; max-width: 72ch; color: var(--color-text-muted); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .pc-thumb { grid-area: thumb; position: relative; align-self: start; aspect-ratio: 4 / 3; border-radius: var(--radius-sm); overflow: hidden; background: var(--color-surface-2); }
    .pc-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s; }
    .post-card:hover .pc-thumb img { transform: scale(1.04); }
    .more { position: absolute; right: 6px; bottom: 6px; display: inline-flex; align-items: center; gap: 0.2rem; padding: 0.1rem 0.45rem; border-radius: 999px; background: rgb(0 0 0 / 0.68); color: #fff; font-size: 0.76rem; font-weight: 700; }
    .pc-stats { grid-area: stats; display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 1.1rem; padding-top: 0.7rem; border-top: 1px solid var(--color-border); }
    .pc-read { display: inline-flex; align-items: center; gap: 0.25rem; margin-left: auto; font-weight: 600; text-decoration: none; }
    .pc-read:hover { text-decoration: underline; }
    @media (max-width: 600px) {
      .post-card, .post-card.has-photo { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'thumb' 'main' 'stats'; padding: 1rem; }
      .pc-thumb { aspect-ratio: 16 / 9; }
      .pc-read { display: none; }
    }
  `,
})
export class PostCard {
  readonly post = input.required<CommunityPost>();
  /** Off on a profile page, where every post is by the same person. */
  readonly linkAuthor = input(true);
  protected readonly icons = BOARD_ICONS;
}
