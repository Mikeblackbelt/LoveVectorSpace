import type { SuccessEstimate } from '../api/types';

export const UNCAL_TAG = 'uncalibrated estimate: hand-set weights, not fitted to outcomes';

/** True when the estimate carries a usable range (status ok with null low/high = "no range"). */
export function hasRange(s: Pick<SuccessEstimate, 'low' | 'high'>): boolean {
  return s.low != null && s.high != null;
}

/**
 * §7c: the headline percent is never shown without its range and the uncalibrated tag.
 * Every place that repeats the number uses this string.
 */
export function headlineText(s: Pick<SuccessEstimate, 'percent' | 'low' | 'high' | 'status'>, plain = false): string | null {
  if (s.status !== 'ok' || s.percent == null) return null;
  const p = Math.round(s.percent);
  const range = hasRange(s) ? (plain ? `likely ${s.low} to ${s.high}` : `range ${s.low}–${s.high}`) : plain ? 'no range yet' : 'no range';
  return plain ? `${p}% (${range}, rough estimate)` : `${p}% (${range}) [UNCAL]`;
}
