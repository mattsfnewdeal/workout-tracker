import { roundToIncrement } from './rounding';
import type { RepTarget } from './types';

export interface WarmupInput {
  /** The suggested working load for the session, in lb (added weight for a bodyweight exercise). */
  workingLoad: number;
  /** The exercise's load increment, used for rounding. */
  increment: number;
  repTarget: RepTarget;
  exerciseName: string;
  bodyweight?: boolean;
}

export interface WarmupPrescription {
  load: number;
  reps: number;
}

export type LiftClass = 'main' | 'light' | 'isolation';

const ISOLATION = ['curl', 'raise', 'extension', 'ote', 'pushdown', 'pressdown', 'fly', 'flye', 'face pull', 'facepull', 'pull-apart', 'pullapart', 'pull apart', 'kickback', 'shrug', 'calf', 'crunch', 'plank', 'pallof'];
const LIGHT_PREFIX = ['db ', 'dumbbell', 'cable', 'machine', 'band', 'kb ', 'kettlebell', 'smith'];
const LIGHT_ANY = ['cable', 'machine', 'pulldown', 'lat pull', 'leg press', 'chest press', 'pec deck', 'hamstring curl', 'leg curl'];

/**
 * Which warm-up shape an exercise gets, from its name alone (the app doesn't know the implement).
 * Isolation work gets none; dumbbell / cable / machine work gets a short ramp; anything else
 * (barbell, trap bar, unknown) gets the full ramp. Unknown names err on the side of more warm-up.
 */
export function liftClass(name: string): LiftClass {
  const n = name.trim().toLowerCase();
  const word = (w: string) => n === w || n.startsWith(`${w} `) || n.endsWith(` ${w}`) || n.includes(` ${w} `);
  if (ISOLATION.some((w) => (w.length <= 3 ? word(w) : n.includes(w)))) return 'isolation';
  if (LIGHT_PREFIX.some((w) => n.startsWith(w)) || LIGHT_ANY.some((w) => n.includes(w))) return 'light';
  return 'main';
}

/** The ramp, as a fraction of the working load; a lower count takes rungs from the middle outward. */
const RUNGS: { pct: number; repsCap: number }[] = [
  { pct: 0.4, repsCap: 8 },
  { pct: 0.6, repsCap: 8 },
  { pct: 0.8, repsCap: 3 },
  { pct: 0.9, repsCap: 2 },
];
const BY_COUNT: number[][] = [[], [1], [1, 2], [0, 1, 2], [0, 1, 2, 3]];

function mainCount(load: number, lowReps: boolean): number {
  let tier = load < 95 ? 0 : load < 155 ? 1 : load < 225 ? 2 : load < 315 ? 3 : 4;
  if (lowReps && tier > 0) tier = Math.min(4, tier + 1);
  return tier;
}

function lightCount(load: number): number {
  return load < 30 ? 0 : load < 100 ? 1 : 2;
}

/**
 * Suggested warm-up sets before the working sets, from the consensus of coaching sources
 * (see SPEC v1.5): a 40 / 60 / 80 / 90 % ladder of the working load, more rungs for heavier
 * loads and lower reps, reps tapering as the load rises, rounded to the exercise's increment.
 * Dumbbell / cable work gets one or two rungs; isolation work gets none. Nothing is returned
 * when there is no working load yet (first session), which the caller enforces by not calling.
 */
export function warmupSets(input: WarmupInput): WarmupPrescription[] {
  const reps = input.repTarget.kind === 'fixed' ? input.repTarget.reps : input.repTarget.min;
  const W = input.workingLoad;
  const inc = input.increment > 0 ? input.increment : 5;

  if (input.bodyweight) {
    // Added weight is unknown as a fraction of total load, so: one set at bodyweight, plus a light added-weight set when the added weight is substantial.
    const out: WarmupPrescription[] = [{ load: 0, reps: Math.max(1, Math.min(reps, 5)) }];
    if (W >= 30) {
      const added = roundToIncrement(W * 0.6, inc);
      if (added > 0 && added < W) out.push({ load: added, reps: Math.min(reps, 3) });
    }
    return out;
  }
  if (!(W > 0)) return [];

  const cls = liftClass(input.exerciseName);
  const count = cls === 'isolation' ? 0 : cls === 'light' ? lightCount(W) : mainCount(W, reps <= 3);
  const out: WarmupPrescription[] = [];
  for (const i of BY_COUNT[count]) {
    const rung = RUNGS[i];
    const load = roundToIncrement(W * rung.pct, inc);
    if (load <= 0 || load >= W - inc + 1e-9) continue; // no jump left to make
    if (out.length && out[out.length - 1].load >= load) continue; // rounding collapsed two rungs
    out.push({ load, reps: Math.max(1, Math.min(reps, rung.repsCap)) });
  }
  return out;
}
