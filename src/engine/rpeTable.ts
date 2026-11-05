/**
 * RTS / Tuchscherer %1RM chart, collapsed to one lookup keyed by
 * effective reps = reps + RIR, where RIR = 10 − RPE.
 * Verified 2026-11-03 against two independent reproductions of the chart.
 */

export const RPE_MIN = 6.5;
export const RPE_MAX = 10;
export const RPE_STEP = 0.5;
export const DEFAULT_TARGET_RPE = 8;
/** Visual band for the RPE picker when no slot goal is given; set colouring on the log screen is goal-relative (see classify.ts). */
export const WORKING_RPE_MIN = 7;
export const WORKING_RPE_MAX = 9;
/** The chart only covers 1–12 reps; longer sets get no e1RM. */
export const MAX_REPS_FOR_E1RM = 12;
export const MAX_EFFECTIVE_REPS = 15.5;

/** Keyed by effectiveReps × 2 so half-steps are integer keys. Values are percentages. */
const TABLE: Readonly<Record<number, number>> = {
  2: 100.0, 3: 97.8, 4: 95.5, 5: 93.9, 6: 92.2, 7: 90.7, 8: 89.2, 9: 87.8,
  10: 86.3, 11: 85.0, 12: 83.7, 13: 82.4, 14: 81.1, 15: 79.9, 16: 78.6, 17: 77.4,
  18: 76.2, 19: 75.1, 20: 73.9, 21: 72.3, 22: 70.7, 23: 69.4, 24: 68.0, 25: 66.7,
  26: 65.3, 27: 64.0, 28: 62.6, 29: 61.3, 30: 59.9, 31: 58.6,
};

/** Fraction of 1RM (e.g. 0.786) for the given effective reps, or undefined if off the chart. */
export function pct(effReps: number): number | undefined {
  const doubled = effReps * 2;
  const key = Math.round(doubled);
  if (Math.abs(doubled - key) > 1e-9) return undefined;
  const v = TABLE[key];
  return v === undefined ? undefined : v / 100;
}

export function isValidRpe(rpe: number): boolean {
  if (!Number.isFinite(rpe) || rpe < RPE_MIN || rpe > RPE_MAX) return false;
  const doubled = rpe * 2;
  return Math.abs(doubled - Math.round(doubled)) < 1e-9;
}

/** All selectable RPE values, low to high. */
export function rpeValues(): number[] {
  const out: number[] = [];
  for (let r = RPE_MIN; r <= RPE_MAX + 1e-9; r += RPE_STEP) out.push(Number(r.toFixed(1)));
  return out;
}

export function isOutsideWorkingRange(rpe: number): boolean {
  return rpe < WORKING_RPE_MIN || rpe > WORKING_RPE_MAX;
}

/** Highest RPE at which a set still counts as "on plan" for the given goal. */
export function cutoff(targetRpe: number): number {
  return Math.min(targetRpe + 1, RPE_MAX);
}
