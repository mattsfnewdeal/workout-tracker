import { MAX_REPS_FOR_E1RM, isValidRpe, pct } from './rpeTable';

export function effectiveReps(reps: number, rpe: number): number {
  return reps + (10 - rpe);
}

/** Estimated 1RM from a logged set, or null when the chart can't rate it (>12 reps, bad RPE). */
export function e1rm(load: number, reps: number, rpe: number): number | null {
  if (!(load > 0) || !Number.isInteger(reps) || reps < 1 || reps > MAX_REPS_FOR_E1RM) return null;
  if (!isValidRpe(rpe)) return null;
  const p = pct(effectiveReps(reps, rpe));
  return p === undefined ? null : load / p;
}

/** Load that should land `reps` at `rpe` given an e1RM, or null when the target is off the chart. */
export function loadFor(e1: number, reps: number, rpe: number): number | null {
  if (!(e1 > 0) || !Number.isInteger(reps) || reps < 1 || !isValidRpe(rpe)) return null;
  const p = pct(effectiveReps(reps, rpe));
  return p === undefined ? null : e1 * p;
}
