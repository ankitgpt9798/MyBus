import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  ActivityItem,
  AdminCommunityItem,
  BoardInfo,
  CommunityComment,
  CommunityPost,
  ContentRemoveReason,
  ContentReportReason,
  ContentStatus,
  Contributor,
  PlanResponse,
  PlannerPlace,
  PlannerStatus,
  PostSort,
  ProfileComment,
  ProfileReview,
  PublicProfile,
  ShareNetwork,
  AdminNotification,
  AdminPromotion,
  AdminReview,
  EligibleJourney,
  MyReview,
  RatingSummary,
  RemoveReason,
  ReportReason,
  RouteDetails,
  RouteReview,
  RouteReviewsResponse,
  ReviewSort,
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
  private del<T>(url: string) {
    return firstValueFrom(this.http.delete<T>(`/api${url}`));
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
  route(id: string) {
    return this.get<RouteDetails>(`/routes/${id}`);
  }
  allRoutes() {
    return this.get<{ routes: { id: string; from: string; to: string }[] }>('/routes');
  }

  // Community
  communityBoards() {
    return this.get<{ boards: BoardInfo[] }>('/community/boards');
  }
  communityPosts(params: { board?: string; routeId?: string; city?: string; sort?: PostSort; page?: number; limit?: number }) {
    return this.get<{ posts: CommunityPost[]; total: number; page: number; limit: number; sort: PostSort }>('/community/posts', params);
  }
  communityPost(id: string) {
    return this.get<{ post: CommunityPost; comments: CommunityComment[] }>(`/community/posts/${id}`);
  }
  /** Multipart: board, title, body, routeId, city, alts (JSON), photos[]. */
  createPost(form: FormData) {
    return this.post<{ post: CommunityPost }>('/community/posts', form);
  }
  /** Multipart: changed fields, keep (JSON [{ file, alt }]), alts (JSON), new photos[]. */
  updatePost(id: string, form: FormData) {
    return this.patch<{ post: CommunityPost }>(`/community/posts/${id}`, form);
  }
  deletePost(id: string) {
    return this.del<{ deleted: boolean }>(`/community/posts/${id}`);
  }
  likePost(id: string) {
    return this.post<{ liked: boolean; likeCount: number }>(`/community/posts/${id}/like`);
  }
  addComment(postId: string, body: string, parentId?: string) {
    return this.post<{ comment: CommunityComment; commentCount: number }>(`/community/posts/${postId}/comments`, { body, parentId });
  }
  deleteComment(id: string) {
    return this.del<{ deleted: boolean; commentCount: number }>(`/community/comments/${id}`);
  }
  likeComment(id: string) {
    return this.post<{ liked: boolean; likeCount: number }>(`/community/comments/${id}/like`);
  }
  trendingPosts(limit = 4) {
    return this.get<{ posts: CommunityPost[] }>('/community/trending', { limit });
  }
  topContributors() {
    return this.get<{ contributors: Contributor[]; days: number }>('/community/contributors');
  }
  reportPost(id: string, report: { reason: ContentReportReason; note?: string }) {
    return this.post<{ reported: boolean; hidden: boolean }>(`/community/posts/${id}/report`, report);
  }
  reportComment(id: string, report: { reason: ContentReportReason; note?: string }) {
    return this.post<{ reported: boolean; hidden: boolean; commentCount: number }>(`/community/comments/${id}/report`, report);
  }
  sharePost(id: string, network: ShareNetwork) {
    return this.post<{ counted: boolean; shareCount: number }>(`/community/posts/${id}/share`, { network });
  }
  visitPost(id: string, source: ShareNetwork) {
    return this.post<{ counted: boolean; visitCount: number }>(`/community/posts/${id}/visit`, { source });
  }

  // Route planner
  plannerStatus() {
    return this.get<PlannerStatus>('/planner/status');
  }
  plannerCities() {
    return this.get<{ cities: { name: string; lat: number; lon: number }[] }>('/planner/cities');
  }
  plannerSearch(q: string, lang: string, near?: { lat: number; lon: number } | null) {
    return this.get<{ results: PlannerPlace[]; provider: 'tomtom' | 'mybus' }>('/planner/search', { q, lang, near: near ? `${near.lat},${near.lon}` : undefined });
  }
  planRoutes(body: { start: { lat: number; lon: number }; end: { lat: number; lon: number }; waypoints: { lat: number; lon: number }[]; departAt?: string }) {
    return this.post<PlanResponse>('/planner/routes', body);
  }

  // Public profiles
  userProfile(id: string) {
    return this.get<PublicProfile>(`/users/${id}/profile`);
  }
  userPosts(id: string, page = 1) {
    return this.get<{ posts: CommunityPost[]; total: number; page: number; limit: number }>(`/users/${id}/posts`, { page });
  }
  userComments(id: string, page = 1) {
    return this.get<{ comments: ProfileComment[]; total: number; page: number; limit: number }>(`/users/${id}/comments`, { page });
  }
  userReviews(id: string, page = 1) {
    return this.get<{ reviews: ProfileReview[]; total: number; page: number; limit: number }>(`/users/${id}/reviews`, { page });
  }
  userActivity(id: string, before?: string) {
    return this.get<{ items: ActivityItem[]; next: string | null }>(`/users/${id}/activity`, before ? { before } : {});
  }

  // Reviews
  routeReviews(routeId: string, sort: ReviewSort = 'recent', page = 1, limit = 10) {
    return this.get<RouteReviewsResponse>(`/routes/${routeId}/reviews`, { sort, page, limit });
  }
  eligibleReviews() {
    return this.get<{ eligible: EligibleJourney[]; reviews: MyReview[] }>('/reviews/eligible');
  }
  createReview(body: { bookingId: string; rating: number; text: string }) {
    return this.post<{ review: RouteReview; summary: RatingSummary }>('/reviews', body);
  }
  updateReview(id: string, body: { rating: number; text: string }) {
    return this.patch<{ review: RouteReview; summary: RatingSummary }>(`/reviews/${id}`, body);
  }
  reportReview(id: string, body: { reason: ReportReason; note?: string }) {
    return this.post<{ reported: boolean; hidden: boolean }>(`/reviews/${id}/report`, body);
  }
  toggleHelpful(id: string) {
    return this.post<{ helpful: boolean; helpfulCount: number }>(`/reviews/${id}/helpful`);
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
  adminReviews(params: Params) {
    return this.get<{ reviews: AdminReview[]; total: number; page: number; limit: number }>('/admin/reviews', params);
  }
  adminHideReview(id: string, note?: string) {
    return this.post<{ review: { id: string; status: string }; summary: RatingSummary }>(`/admin/reviews/${id}/hide`, { note });
  }
  adminRemoveReview(id: string, reason: RemoveReason, note?: string) {
    return this.post<{ review: { id: string; status: string }; summary: RatingSummary }>(`/admin/reviews/${id}/remove`, { reason, note });
  }
  adminRestoreReview(id: string, clearReports: boolean) {
    return this.post<{ review: { id: string; status: string }; summary: RatingSummary }>(`/admin/reviews/${id}/restore`, { clearReports });
  }
  adminCommunity(params: Params) {
    return this.get<{ items: AdminCommunityItem[]; total: number; page: number; limit: number }>('/admin/community', params);
  }
  adminHideContent(type: 'post' | 'comment', id: string, note?: string) {
    return this.post<{ item: { id: string; status: ContentStatus }; commentCount: number }>(`/admin/community/${type}/${id}/hide`, { note });
  }
  adminRemoveContent(type: 'post' | 'comment', id: string, reason: ContentRemoveReason, note?: string) {
    return this.post<{ item: { id: string; status: ContentStatus }; commentCount: number }>(`/admin/community/${type}/${id}/remove`, { reason, note });
  }
  adminRestoreContent(type: 'post' | 'comment', id: string, clearReports: boolean) {
    return this.post<{ item: { id: string; status: ContentStatus }; commentCount: number }>(`/admin/community/${type}/${id}/restore`, { clearReports });
  }
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
