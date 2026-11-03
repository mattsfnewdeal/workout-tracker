import { e1rm } from './e1rm';
import type { LoggedSet, RepTarget, SlotParams, Suggestion } from './types';

export function findSet1(last: LoggedSet[]): LoggedSet | undefined {
  return last.find((s) => s.setNumber === 1);
}

export interface Prepared {
  set1: LoggedSet;
  e1: number;
  /** Set 1's logged load — what "hold" means. */
  prev: number;
}

/** Set 1 plus its e1RM, or null when no e1RM can be computed (missing RPE, >12 reps). */
export function prepare(last: LoggedSet[]): Prepared | null {
  const set1 = findSet1(last);
  if (!set1 || set1.rpe == null) return null;
  const e1 = e1rm(set1.load, set1.reps, set1.rpe);
  if (e1 == null) return null;
  return { set1, e1, prev: set1.load };
}

export function repTargetFor(p: SlotParams, beat: number | null): RepTarget {
  return p.progression === 'single'
    ? { kind: 'fixed', reps: p.targetReps }
    : { kind: 'range', min: p.repMin, max: p.repMax, beat };
}

export function firstSession(p: SlotParams): Suggestion {
  return {
    load: p.startingLoad,
    repTarget: repTargetFor(p, null),
    targetRpe: p.targetRpe,
    confidence: 'normal',
    bigJump: false,
    reason: 'first-session',
    e1rm: null,
    basis: null,
  };
}
