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

export function classifySet(target: RepTarget, targetRpe: number, reps: number | undefined, rpe: number | undefined): SetStatus {
  if (reps == null) return 'pending';
  if (!repsHitTarget(target, reps)) return 'hard';
  if (rpe == null) return 'good';
  if (rpe > targetRpe + 1) return 'hard';
  if (rpe < targetRpe - 1) return 'easy';
  return 'good';
}
