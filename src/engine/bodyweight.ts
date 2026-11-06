import { findSet1, firstSession, repTargetFor } from './common';
import { nextIncrementAbove, roundToIncrement } from './rounding';
import { cutoff } from './rpeTable';
import type { LoggedSet, SlotParams, Suggestion } from './types';

/**
 * Bodyweight exercises (chins, dips): the logged load is *added* weight, 0 when none.
 * An e1RM from added weight means nothing, so the same decisions as single / double
 * progression are made on reps and RPE alone, and the load moves by one increment:
 *   progress → prev + increment; recalc branches → prev − increment (never below 0); hold → prev.
 * Confidence is normal: this is the intended rule, not a fallback.
 */
export function suggestBodyweight(p: SlotParams, last: LoggedSet[]): Suggestion {
  const set1 = findSet1(last);
  if (!set1) return firstSession(p);
  const prev = set1.load;
  const goal = p.targetRpe;
  const up = nextIncrementAbove(prev, p.increment);
  const down = Math.max(0, roundToIncrement(prev - p.increment, p.increment));
  const base = { targetRpe: goal, confidence: 'normal' as const, e1rm: null, basis: set1, bigJump: false };
  const rpeHigh = set1.rpe != null && set1.rpe > cutoff(goal);

  if (p.progression === 'single') {
    const repTarget = repTargetFor(p, null);
    if (last.some((s) => s.reps < p.targetReps)) return { ...base, load: prev, repTarget, reason: 'single-hold-missed-reps' };
    if (rpeHigh) return { ...base, load: prev, repTarget, reason: 'single-hold-rpe-high' };
    return { ...base, load: up, repTarget, reason: 'single-progress' };
  }
  if (set1.reps < p.repMin) return { ...base, load: down, repTarget: repTargetFor(p, null), reason: 'double-below-min' };
  if (rpeHigh) return { ...base, load: down, repTarget: repTargetFor(p, null), reason: 'double-rpe-high' };
  if (set1.reps > p.repMax) return { ...base, load: up, repTarget: repTargetFor(p, null), reason: 'double-progress' };
  return { ...base, load: prev, repTarget: repTargetFor(p, set1.reps), reason: 'double-hold-add-reps' };
}
