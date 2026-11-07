import { describe, expect, it } from 'vitest';
import { deloadLoad } from './linear';
import { nextIncrementBelow } from './rounding';
import { suggest } from './suggest';
import type { LoggedSet, SlotParams } from './types';

const squat: SlotParams = { progression: 'single', targetReps: 5, targetRpe: 8, increment: 5, rule: 'linear' };
const ohp: SlotParams = { ...squat, increment: 2.5 };
const row: SlotParams = { progression: 'double', repMin: 8, repMax: 12, targetRpe: 8, increment: 5, rule: 'linear' };
const set = (load: number, reps: number, rpe: number | null, setNumber = 1): LoggedSet => ({ setNumber, load, reps, rpe });
const sets = (load: number, reps: number[], rpe: number | null = 8) => reps.map((r, i) => set(load, r, i === 0 ? rpe : null, i + 1));

describe('linear progression', () => {
  it('adds one increment when every set hits the target, whatever the RPE', () => {
    expect(suggest(squat, sets(225, [5, 5, 5], 9.5))).toMatchObject({ load: 230, reason: 'linear-progress', confidence: 'normal', bigJump: false });
    expect(suggest(squat, sets(225, [6, 5, 5], 6))).toMatchObject({ load: 230, reason: 'linear-progress' });
    expect(suggest(ohp, sets(95, [5, 5, 5]))).toMatchObject({ load: 97.5 });
    expect(suggest(ohp, sets(96, [5, 5, 5]))).toMatchObject({ load: 97.5 }); // off-grid → next increment above
    expect(suggest(squat, sets(225, [5, 5, 5], 7)).e1rm).toBeCloseTo(286.26, 1);
    expect(suggest(squat, sets(225, [5, 5, 5], null)).e1rm).toBeNull();
  });

  it('holds after one miss, deloads 10% after two misses in a row, then builds back', () => {
    expect(suggest(squat, sets(225, [5, 5, 4]))).toMatchObject({ load: 225, reason: 'linear-hold-missed' });
    expect(suggest(squat, sets(225, [5, 5, 4]), null)).toMatchObject({ load: 225, reason: 'linear-hold-missed' });
    expect(suggest(squat, sets(225, [5, 5, 4]), sets(220, [5, 5, 5]))).toMatchObject({ load: 225, reason: 'linear-hold-missed' });
    expect(suggest(squat, sets(225, [5, 5, 4]), sets(225, [5, 4, 4]))).toMatchObject({ load: 205, reason: 'linear-deload' }); // 202.5 → 205
    expect(suggest(ohp, sets(100, [4, 4, 4]), sets(100, [5, 5, 4]))).toMatchObject({ load: 90, reason: 'linear-deload' });
    expect(suggest(squat, sets(205, [5, 5, 5]), sets(225, [5, 5, 4]))).toMatchObject({ load: 210, reason: 'linear-progress' });
  });

  it('a rep range progresses only when every set reaches the top of the range, and never deloads', () => {
    expect(suggest(row, sets(100, [12, 12, 12, 12]))).toMatchObject({ load: 105, reason: 'linear-progress', repTarget: { kind: 'range', min: 8, max: 12, beat: null } });
    expect(suggest(row, sets(100, [12, 12, 11, 10]))).toMatchObject({ load: 100, reason: 'linear-hold-range', repTarget: { beat: null } });
    expect(suggest(row, sets(100, [13, 9, 8, 8]))).toMatchObject({ load: 100, reason: 'linear-hold-range' });
    // building reps from the bottom of the range over several sessions is the normal state, not two misses
    expect(suggest(row, sets(100, [9, 9, 9, 8]), sets(100, [8, 8, 8, 8]))).toMatchObject({ load: 100, reason: 'linear-hold-range' });
    expect(suggest(row, sets(100, [11, 11, 11, 11]), sets(100, [11, 10, 10, 10]))).toMatchObject({ load: 100, reason: 'linear-hold-range' });
    expect(suggest(row, sets(100, [7, 7, 7, 7]), sets(100, [7, 7, 7, 7]))).toMatchObject({ load: 100, reason: 'linear-hold-range' });
  });

  it('a deload always drops at least one increment', () => {
    expect(nextIncrementBelow(20, 5)).toBe(15);
    expect(nextIncrementBelow(22, 5)).toBe(20);
    expect(nextIncrementBelow(5, 5)).toBe(0);
    expect(nextIncrementBelow(0, 5)).toBe(0);
    expect(deloadLoad(225, 5)).toBe(205);
    expect(deloadLoad(20, 5)).toBe(15);
    expect(deloadLoad(12.5, 2.5)).toBe(10);
    expect(deloadLoad(5, 5)).toBe(0);
    expect(suggest({ ...squat, increment: 5 }, sets(20, [4, 4, 4]), sets(20, [4, 4, 4]))).toMatchObject({ load: 15, reason: 'linear-deload' });
  });

  it('a first session has no load; bodyweight loads step from 0', () => {
    expect(suggest(squat, null)).toMatchObject({ load: null, reason: 'first-session' });
    expect(suggest({ ...row, bodyweight: true }, sets(0, [12, 12, 12]))).toMatchObject({ load: 5, reason: 'linear-progress' });
    expect(suggest({ ...row, bodyweight: true }, sets(0, [8, 8, 8]), sets(0, [8, 8, 8]))).toMatchObject({ load: 0, reason: 'linear-hold-range' });
    expect(suggest({ ...squat, bodyweight: true }, sets(10, [4, 4, 4]), sets(10, [4, 4, 4]))).toMatchObject({ load: 5, reason: 'linear-deload' });
    expect(suggest({ ...squat, bodyweight: true }, sets(0, [4, 4, 4]), sets(0, [4, 4, 4]))).toMatchObject({ load: 0, reason: 'linear-deload' });
  });
});

