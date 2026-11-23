import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  AdminNotification,
  AdminPromotion,
  AdminStats,
  AppNotification,
  AdminTrip,
  Booking,
  HoldRequest,
  Passenger,
  NotificationType,
  PaymentMethod,
  PromotionDraft,
  PromotionTarget,
  RouteSummary,
  SearchResponse,
  TripDetails,
} from './models';

type Params = Record<string, string | number | boolean | undefined | null>;
const toParams = (p: Params) =>
  Object.entries(p).reduce((acc, [k, v]) => (v === undefined || v === null || v === '' ? acc : acc.set(k, String(v))), new HttpParams());

/** Promise-based client for the catalogue, booking and admin endpoints. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  private get<T>(url: string, params: Params = {}) {
    return firstValueFrom(this.http.get<T>(`/api${url}`, { params: toParams(params) }));
  }
  private post<T>(url: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(`/api${url}`, body));
  }
  private put<T>(url: string, body: unknown) {
    return firstValueFrom(this.http.put<T>(`/api${url}`, body));
  }
  private patch<T>(url: string, body: unknown) {
    return firstValueFrom(this.http.patch<T>(`/api${url}`, body));
  }

  // Catalogue
  cities() {
    return this.get<{ cities: string[] }>('/cities');
  }
  popularRoutes() {
    return this.get<{ routes: RouteSummary[] }>('/routes/popular');
  }
  search(params: Params) {
    return this.get<SearchResponse>('/trips/search', params);
  }
  trip(id: string) {
    return this.get<TripDetails>(`/trips/${id}`);
  }

  // Bookings: hold seats -> passenger details -> pay
  holdSeats(body: HoldRequest) {
    return this.post<{ booking: Booking }>('/bookings', body);
  }
  saveDetails(id: string, body: { passengers: Passenger[]; contact: { email: string; phone: string } }) {
    return this.put<{ booking: Booking }>(`/bookings/${id}/passengers`, body);
  }
  pay(id: string, method: PaymentMethod, simulateFailure = false) {
    return this.post<{ booking: Booking }>(`/bookings/${id}/pay`, { method, simulateFailure });
  }
  booking(id: string) {
    return this.get<{ booking: Booking }>(`/bookings/${id}`);
  }
  myBookings(tab: 'upcoming' | 'completed' | 'cancelled') {
    return this.get<{ bookings: Booking[] }>('/bookings/me', { tab });
  }
  cancelBooking(id: string, reason?: string) {
    return this.post<{ booking: Booking }>(`/bookings/${id}/cancel`, { reason });
  }

  // Notifications
  notifications(page = 1, limit = 20, filter: { type?: NotificationType | ''; unread?: boolean } = {}) {
    return this.get<{ notifications: AppNotification[]; total: number; unread: number; page: number; limit: number }>('/notifications', {
      page,
      limit,
      type: filter.type || undefined,
      unread: filter.unread ? 'true' : undefined,
    });
  }
  unreadCount() {
    return this.get<{ unread: number }>('/notifications/unread-count');
  }
  markNotificationRead(id: string) {
    return this.post<{ unread: number }>(`/notifications/${id}/read`);
  }
  markAllNotificationsRead() {
    return this.post<{ unread: number }>('/notifications/read-all');
  }
  /** Short-lived token for the live notification stream (EventSource cannot send headers). */
  notificationStreamToken() {
    return this.post<{ token: string; expiresIn: number }>('/notifications/stream-token');
  }
  pushPublicKey() {
    return this.get<{ publicKey: string }>('/notifications/push/public-key');
  }
  /** optIn: the user just turned push on here, so the account's push preference is switched on too. */
  pushSubscribe(subscription: PushSubscriptionJSON, optIn = false) {
    return this.post<{ subscribed: boolean; devices: number }>('/notifications/push/subscribe', { ...subscription, optIn });
  }
  /** optOut: the user turned push off, so the account's push preference is switched off on every device. */
  pushUnsubscribe(endpoint: string, optOut = false) {
    return this.post<{ subscribed: boolean; devices: number }>('/notifications/push/unsubscribe', { endpoint, optOut });
  }

  // Admin
  adminPromotions() {
    return this.get<{ promotions: AdminPromotion[] }>('/admin/promotions');
  }
  adminPromotionPreview(target: PromotionTarget) {
    return this.post<{ recipients: number; matched: number }>('/admin/promotions/preview', { target });
  }
  adminSendPromotion(draft: PromotionDraft) {
    return this.post<{ promotion: AdminPromotion }>('/admin/promotions', draft);
  }
  adminRetryNotification(id: string) {
    return this.post<{ notification: AdminNotification }>(`/admin/notifications/${id}/retry`);
  }
  adminNotifications(params: Params) {
    return this.get<{ notifications: AdminNotification[]; total: number; page: number; limit: number }>('/admin/notifications', params);
  }
  adminStats() {
    return this.get<AdminStats>('/admin/stats');
  }
  adminRoutes() {
    return this.get<{ routes: { id: string; from: string; to: string; code: string; durationMinutes: number }[] }>('/admin/routes');
  }
  adminBuses() {
    return this.get<{ buses: { id: string; name: string; registrationNumber: string; operatorName: string; totalSeats: number }[] }>('/admin/buses');
  }
  adminTrips(params: Params) {
    return this.get<{ trips: AdminTrip[]; total: number; page: number; limit: number }>('/admin/trips', params);
  }
  adminCreateTrip(body: { routeId: string; busId: string; departureTime: string; fare: number }) {
    return this.post<{ trip: AdminTrip }>('/admin/trips', body);
  }
  adminUpdateTrip(id: string, body: { departureTime?: string; arrivalTime?: string; fare?: number; status?: 'cancelled' }) {
    return this.patch<{ trip: AdminTrip; affectedBookings: number }>(`/admin/trips/${id}`, body);
  }
  adminBookings(params: Params) {
    return this.get<{ bookings: Booking[]; total: number; page: number; limit: number }>('/admin/bookings', params);
  }
}
