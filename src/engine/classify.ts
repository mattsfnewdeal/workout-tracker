import { RPE_MIN } from './rpeTable';
import type { RepTarget } from './types';

/**
 * How a logged set compares with its slot's target.
 *  - pending: no reps yet
 *  - good:    reps hit the target and RPE is within one point of the goal (or no RPE logged)
 *  - easy:    reps hit the target but RPE was more than a point under the goal
 *  - hard:    reps fell short, or RPE was more than a point over the goal
 */
export type SetStatus = 'pending' | 'good' | 'easy' | 'hard';

export function repsHitTarget(target: RepTarget, reps: number): boolean {
  return target.kind === 'fixed' ? reps >= target.reps : reps >= target.min;
}

/** `targetRpe` null (linear rule): reps alone decide; a logged RPE is just a note. */
export function classifySet(target: RepTarget, targetRpe: number | null, reps: number | undefined, rpe: number | undefined): SetStatus {
  if (reps == null) return 'pending';
  if (!repsHitTarget(target, reps)) return 'hard';
  if (rpe == null || targetRpe == null) return 'good';
  if (rpe < RPE_MIN) return 'easy'; // "<6": easier than any goal
  if (rpe > targetRpe + 1) return 'hard';
  if (rpe < targetRpe - 1) return 'easy';
  return 'good';
}
