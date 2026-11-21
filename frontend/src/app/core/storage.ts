// localStorage can throw (private mode, blocked storage) — never let that break the app.
// index.html reads the theme key inline before Angular boots; keep the two in sync.
export const STORAGE_KEYS = {
  token: 'mybus.token',
  lang: 'mybus.lang',
  theme: 'mybus.theme',
} as const;

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
