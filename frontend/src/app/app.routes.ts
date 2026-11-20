import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/guards';

const comingSoon = () => import('./pages/coming-soon/coming-soon').then((m) => m.ComingSoonPage);

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home').then((m) => m.HomePage), title: 'TITLES.HOME' },
  { path: 'search', loadComponent: () => import('./pages/search/search').then((m) => m.SearchPage), title: 'TITLES.SEARCH' },

  // Accounts
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./pages/auth/login').then((m) => m.LoginPage), title: 'TITLES.LOGIN' },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/auth/register').then((m) => m.RegisterPage),
    title: 'TITLES.REGISTER',
  },
  { path: 'verify-email', loadComponent: () => import('./pages/auth/verify-email').then((m) => m.VerifyEmailPage), title: 'TITLES.VERIFY' },
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/profile/profile').then((m) => m.ProfilePage),
    title: 'TITLES.PROFILE',
  },
  { path: 'admin', canActivate: [adminGuard], loadComponent: comingSoon, data: { feature: 'ADMIN' }, title: 'TITLES.ADMIN' },
  { path: 'forbidden', loadComponent: () => import('./pages/forbidden/forbidden').then((m) => m.ForbiddenPage), title: 'TITLES.FORBIDDEN' },

  // Placeholders: each section is replaced by its real page as it is built.
  { path: 'trip/:id', loadComponent: comingSoon, data: { feature: 'SEATS' }, title: 'TITLES.TRIP' },
  { path: 'bookings', loadComponent: comingSoon, data: { feature: 'BOOKINGS' }, title: 'TITLES.MY_BOOKINGS' },
  { path: 'community', loadComponent: comingSoon, data: { feature: 'COMMUNITY' }, title: 'TITLES.COMMUNITY' },
  { path: 'route-planner', loadComponent: comingSoon, data: { feature: 'ROUTE_PLANNER' }, title: 'TITLES.ROUTE_PLANNER' },
  { path: 'notifications', loadComponent: comingSoon, data: { feature: 'NOTIFICATIONS' }, title: 'TITLES.NOTIFICATIONS' },
  { path: '**', loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFoundPage), title: 'TITLES.NOT_FOUND' },
];
