import { e1rm } from './e1rm';
import { findSet1, firstSession, repTargetFor } from './common';
import { nextIncrementAbove, nextIncrementBelow, roundToIncrement } from './rounding';
import type { LoggedSet, SlotParams, Suggestion } from './types';

export const DELOAD_RATIO = 0.9;

/** Every logged set reached its target: fixed reps, or the top of the range. */
export function linearTargetMet(p: SlotParams, sets: LoggedSet[]): boolean {
  const need = p.progression === 'single' ? p.targetReps : p.repMax;
  return sets.length > 0 && sets.every((s) => s.reps >= need);
}

/** 10% off, rounded to the increment, but always at least one increment below (so a deload at 20 lb is 15, not 20). */
export function deloadLoad(prev: number, inc: number): number {
  return Math.max(0, Math.min(roundToIncrement(prev * DELOAD_RATIO, inc), nextIncrementBelow(prev, inc)));
}

/**
 * Linear progression ("add weight each session when all reps are completed"):
 *   every set hit the target → last load + one increment;
 *   fixed reps, missed, and the session before was also a miss → drop 10% (at least one increment);
 *   otherwise hold.
 * For a rep range the target is the top of the range and there is no deload: sets inside the
 * range are the normal state of double progression, not a miss.
 * RPE is recorded for the lifter but plays no part. The e1RM is reported when it can be computed.
 */
export function suggestLinear(p: SlotParams, last: LoggedSet[], previous: LoggedSet[] | null): Suggestion {
  const set1 = findSet1(last);
  if (!set1) return firstSession(p);
  const prev = set1.load;
  const base = {
    targetRpe: p.targetRpe,
    confidence: 'normal' as const,
    bigJump: false,
    e1rm: set1.rpe != null ? e1rm(set1.load, set1.reps, set1.rpe) : null,
    basis: set1,
    repTarget: repTargetFor(p, null),
  };
  if (linearTargetMet(p, last)) return { ...base, load: nextIncrementAbove(prev, p.increment), reason: 'linear-progress' };
  if (p.progression === 'double') return { ...base, load: prev, reason: 'linear-hold-range' };
  const missedBefore = previous != null && previous.length > 0 && !linearTargetMet(p, previous);
  if (missedBefore) return { ...base, load: deloadLoad(prev, p.increment), reason: 'linear-deload' };
  return { ...base, load: prev, reason: 'linear-hold-missed' };
}
