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

  // Booking flow: seats -> passengers -> payment -> ticket
  { path: 'trip/:id', loadComponent: () => import('./pages/trip/trip').then((m) => m.TripPage), title: 'TITLES.TRIP' },
  {
    path: 'bookings',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/bookings/my-bookings').then((m) => m.MyBookingsPage),
    title: 'TITLES.MY_BOOKINGS',
  },
  {
    path: 'bookings/:id/passengers',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/checkout/passengers').then((m) => m.PassengersPage),
    title: 'TITLES.PASSENGERS',
  },
  {
    path: 'bookings/:id/pay',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/checkout/payment').then((m) => m.PaymentPage),
    title: 'TITLES.PAYMENT',
  },
  {
    path: 'bookings/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/bookings/booking-detail').then((m) => m.BookingDetailPage),
    title: 'TITLES.BOOKING',
  },

  // Admin
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/admin/admin-layout').then((m) => m.AdminLayout),
    children: [
      { path: '', loadComponent: () => import('./pages/admin/admin-dashboard').then((m) => m.AdminDashboardPage), title: 'TITLES.ADMIN' },
      { path: 'trips', loadComponent: () => import('./pages/admin/admin-trips').then((m) => m.AdminTripsPage), title: 'TITLES.ADMIN_TRIPS' },
      {
        path: 'bookings',
        loadComponent: () => import('./pages/admin/admin-bookings').then((m) => m.AdminBookingsPage),
        title: 'TITLES.ADMIN_BOOKINGS',
      },
      {
        path: 'notifications',
        loadComponent: () => import('./pages/admin/admin-notifications').then((m) => m.AdminNotificationsPage),
        title: 'TITLES.ADMIN_NOTIFICATIONS',
      },
      { path: 'offers', loadComponent: () => import('./pages/admin/admin-offers').then((m) => m.AdminOffersPage), title: 'TITLES.ADMIN_OFFERS' },
      { path: 'reviews', loadComponent: () => import('./pages/admin/admin-reviews').then((m) => m.AdminReviewsPage), title: 'TITLES.ADMIN_REVIEWS' },
    ],
  },
  { path: 'community', loadComponent: () => import('./pages/community/community').then((m) => m.CommunityPage), title: 'TITLES.COMMUNITY' },
  {
    path: 'community/new',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/community/post-editor').then((m) => m.PostEditorPage),
    title: 'TITLES.COMMUNITY_NEW',
  },
  { path: 'community/posts/:id', loadComponent: () => import('./pages/community/post-detail').then((m) => m.PostDetailPage), title: 'TITLES.COMMUNITY_POST' },
  { path: 'users/:id', loadComponent: () => import('./pages/users/user-profile').then((m) => m.UserProfilePage), title: 'TITLES.USER_PROFILE' },
  {
    path: 'community/posts/:id/edit',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/community/post-editor').then((m) => m.PostEditorPage),
    title: 'TITLES.COMMUNITY_EDIT',
  },
  { path: 'routes/:id', loadComponent: () => import('./pages/route/route-details').then((m) => m.RouteDetailsPage), title: 'TITLES.ROUTE' },
  {
    path: 'reviews/new',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/reviews/review-form').then((m) => m.ReviewFormPage),
    title: 'TITLES.REVIEW_NEW',
  },
  {
    path: 'reviews/:id/edit',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/reviews/review-form').then((m) => m.ReviewFormPage),
    title: 'TITLES.REVIEW_EDIT',
  },
  {
    path: 'notifications',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/notifications/notifications').then((m) => m.NotificationsPage),
    title: 'TITLES.NOTIFICATIONS',
  },
  { path: 'forbidden', loadComponent: () => import('./pages/forbidden/forbidden').then((m) => m.ForbiddenPage), title: 'TITLES.FORBIDDEN' },

  // Placeholders: each section is replaced by its real page as it is built.
  { path: 'route-planner', loadComponent: comingSoon, data: { feature: 'ROUTE_PLANNER' }, title: 'TITLES.ROUTE_PLANNER' },
  { path: '**', loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFoundPage), title: 'TITLES.NOT_FOUND' },
];
