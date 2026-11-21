export type Lang = 'en' | 'hi' | 'mr';
export type Theme = 'light' | 'dark';

export interface NotificationPreferences {
  email: boolean;
  push: boolean;
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
