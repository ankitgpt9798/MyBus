/** Geometry helpers for the route planner. */

/** Rough bounding box of India (mainland and islands). Routes are planned inside it only. */
export const INDIA_BOUNDS = { minLat: 6.0, maxLat: 37.6, minLon: 68.0, maxLon: 97.5 } as const;
export const MAX_WAYPOINTS = 5;
/** Routes with more points than this are simplified before they are sent to the browser. */
export const MAX_ROUTE_POINTS = 1500;

export interface Point {
  lat: number;
  lon: number;
}

export const inIndia = (p: Point) =>
  p.lat >= INDIA_BOUNDS.minLat && p.lat <= INDIA_BOUNDS.maxLat && p.lon >= INDIA_BOUNDS.minLon && p.lon <= INDIA_BOUNDS.maxLon;

/** A {lat, lon} object with finite numbers, or null. */
export function readPoint(value: unknown): Point | null {
  if (!value || typeof value !== 'object') return null;
  const { lat, lon } = value as Record<string, unknown>;
  const p = { lat: Number(lat), lon: Number(lon) };
  return typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : null;
}

/** "lat,lon" (e.g. the `near` query parameter), or null. */
export function parseLatLon(value: unknown): Point | null {
  if (typeof value !== 'string') return null;
  const [lat, lon] = value.split(',').map((v) => Number(v.trim()));
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

export function distanceM(a: Point, b: Point): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const round = (v: number) => Math.round(v * 1e5) / 1e5;

/**
 * Douglas-Peucker simplification of [lat, lon] points that always keeps the given indices (traffic section
 * and leg boundaries) and returns the old → new index map so those references can be rewritten.
 */
export function simplify(points: [number, number][], keep: Set<number>, maxPoints = MAX_ROUTE_POINTS) {
  if (points.length <= maxPoints) return { points: points.map(([a, b]) => [round(a), round(b)] as [number, number]), index: (i: number) => i };
  let epsilon = 0.00002;
  let kept: boolean[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    kept = douglasPeucker(points, epsilon, keep);
    if (kept.filter(Boolean).length <= maxPoints) break;
    epsilon *= 2;
  }
  const map = new Map<number, number>();
  const out: [number, number][] = [];
  kept.forEach((k, i) => {
    if (k) {
      map.set(i, out.length);
      out.push([round(points[i][0]), round(points[i][1])]);
    }
  });
  // Any dropped index maps to the nearest kept point before it.
  const index = (i: number) => {
    for (let j = Math.min(i, points.length - 1); j >= 0; j--) if (map.has(j)) return map.get(j)!;
    return 0;
  };
  return { points: out, index };
}

function douglasPeucker(points: [number, number][], epsilon: number, keep: Set<number>): boolean[] {
  const kept = new Array<boolean>(points.length).fill(false);
  kept[0] = kept[points.length - 1] = true;
  for (const i of keep) if (i >= 0 && i < points.length) kept[i] = true;
  // Simplify each stretch between two forced points separately (iterative, no recursion limit issues).
  const anchors = kept.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
  const stack: [number, number][] = [];
  for (let a = 0; a < anchors.length - 1; a++) stack.push([anchors[a], anchors[a + 1]]);
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpendicular(points[i], points[s], points[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > epsilon) {
      kept[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return kept;
}

function perpendicular(p: [number, number], a: [number, number], b: [number, number]): number {
  const [x, y] = p;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

export function bbox(points: [number, number][]): [[number, number], [number, number]] {
  let [minLat, minLon, maxLat, maxLon] = [90, 180, -90, -180];
  for (const [lat, lon] of points) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }
  return [
    [minLat, minLon],
    [maxLat, maxLon],
  ];
}
