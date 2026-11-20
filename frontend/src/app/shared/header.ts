import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { filter } from 'rxjs';
import { Icon } from './icons';

@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive, TranslatePipe, Icon],
  template: `
    <header class="site-header">
      <div class="container header-inner">
        <a routerLink="/" class="brand" [attr.aria-label]="'APP.NAME' | translate">
          <span class="brand-mark"><app-icon name="bus" [size]="22" /></span>
          <span class="brand-text">My<strong>Bus</strong></span>
        </a>

        <nav class="main-nav" [class.open]="menuOpen()" [attr.aria-label]="'HEADER.MAIN_NAV' | translate">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">{{ 'NAV.BUS_TICKETS' | translate }}</a>
          <a routerLink="/bookings" routerLinkActive="active">{{ 'NAV.MY_BOOKINGS' | translate }}</a>
          <a routerLink="/community" routerLinkActive="active">{{ 'NAV.COMMUNITY' | translate }}</a>
          <a routerLink="/route-planner" routerLinkActive="active">{{ 'NAV.ROUTE_PLANNER' | translate }}</a>
        </nav>

        <div class="header-actions">
          <a routerLink="/notifications" class="icon-btn" [attr.aria-label]="'NAV.NOTIFICATIONS' | translate"
            [title]="'NAV.NOTIFICATIONS' | translate">
            <app-icon name="bell" />
          </a>
          <button type="button" class="icon-btn menu-toggle" (click)="menuOpen.set(!menuOpen())"
            [attr.aria-expanded]="menuOpen()" [attr.aria-label]="'HEADER.MENU' | translate">
            <app-icon [name]="menuOpen() ? 'close' : 'menu'" />
          </button>
        </div>
      </div>
    </header>
  `,
  styleUrl: './header.scss',
})
export class Header {
  protected readonly menuOpen = signal(false);

  constructor() {
    inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.menuOpen.set(false));
  }
}
