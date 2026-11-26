import { PlannedRoute, TrafficSection } from '../../core/models';

/** Traffic levels drawn on the selected route (legend order). */
export const TRAFFIC_LEVELS = ['free', 'slow', 'queuing', 'stationary', 'closed'] as const;
export type TrafficLevel = (typeof TRAFFIC_LEVELS)[number];

/** Route line colours: free-flowing parts keep the route colour; congested sections are drawn over it. */
export const TRAFFIC_COLORS: Record<TrafficLevel, string> = {
  free: '#1c6dd0',
  slow: '#f2b705',
  queuing: '#f76707',
  stationary: '#d6336c',
  closed: '#343a40',
};

/**
 * Level of a traffic section: road closures are "closed"; otherwise TomTom's magnitude of delay (1 minor → slow,
 * 2 moderate → queuing, 3 major → stationary). Unknown magnitudes (0, 4) are judged by the effective speed.
 */
export function trafficLevel(s: TrafficSection): Exclude<TrafficLevel, 'free'> {
  if (s.simpleCategory === 'ROAD_CLOSURE') return 'closed';
  if (s.magnitude === 3) return 'stationary';
  if (s.magnitude === 2) return 'queuing';
  if (s.magnitude === 1) return 'slow';
  const v = s.effectiveSpeedKmh;
  return v !== null && v <= 10 ? 'stationary' : v !== null && v <= 30 ? 'queuing' : 'slow';
}

/** A faster route is suggested when it saves at least 5 minutes or 10 % of the selected route's travel time. */
export const SUGGEST_RULE = { minSavingS: 5 * 60, minSavingRatio: 0.1 } as const;

/** The best alternative to the selected route when live traffic makes it clearly faster, or null. */
export function fasterAlternative(routes: PlannedRoute[], selectedId: string | null): { route: PlannedRoute; savingS: number } | null {
  const selected = routes.find((r) => r.id === selectedId);
  if (!selected) return null;
  const best = routes.reduce((a, b) => (b.summary.travelTimeS < a.summary.travelTimeS ? b : a));
  const saving = selected.summary.travelTimeS - best.summary.travelTimeS;
  if (best.id === selected.id || saving <= 0) return null;
  // Only traffic-driven suggestions: the selected route must be losing time to traffic that the other one avoids.
  if (selected.summary.trafficDelayS <= best.summary.trafficDelayS) return null;
  return saving >= SUGGEST_RULE.minSavingS || saving / selected.summary.travelTimeS >= SUGGEST_RULE.minSavingRatio ? { route: best, savingS: saving } : null;
}

/** A change in travel time of the selected route worth telling the user about after a refresh. */
export const CHANGE_THRESHOLD_S = 3 * 60;
/** Live updates stop after this long without any interaction on the page. */
export const IDLE_STOP_MS = 60 * 60 * 1000;
/** Used when the server does not say how often to refresh. */
export const DEFAULT_REFRESH_MS = 60_000;

/** The route in a refreshed answer that is the same road as `prev` (same id and length, else the closest geometry). */
export function matchRoute(prev: PlannedRoute, next: PlannedRoute[]): PlannedRoute | null {
  if (!next.length) return null;
  const sameId = next.find((r) => r.id === prev.id);
  if (sameId && Math.abs(sameId.summary.distanceM - prev.summary.distanceM) <= Math.max(500, prev.summary.distanceM * 0.02)) return sameId;
  const sample = (r: PlannedRoute) => Array.from({ length: 12 }, (_, i) => r.points[Math.floor(((r.points.length - 1) * i) / 11)]);
  const a = sample(prev);
  const gap = (r: PlannedRoute) => sample(r).reduce((sum, p, i) => sum + Math.hypot(p[0] - a[i][0], p[1] - a[i][1]), 0);
  return next.reduce((best, r) => (gap(r) < gap(best) ? r : best));
}
