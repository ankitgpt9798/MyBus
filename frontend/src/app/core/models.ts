export type Lang = 'en' | 'hi' | 'mr' | 'bn' | 'te';
export type Theme = 'light' | 'dark';

export interface NotificationPreferences {
  email: boolean;
  push: boolean;
  inApp: boolean;
  promotional: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'user' | 'admin';
  emailVerified: boolean;
  language: Lang;
  theme: Theme;
  notificationPreferences: NotificationPreferences;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

/** Error body returned by every API endpoint. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

// Catalogue & search

export type BusType = 'seater' | 'sleeper';
export type DepartureSlot = 'night' | 'morning' | 'afternoon' | 'evening';

export interface RouteSummary {
  id: string;
  from: string;
  to: string;
  code: string;
  distanceKm: number;
  durationMinutes: number;
  ratingAvg: number;
  ratingCount: number;
}

export interface Stop {
  name: string;
  type: 'boarding' | 'via' | 'dropping';
  offsetMinutes: number;
}

export interface TripResult {
  id: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  fare: number;
  seatsAvailable: number;
  totalSeats: number;
  slot: DepartureSlot;
  operator: { id: string; name: string };
  bus: { name: string; type: BusType; ac: boolean; amenities: string[] };
}

export interface SearchResponse {
  route: RouteSummary | null;
  trips: TripResult[];
  meta: { total: number; minFare: number; maxFare: number; operators: { id: string; name: string }[] };
}

export interface Seat {
  number: string;
  deck: 'lower' | 'upper';
  row: number;
  col: number;
  kind: BusType;
  /** Reserved for women: the passenger on it must be female. */
  ladiesOnly?: boolean;
}

export interface TripDetails {
  trip: {
    id: string;
    departureTime: string;
    arrivalTime: string;
    durationMinutes: number;
    fare: number;
    status: 'scheduled' | 'cancelled';
    bookable: boolean;
    /** Sold or held seats. */
    bookedSeats: string[];
    /** Subset of bookedSeats reserved by an unpaid hold (may free up). */
    heldSeats: string[];
    /** Booked seats whose passenger is female (no other passenger data is exposed). */
    femaleSeats: string[];
    seatsAvailable: number;
  };
  route: RouteSummary & { stops: Stop[] };
  operator: { id: string; name: string };
  bus: { name: string; type: BusType; ac: boolean; amenities: string[]; totalSeats: number; seats: Seat[] };
  policy: { holdMinutes: number; maxSeats: number; refund: { minHours: number; percent: number }[] };
}

// Bookings

export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'expired';
export type PaymentMethod = 'upi' | 'card' | 'netbanking';
export type Gender = 'male' | 'female' | 'other';

export interface Passenger {
  seat: string;
  name: string;
  age: number;
  gender: Gender;
}

export interface Point {
  name: string;
  offsetMinutes: number;
  time: string;
}

export interface Booking {
  id: string;
  pnr: string | null;
  status: BookingStatus;
  tripId: string;
  routeId: string;
  seats: string[];
  /** Which of `seats` are reserved for women. */
  ladiesSeats: string[];
  passengers: Passenger[];
  contact: { email: string; phone: string };
  detailsComplete: boolean;
  journey: {
    from: string;
    to: string;
    departureTime: string;
    arrivalTime: string;
    operatorName: string;
    busName: string;
    busType: BusType;
    ac: boolean;
  };
  boardingPoint: Point;
  droppingPoint: Point;
  farePerSeat: number;
  totalAmount: number;
  holdExpiresAt: string | null;
  payment: { method?: PaymentMethod; transactionId?: string; paidAt?: string; status: string; failedAttempts?: number };
  cancellation: { cancelledAt: string; by: string; reason?: string; refundPercent: number; refundAmount: number } | null;
  cancellationQuote: { allowed: boolean; refundPercent: number; refundAmount: number } | null;
  completedAt: string | null;
  createdAt: string;
  user?: { id: string; name: string; email: string };
}

export interface HoldRequest {
  tripId: string;
  seats: string[];
  boardingPoint: string;
  droppingPoint: string;
}

// Admin

export interface AdminTrip {
  id: string;
  route: { id: string; from: string; to: string; code: string };
  bus: { name: string; type: BusType; ac: boolean; registrationNumber: string };
  operatorName: string;
  departureTime: string;
  arrivalTime: string;
  fare: number;
  status: 'scheduled' | 'cancelled';
  seatsBooked: number;
  totalSeats: number;
}

