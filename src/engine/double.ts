import { prepare, repTargetFor } from './common';
import { loadFor } from './e1rm';
import { suggestFallback } from './fallback';
import { isBigJump, roundProgress, roundToIncrement } from './rounding';
import { cutoff } from './rpeTable';
import type { DoubleParams, LoggedSet, Suggestion } from './types';

/**
 * Double progression (rep range). Looks only at set 1 of the last session.
 * Branch order matters because the spec's rules overlap:
 *   1. reps < repMin        → recalc so repMin lands at goal (dominates a high RPE)
 *   2. rpe > cutoff         → recalc so min(reps, repMax) lands at goal (no floor, no bump)
 *   3. reps > repMax        → progress: repMin at goal, with the rounding bump
 *   4. otherwise            → hold the load, beat last time's set-1 reps
 */
export function suggestDouble(p: DoubleParams, last: LoggedSet[]): Suggestion {
  const ctx = prepare(last);
  if (!ctx) return suggestFallback(p, last);
  const { set1, e1, prev } = ctx;
  const goal = p.targetRpe;
  const rpe = set1.rpe as number;

  // repMin past the chart means no branch can be computed: always low confidence.
  const rawMin = loadFor(e1, p.repMin, goal);
  if (rawMin == null) return suggestFallback(p, last);

  const base = { targetRpe: goal, confidence: 'normal' as const, e1rm: e1, basis: set1 };

  if (set1.reps < p.repMin) {
    const load = roundToIncrement(rawMin, p.increment);
    return { ...base, load, repTarget: repTargetFor(p, null), bigJump: isBigJump(load, prev), reason: 'double-below-min' };
  }

  if (rpe > cutoff(goal)) {
    const raw = loadFor(e1, Math.min(set1.reps, p.repMax), goal);
    if (raw == null) return suggestFallback(p, last);
    const load = roundToIncrement(raw, p.increment);
    return { ...base, load, repTarget: repTargetFor(p, null), bigJump: isBigJump(load, prev), reason: 'double-rpe-high' };
  }

  if (set1.reps > p.repMax) {
    const load = roundProgress(rawMin, prev, p.increment);
    return { ...base, load, repTarget: repTargetFor(p, null), bigJump: isBigJump(load, prev), reason: 'double-progress' };
  }

  return { ...base, load: prev, repTarget: repTargetFor(p, set1.reps), bigJump: false, reason: 'double-hold-add-reps' };
}
