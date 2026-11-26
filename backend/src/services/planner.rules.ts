/** Route planner rules (R3): how a route's congestion is labelled from live traffic. */

export type Congestion = 'low' | 'moderate' | 'heavy';

/**
 * Congestion label of a route:
 *  - heavy:    traffic adds ≥ 15 % to the free-flow time, or there is a major jam (magnitude 3) or a road closure;
 *  - moderate: traffic adds ≥ 5 %, or there is queuing traffic (magnitude 2);
 *  - low:      otherwise.
 * Only sections that cost at least a minute count for the magnitude rule; magnitude 4 ("undefined", e.g. road works
 * at normal speed) is judged by its delay only.
 */
export const CONGESTION_RULE = {
  moderateDelayRatio: 0.05,
  heavyDelayRatio: 0.15,
  moderateMagnitude: 2,
  heavyMagnitude: 3,
  minSectionDelayS: 60,
} as const;

export function congestionLevel(trafficDelayS: number, noTrafficTimeS: number, sections: { delayS: number; magnitude: number; simpleCategory: string }[]): Congestion {
  const r = CONGESTION_RULE;
  const ratio = noTrafficTimeS > 0 ? trafficDelayS / noTrafficTimeS : 0;
  const worst = Math.max(0, ...sections.filter((s) => s.delayS >= r.minSectionDelayS && s.magnitude >= 1 && s.magnitude <= 3).map((s) => s.magnitude));
  if (ratio >= r.heavyDelayRatio || worst >= r.heavyMagnitude || sections.some((s) => s.simpleCategory === 'ROAD_CLOSURE')) return 'heavy';
  if (ratio >= r.moderateDelayRatio || worst >= r.moderateMagnitude) return 'moderate';
  return 'low';
}
