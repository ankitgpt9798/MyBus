import { Routes } from '@angular/router';

const comingSoon = () => import('./pages/coming-soon/coming-soon').then((m) => m.ComingSoonPage);

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home').then((m) => m.HomePage), title: 'TITLES.HOME' },
  // Placeholders: each section is replaced by its real page as it is built.
  { path: 'bookings', loadComponent: comingSoon, data: { feature: 'BOOKINGS' }, title: 'TITLES.MY_BOOKINGS' },
  { path: 'community', loadComponent: comingSoon, data: { feature: 'COMMUNITY' }, title: 'TITLES.COMMUNITY' },
  { path: 'route-planner', loadComponent: comingSoon, data: { feature: 'ROUTE_PLANNER' }, title: 'TITLES.ROUTE_PLANNER' },
  { path: 'notifications', loadComponent: comingSoon, data: { feature: 'NOTIFICATIONS' }, title: 'TITLES.NOTIFICATIONS' },
  { path: '**', loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFoundPage), title: 'TITLES.NOT_FOUND' },
];