export interface AdminStats {
  users: number;
  upcomingTrips: number;
  bookings: Record<BookingStatus, number>;
  revenue: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

// Notifications

export type NotificationType = 'booking_confirmed' | 'booking_cancelled' | 'schedule_changed' | 'journey_reminder' | 'promotion';
export type NotificationChannel = 'in_app' | 'email' | 'push';
export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped';

/** Raw values stored with a notification, so it can be rendered in the reader's current language. */
export interface NotificationParams {
  bookingId?: string;
  pnr?: string;
  from?: string;
  to?: string;
  departureTime?: string;
  oldDepartureTime?: string;
  arrivalTime?: string;
  oldArrivalTime?: string;
  seats?: string[];
  ladiesSeats?: string[];
  boardingPoint?: string;
  boardingTime?: string;
  reminderKind?: '24h' | '2h';
  amount?: number;
  refundAmount?: number;
  refundPercent?: number;
  paid?: boolean;
  tripCancelled?: boolean;
  title?: string;
  body?: string;
  /** Offers: versions per language; missing ones fall back to English (title/body). */
  translations?: Partial<Record<Lang, { title: string; body: string }>>;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  templateKey: string;
  params: NotificationParams;
  /** Copy as sent, in `language`. */
  title: string;
  body: string;
  language: Lang;
  pnr: string | null;
  bookingId: string | null;
  read: boolean;
  createdAt: string;
  deliveries: { channel: NotificationChannel; status: DeliveryStatus; skipReason?: DeliveryLog['skipReason'] }[];
}

export type PromotionTarget = { kind: 'all' } | { kind: 'route'; from: string; to: string } | { kind: 'city'; city: string };

export interface AdminPromotion {
  id: string;
  title: string;
  target: PromotionTarget;
  languages: Lang[];
  status: 'sending' | 'sent';
  recipients: number;
  sent: number;
  createdAt: string;
}

export interface PromotionDraft {
  title: string;
  body: string;
  translations: Partial<Record<Lang, { title: string; body: string }>>;
  target: PromotionTarget;
}

export interface DeliveryLog {
  channel: NotificationChannel;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  skipReason: 'preference_off' | 'promotions_opt_out' | 'not_available' | 'no_subscription' | 'undeliverable_address' | null;
  /** Retry schedule used up; only an admin "Retry now" tries again. */
  gaveUp: boolean;
  transport: string | null;
  sentAt: string | null;
  nextAttemptAt: string | null;
}

export interface AdminNotification extends Omit<AppNotification, 'deliveries'> {
  user: { id: string; name: string; email: string } | null;
  emailTo: string | null;
  deliveries: DeliveryLog[];
}

// Reviews (R6)

export type ReviewSort = 'recent' | 'helpful' | 'highest' | 'lowest';
export type ReviewStatus = 'visible' | 'hidden' | 'removed';
export type ReportReason = 'spam' | 'offensive' | 'irrelevant' | 'fake' | 'other';
export type RemoveReason = ReportReason | 'personal_info';
export type StarKey = '1' | '2' | '3' | '4' | '5';

export interface RatingSummary {
  avg: number;
  count: number;
  distribution: Record<StarKey, number>;
}

export interface TrustedReviewer {
  name: string;
  reviews: number;
  helpful: number;
}

export interface NextTrip {
  id: string;
  departureTime: string;
  arrivalTime: string;
  fare: number;
  operatorName: string;
  busName: string;
  busType: BusType;
  ac: boolean;
  seatsAvailable: number;
}

export interface RouteDetails {
  route: RouteSummary & { stops: Stop[] };
  upcomingTrips: number;
  operators: string[];
  nextTrips: NextTrip[];
  ratingSummary: RatingSummary;
  trustedReviewers: TrustedReviewer[];
}

export interface RouteReview {
  id: string;
  routeId: string;
  rating: number;
  text: string;
  createdAt: string;
  editedAt: string | null;
  travelledAt: string | null;
  author: { id: string; name: string; isTrustedReviewer: boolean };
  helpfulCount: number;
  helpfulByMe: boolean;
  reportedByMe: boolean;
  mine: boolean;
  editable: boolean;
  editableUntil?: string;
}

export interface RouteReviewsResponse {
  summary: RatingSummary;
  trustedReviewers: TrustedReviewer[];
  reviews: RouteReview[];
  total: number;
  page: number;
  limit: number;
  sort: ReviewSort;
}

export interface EligibleJourney {
  bookingId: string;
  pnr: string | null;
  routeId: string;
  from: string;
  to: string;
  departureTime: string;
  operatorName: string;
}

export interface MyReview {
  id: string;
  bookingId: string;
  routeId: string;
  from?: string;
  to?: string;
  rating: number;
  text: string;
  status: ReviewStatus;
  createdAt: string;
  editedAt: string | null;
  editableUntil: string;
  editable: boolean;
  editMsLeft: number;
}

export interface AdminReview {
  id: string;
  rating: number;
  text: string;
  status: ReviewStatus;
  createdAt: string;
  editedAt: string | null;
  user: { id: string; name: string; email: string } | null;
  route: { id: string; from: string; to: string } | null;
  helpfulCount: number;
  reportCount: number;
  reports: { user: string | null; reason: ReportReason; note: string | null; createdAt: string }[];
  moderation: { reason: string; note: string | null; auto: boolean; by: string | null; at: string } | null;
}

// Community (R1)

export type Board = 'stories' | 'tips' | 'routes' | 'destinations' | 'advice';
export type PostSort = 'latest' | 'top' | 'discussed' | 'trending';
export type ContentStatus = 'visible' | 'hidden' | 'removed';
export type ContentReportReason = 'spam' | 'offensive' | 'irrelevant' | 'misleading' | 'other';
export type ContentRemoveReason = ContentReportReason | 'personal_info';
export type ShareNetwork = 'whatsapp' | 'x' | 'facebook' | 'telegram' | 'copy' | 'native';

export interface BoardInfo {
  id: Board;
  posts: number;
  latestAt: string | null;
}

export interface PostPhoto {
  url: string;
  alt: string;
}

export interface CommunityAuthor {
  id: string | null;
  name: string;
}

export interface CommunityPost {
  id: string;
  board: Board;
  title: string;
  /** Full text on the post page, an excerpt in the feed (truncated = true). */
  body: string;
  truncated: boolean;
  photos: PostPhoto[];
  route: { id: string; from: string; to: string } | null;
  city: string | null;
  language: Lang;
  author: CommunityAuthor;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
  shareCount: number;
  /** Engagement (likes + 2 × comments + 3 × shares) at or above the Popular threshold. */
  popular: boolean;
  /** Trending score, only in trending lists. */
  score?: number;
  reportedByMe: boolean;
  mine: boolean;
  /** Not visible: only its author (with the moderation notice) and admins see the post. */
  status: ContentStatus;
  moderation: { reason: string | null; auto: boolean; at: string } | null;
  createdAt: string;
  editedAt: string | null;
}

export interface CommunityComment {
  id: string;
  parentId: string | null;
  body: string;
  author: CommunityAuthor;
  likeCount: number;
  likedByMe: boolean;
  reportedByMe: boolean;
  mine: boolean;
  createdAt: string;
  replies: CommunityComment[];
}

export interface Contributor {
  id: string;
  name: string;
  posts: number;
  comments: number;
  likesReceived: number;
  points: number;
}

export interface AdminCommunityItem {
  type: 'post' | 'comment';
  id: string;
  status: ContentStatus;
  createdAt: string;
  title: string | null;
  text: string;
  board: Board | null;
  post: { id: string; title: string; status?: ContentStatus } | null;
  route?: { id: string; from: string; to: string } | null;
  city?: string | null;
  photos?: number;
  reply?: boolean;
  author: { id: string; name: string; email: string | null } | null;
  likeCount: number;
  commentCount?: number;
  shareCount?: number;
  reportCount: number;
  reports: { user: string | null; reason: ContentReportReason; note: string | null; createdAt: string | null }[];
  moderation: { reason: string | null; note: string | null; auto: boolean; by: string | null; at: string } | null;
}

// Public profiles (R1)

export interface PublicProfile {
  user: { id: string; name: string; memberSince: string; verified: boolean; trustedReviewer: boolean };
  stats: { posts: number; comments: number; likesReceived: number; reviews: number; helpfulReceived: number };
  own: boolean;
}

export interface ProfileComment {
  id: string;
  body: string;
  reply: boolean;
  likeCount: number;
  status: ContentStatus;
  post: { id: string; title: string } | null;
  createdAt: string;
}

export interface ProfileReview {
  id: string;
  rating: number;
  text: string;
  helpfulCount: number;
  status: ContentStatus;
  route: { id: string; from: string; to: string } | null;
  createdAt: string;
}

export type ActivityType = 'post' | 'comment' | 'review' | 'like_post' | 'like_comment' | 'helpful';

export interface ActivityItem {
  key: string;
  type: ActivityType;
  at: string;
  /** Only on the owner's own hidden / removed items. */
  status?: ContentStatus;
  post?: { id: string; title: string } | null;
  route?: { id: string; from: string; to: string } | null;
  text?: string;
  reply?: boolean;
  rating?: number;
}

// Route planner (R3)

export type PlaceType = 'city' | 'stop' | 'poi' | 'street' | 'address' | 'pin';

export interface PlannerPlace {
  id: string;
  label: string;
  address: string;
  lat: number;
  lon: number;
  type: PlaceType;
}

export interface PlannerStatus {
  provider: 'tomtom' | 'osrm';
  liveTraffic: boolean;
  tiles: 'tomtom' | 'osm';
  reason?: string;
}

export interface TrafficSection {
  startIndex: number;
  endIndex: number;
  delayS: number;
  magnitude: number;
  simpleCategory: string;
  effectiveSpeedKmh: number | null;
}

export interface PlannedRoute {
  id: string;
  kind: 'fastest' | 'alternative';
  summary: {
    distanceM: number;
    travelTimeS: number;
    noTrafficTimeS: number;
    historicTrafficTimeS: number | null;
    liveIncidentsTimeS: number | null;
    trafficDelayS: number;
    trafficLengthM: number;
    departureTime: string;
    arrivalTime: string;
  };
  points: [number, number][];
  bbox: [[number, number], [number, number]];
  legs: { distanceM: number; travelTimeS: number; trafficDelayS: number; startIndex: number }[];
  trafficSections: TrafficSection[];
}

export interface PlanResponse {
  routes: PlannedRoute[];
  provider: 'tomtom' | 'osrm';
  liveTraffic: boolean;
  fallbackReason?: string;
  departAt: string | null;
}
