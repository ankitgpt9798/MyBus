import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-footer',
  imports: [RouterLink, TranslatePipe],
  template: `
    <footer class="site-footer">
      <div class="container footer-inner">
        <div>
          <strong class="footer-brand">My<span>Bus</span></strong>
          <p>{{ 'FOOTER.TAGLINE' | translate }}</p>
        </div>
        <nav class="footer-links" [attr.aria-label]="'FOOTER.LINKS' | translate">
          <a routerLink="/">{{ 'NAV.BUS_TICKETS' | translate }}</a>
          <a routerLink="/bookings">{{ 'NAV.MY_BOOKINGS' | translate }}</a>
          <a routerLink="/community">{{ 'NAV.COMMUNITY' | translate }}</a>
          <a routerLink="/route-planner">{{ 'NAV.ROUTE_PLANNER' | translate }}</a>
        </nav>
        <p class="footer-copy">{{ 'FOOTER.COPYRIGHT' | translate: { year: year } }}</p>
      </div>
    </footer>
  `,
})
export class Footer {
  protected readonly year = new Date().getFullYear();
}
