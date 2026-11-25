import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe],
  template: `
    <div class="container section">
      <h1 class="page-title">{{ 'ADMIN.TITLE' | translate }}</h1>
      <nav class="tabs" [attr.aria-label]="'ADMIN.NAV' | translate">
        <a class="tab" routerLink="/admin" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">{{ 'ADMIN.DASHBOARD' | translate }}</a>
        <a class="tab" routerLink="/admin/trips" routerLinkActive="active">{{ 'ADMIN.TRIPS' | translate }}</a>
        <a class="tab" routerLink="/admin/bookings" routerLinkActive="active">{{ 'ADMIN.BOOKINGS' | translate }}</a>
        <a class="tab" routerLink="/admin/notifications" routerLinkActive="active">{{ 'ADMIN.NOTIFICATIONS' | translate }}</a>
        <a class="tab" routerLink="/admin/reviews" routerLinkActive="active">{{ 'ADMIN.REVIEWS_TAB' | translate }}</a>
        <a class="tab" routerLink="/admin/community" routerLinkActive="active">{{ 'ADMIN.COMMUNITY_TAB' | translate }}</a>
        <a class="tab" routerLink="/admin/offers" routerLinkActive="active">{{ 'ADMIN.OFFERS' | translate }}</a>
      </nav>
      <router-outlet />
    </div>
  `,
  styles: `.tabs a { text-decoration: none; }`,
})
export class AdminLayout {}
