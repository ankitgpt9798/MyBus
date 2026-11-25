import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { filter } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { Icon } from './icons';
import { NotificationBell } from './notification-bell';
import { PreferenceControls } from './preference-controls';

@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive, TranslatePipe, Icon, PreferenceControls, NotificationBell],
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
          @if (auth.isAdmin()) {
            <a routerLink="/admin" routerLinkActive="active">{{ 'NAV.ADMIN' | translate }}</a>
          }
          <app-preference-controls class="menu-prefs" place="menu" />
        </nav>

        <div class="header-actions">
          <app-preference-controls class="header-prefs" place="header" />
          <app-notification-bell />

          @if (auth.user(); as user) {
            <div class="user-menu">
              <button type="button" class="user-btn" (click)="userMenuOpen.set(!userMenuOpen())"
                [attr.aria-expanded]="userMenuOpen()" aria-haspopup="menu" [attr.aria-label]="'HEADER.ACCOUNT_MENU' | translate">
                <span class="avatar">{{ user.name.charAt(0).toUpperCase() }}</span>
                <span class="user-name">{{ user.name.split(' ')[0] }}</span>
              </button>
              @if (userMenuOpen()) {
                <div class="dropdown" role="menu">
                  <div class="dropdown-head">
                    <strong>{{ user.name }}</strong>
                    <small>{{ user.email }}</small>
                  </div>
                  <a routerLink="/profile" role="menuitem"><app-icon name="settings" [size]="16" /> {{ 'NAV.PROFILE' | translate }}</a>
                  <a [routerLink]="['/users', user.id]" role="menuitem" class="public-profile"><app-icon name="user" [size]="16" /> {{ 'NAV.PUBLIC_PROFILE' | translate }}</a>
                  <a routerLink="/bookings" role="menuitem"><app-icon name="ticket" [size]="16" /> {{ 'NAV.MY_BOOKINGS' | translate }}</a>
                  @if (auth.isAdmin()) {
                    <a routerLink="/admin" role="menuitem"><app-icon name="shield" [size]="16" /> {{ 'NAV.ADMIN' | translate }}</a>
                  }
                  <button type="button" role="menuitem" (click)="logout()"><app-icon name="logout" [size]="16" /> {{ 'NAV.LOGOUT' | translate }}</button>
                </div>
              }
            </div>
          } @else {
            <a routerLink="/login" class="btn btn-ghost btn-sm hide-xs">{{ 'NAV.LOGIN' | translate }}</a>
            <a routerLink="/register" class="btn btn-primary btn-sm">{{ 'NAV.SIGNUP' | translate }}</a>
          }

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
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly menuOpen = signal(false);
  protected readonly userMenuOpen = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        this.menuOpen.set(false);
        this.userMenuOpen.set(false);
      });
  }

  protected async logout(): Promise<void> {
    this.userMenuOpen.set(false);
    await this.auth.logout();
    this.toast.success('AUTH.LOGGED_OUT');
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    const menu = this.host.nativeElement.querySelector('.user-menu');
    if (this.userMenuOpen() && menu && !menu.contains(event.target as Node)) this.userMenuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.userMenuOpen.set(false);
    this.menuOpen.set(false);
  }
}
