import { describe, expect, it } from 'vitest';
import { suggest } from './suggest';
import type { LoggedSet, SlotParams } from './types';

const single: SlotParams = { progression: 'single', targetReps: 5, targetRpe: 8, increment: 5, bodyweight: true };
const double: SlotParams = { progression: 'double', repMin: 6, repMax: 10, targetRpe: 8, increment: 5, bodyweight: true };
const set = (load: number, reps: number, rpe: number | null, setNumber = 1): LoggedSet => ({ setNumber, load, reps, rpe });

describe('bodyweight progression (load = added weight)', () => {
  it('is a first session with no history', () => {
    expect(suggest(double, null)).toMatchObject({ load: null, reason: 'first-session' });
  });

  it('double: hold and beat reps inside the range; add an increment past the top; drop one when under or RPE is high', () => {
    expect(suggest(double, [set(0, 8, 8)])).toMatchObject({ load: 0, reason: 'double-hold-add-reps', repTarget: { kind: 'range', min: 6, max: 10, beat: 8 }, confidence: 'normal', bigJump: false, e1rm: null });
    expect(suggest(double, [set(0, 11, 8)])).toMatchObject({ load: 5, reason: 'double-progress', confidence: 'normal' });
    expect(suggest(double, [set(25, 11, 7)])).toMatchObject({ load: 30, reason: 'double-progress' });
    expect(suggest(double, [set(0, 5, 8)])).toMatchObject({ load: 0, reason: 'double-below-min' });
    expect(suggest(double, [set(25, 5, 8)])).toMatchObject({ load: 20, reason: 'double-below-min' });
    expect(suggest(double, [set(25, 8, 9.5)])).toMatchObject({ load: 20, reason: 'double-rpe-high' });
    expect(suggest(double, [set(0, 8, 10)])).toMatchObject({ load: 0, reason: 'double-rpe-high' });
    expect(suggest(double, [set(2, 11, 8)])).toMatchObject({ load: 5, reason: 'double-progress' }); // off-grid added weight
  });

  it('single: every set clean and RPE within cutoff → add an increment; otherwise hold', () => {
    expect(suggest(single, [set(0, 5, 8), set(0, 5, null, 2), set(0, 5, null, 3)])).toMatchObject({ load: 5, reason: 'single-progress', confidence: 'normal' });
    expect(suggest(single, [set(10, 5, 9), set(10, 5, null, 2), set(10, 5, null, 3)])).toMatchObject({ load: 15, reason: 'single-progress' });
    expect(suggest(single, [set(10, 5, 9.5), set(10, 5, null, 2), set(10, 5, null, 3)])).toMatchObject({ load: 10, reason: 'single-hold-rpe-high' });
    expect(suggest(single, [set(10, 5, 8), set(10, 4, null, 2), set(10, 5, null, 3)])).toMatchObject({ load: 10, reason: 'single-hold-missed-reps' });
  });

  it('a missing RPE on set 1 does not block: treated as within cutoff', () => {
    expect(suggest(double, [set(0, 11, null)])).toMatchObject({ load: 5, reason: 'double-progress' });
  });

  it('without the flag a zero load falls back to the low-confidence path', () => {
    expect(suggest({ ...double, bodyweight: false }, [set(0, 11, 8)])).toMatchObject({ load: 5, reason: 'fallback-add-increment', confidence: 'low' });
  });
});
