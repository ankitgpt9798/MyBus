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
