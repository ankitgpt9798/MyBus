import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

const toLogin = (router: Router, returnUrl: string) => router.createUrlTree(['/login'], { queryParams: { returnUrl } });

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? true : toLogin(inject(Router), state.url);
};

/** For features limited to verified accounts (posting reviews and community content). */
export const verifiedGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isLoggedIn()) return toLogin(router, state.url);
  return auth.isVerified() ? true : router.createUrlTree(['/profile'], { queryParams: { verify: 1 } });
};

export const adminGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isLoggedIn()) return toLogin(router, state.url);
  return auth.isAdmin() ? true : router.createUrlTree(['/forbidden']);
};

export const guestGuard: CanActivateFn = () => {
  return inject(AuthService).isLoggedIn() ? inject(Router).createUrlTree(['/']) : true;
};
