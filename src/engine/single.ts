import { prepare, repTargetFor } from './common';
import { loadFor } from './e1rm';
import { suggestFallback } from './fallback';
import { isBigJump, roundProgress } from './rounding';
import { cutoff } from './rpeTable';
import type { LoggedSet, SingleParams, Suggestion } from './types';

export const MIN_PROGRESS_RATIO = 1.01;

/**
 * Single progression (fixed reps). Every set must reach target reps and set 1
 * must be at or below the RPE cutoff; then the next load is targetReps at the
 * goal RPE from set 1's e1RM, with a +1% floor and no cap.
 */
export function suggestSingle(p: SingleParams, last: LoggedSet[]): Suggestion {
  const ctx = prepare(last);
  if (!ctx) return suggestFallback(p, last);
  const { set1, e1, prev } = ctx;
  const goal = p.targetRpe;
  const rpe = set1.rpe as number;

  // A target past the chart can never be computed: such slots are always low confidence.
  const raw = loadFor(e1, p.targetReps, goal);
  if (raw == null) return suggestFallback(p, last);

  const base = { targetRpe: goal, confidence: 'normal' as const, e1rm: e1, basis: set1, repTarget: repTargetFor(p, null) };

  if (last.some((s) => s.reps < p.targetReps)) {
    return { ...base, load: prev, bigJump: false, reason: 'single-hold-missed-reps' };
  }
  if (rpe > cutoff(goal)) {
    return { ...base, load: prev, bigJump: false, reason: 'single-hold-rpe-high' };
  }

  const floored = Math.max(raw, prev * MIN_PROGRESS_RATIO);
  const load = roundProgress(floored, prev, p.increment);
  return { ...base, load, bigJump: isBigJump(load, prev), reason: 'single-progress' };
}
