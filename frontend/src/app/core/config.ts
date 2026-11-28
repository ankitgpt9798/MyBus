declare global {
  interface Window {
    /** Set by config.js before the app starts (see public/config.js and scripts/deploy-config.mjs). */
    MYBUS_CONFIG?: { apiBaseUrl?: string };
  }
}

/**
 * Origin of the MyBus API: empty in development (relative /api through the dev server proxy), the deployed backend
 * (e.g. https://mybus-api.onrender.com) in production.
 */
export const API_ORIGIN = (typeof window === 'undefined' ? '' : (window.MYBUS_CONFIG?.apiBaseUrl ?? '')).trim().replace(/\/+$/, '');

/** URL of an API path such as `/api/users/me`. */
export const apiUrl = (path: string): string => `${API_ORIGIN}${path}`;

/** True for requests to the MyBus API (relative or absolute), which carry the session token. */
export const isApiUrl = (url: string): boolean => url.startsWith('/api/') || (!!API_ORIGIN && url.startsWith(`${API_ORIGIN}/api/`));