describe('rep range at RPE 8 or easier', () => {
  const rowCap: SlotParams = { ...row, rpeCap: 8 };
  it('progresses only when the top of the range came at or under the cap', () => {
    expect(suggest(rowCap, sets(100, [12, 12, 12, 12], 8))).toMatchObject({ load: 105, reason: 'linear-progress' });
    expect(suggest(rowCap, sets(100, [12, 12, 12, 12], 8.5))).toMatchObject({ load: 100, reason: 'linear-hold-rpe' });
    expect(suggest(rowCap, sets(100, [12, 12, 12, 12], null))).toMatchObject({ load: 105, reason: 'linear-progress' }); // no RPE logged: reps decide
    expect(suggest({ ...rowCap, rpeCap: 7 }, sets(100, [12, 12, 12, 12], 7.5))).toMatchObject({ load: 100, reason: 'linear-hold-rpe' });
    expect(suggest(row, sets(100, [12, 12, 12, 12], 10))).toMatchObject({ load: 105, reason: 'linear-progress' }); // no cap
    expect(suggest({ ...squat, rpeCap: 8 }, sets(225, [5, 5, 5], 9.5))).toMatchObject({ load: 230, reason: 'linear-progress' }); // fixed reps ignore RPE
  });
});

describe('manual rule', () => {
  it('repeats last time\'s load and reports the e1RM when it can', () => {
    const wheel: SlotParams = { progression: 'double', repMin: 6, repMax: 10, targetRpe: 8, increment: 5, rule: 'manual', bodyweight: true };
    expect(suggest(wheel, null)).toMatchObject({ load: null, reason: 'first-session' });
    expect(suggest(wheel, sets(0, [10, 10, 10], 8))).toMatchObject({ load: 0, reason: 'manual-hold', confidence: 'normal', bigJump: false, repTarget: { beat: null } });
    const carry: SlotParams = { progression: 'double', repMin: 30, repMax: 40, targetRpe: 8, increment: 5, rule: 'manual' };
    expect(suggest(carry, sets(75, [40, 35], 7))).toMatchObject({ load: 75, reason: 'manual-hold', e1rm: null }); // 40 reps is off the chart
    expect(suggest({ ...carry, progression: 'single', targetReps: 5 }, sets(225, [5, 5], 7)).e1rm).toBeCloseTo(286.26, 1);
  });
});
