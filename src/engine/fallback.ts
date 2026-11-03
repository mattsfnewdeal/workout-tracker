import { findSet1, firstSession, repTargetFor } from './common';
import { isBigJump, nextIncrementAbove } from './rounding';
import type { LoggedSet, SlotParams, Suggestion } from './types';

/**
 * No usable e1RM (set over 12 reps, missing RPE, or target off the chart):
 * double → add one increment if set 1 went past repMax; single → add one
 * increment if every set hit target; otherwise hold. Always low confidence.
 */
export function suggestFallback(p: SlotParams, last: LoggedSet[]): Suggestion {
  const set1 = findSet1(last);
  if (!set1) return firstSession(p);
  const prev = set1.load;
  const progressed =
    p.progression === 'double' ? set1.reps > p.repMax : last.every((s) => s.reps >= p.targetReps);
  const load = progressed ? nextIncrementAbove(prev, p.increment) : prev;
  return {
    load,
    repTarget: repTargetFor(p, progressed ? null : set1.reps),
    targetRpe: p.targetRpe,
    confidence: 'low',
    bigJump: isBigJump(load, prev),
    reason: progressed ? 'fallback-add-increment' : 'fallback-hold',
    e1rm: null,
    basis: set1,
  };
}
