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
    bookedSeats: string[];
    seatsAvailable: number;
  };
  route: RouteSummary & { stops: Stop[] };
  operator: { id: string; name: string };
  bus: { name: string; type: BusType; ac: boolean; amenities: string[]; totalSeats: number; seats: Seat[] };
  policy: { holdMinutes: number; maxSeats: number; refund: { minHours: number; percent: number }[] };
}
