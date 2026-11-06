import { describe, expect, it } from 'vitest';
import { liftClass, warmupSets } from './warmup';
import type { RepTarget } from './types';

const fixed = (reps: number): RepTarget => ({ kind: 'fixed', reps });
const range = (min: number, max: number): RepTarget => ({ kind: 'range', min, max, beat: null });
const w = (workingLoad: number, exerciseName: string, repTarget: RepTarget, increment = 5, bodyweight = false) =>
  warmupSets({ workingLoad, increment, repTarget, exerciseName, bodyweight }).map((s) => [s.load, s.reps]);

describe('liftClass', () => {
  it('classifies by name; unknown names are main lifts', () => {
    for (const n of ['Squat', 'Trap', 'Trap Bar Deadlift', 'Bench Press', 'Press', 'BSS', 'Chin', 'Front Squat', 'Row', 'Banded Squat', 'Chest-Supported Row', 'Romanian Deadlift']) expect(liftClass(n), n).toBe('main');
    for (const n of ['DB Bench', 'DB SLDL', 'DB Press', 'DB Row', 'Cable chop', 'Dumbbell Row', 'Lat Pulldown', 'Leg Press', 'Machine Chest Press', 'KB Swing', 'Incline DB Press', 'Band Pull-Down', 'Cable Row']) expect(liftClass(n), n).toBe('light');
    for (const n of ['DB Incline Curl', 'DB OTE', 'Pallof Press', 'Face Pull', 'Lateral Raise', 'Tricep Pushdown', 'Leg Extension', 'Calf Raise', 'Plank', 'Shrug', 'Band Pull-Apart']) expect(liftClass(n), n).toBe('isolation');
  });
});

describe('warmupSets', () => {
  it('worked examples from the research synthesis', () => {
    expect(w(230, 'Squat', fixed(5))).toEqual([[90, 5], [140, 5], [185, 3]]);
    expect(w(70, 'DB Bench', range(6, 8))).toEqual([[40, 6]]);
    expect(w(315, 'Trap Bar Deadlift', range(4, 6))).toEqual([[125, 4], [190, 4], [250, 3], [285, 2]]);
    expect(w(30, 'DB Curl', range(12, 15))).toEqual([]);
  });

  it('main-lift tiers scale with the working load', () => {
    expect(w(90, 'Press', fixed(5))).toEqual([]);
    expect(w(95, 'Press', fixed(5))).toEqual([[55, 5]]);
    expect(w(150, 'Press', fixed(5))).toEqual([[90, 5]]);
    expect(w(155, 'Bench Press', fixed(5))).toEqual([[95, 5], [125, 3]]);
    expect(w(215, 'Bench Press', range(6, 8))).toEqual([[130, 6], [170, 3]]);
    expect(w(225, 'Squat', fixed(5))).toEqual([[90, 5], [135, 5], [180, 3]]);
    expect(w(405, 'Deadlift', fixed(5))).toEqual([[160, 5], [245, 5], [325, 3], [365, 2]]);
  });

  it('low reps add a rung; reps taper and never exceed the target', () => {
    expect(w(185, 'Squat', fixed(3))).toEqual([[75, 3], [110, 3], [150, 3]]);
    expect(w(405, 'Deadlift', fixed(1))).toEqual([[160, 1], [245, 1], [325, 1], [365, 1]]);
    expect(w(230, 'Squat', fixed(10))).toEqual([[90, 8], [140, 8], [185, 3]]);
  });

  it('dumbbell / cable work gets a short ramp, isolation none', () => {
    expect(w(25, 'DB Press', range(8, 10))).toEqual([]);
    expect(w(40, 'Cable chop', fixed(10))).toEqual([[25, 8]]);
    expect(w(100, 'DB Row', fixed(10))).toEqual([[60, 8], [80, 3]]);
    expect(w(120, 'Leg Press', fixed(10), 10)).toEqual([[70, 8], [100, 3]]);
    expect(w(200, 'Pallof Press', fixed(10))).toEqual([]);
  });

  it('rounds to the increment and drops rungs that collapse or sit on the working load', () => {
    expect(w(100, 'Press', fixed(5))).toEqual([[60, 5]]);
    expect(w(112.5, 'Press', fixed(5), 2.5)).toEqual([[67.5, 5]]);
    expect(w(35, 'DB Bench', fixed(8))).toEqual([[20, 8]]);
    // 60% and 80% of 160 with a 50-lb increment both round to 100/150: the second is within one increment of W and is dropped
    expect(w(160, 'Press', fixed(5), 50)).toEqual([[100, 5]]);
    expect(w(160, 'Press', fixed(5), 0)).toEqual([[95, 5], [130, 3]]); // a bad increment falls back to 5
  });

  it('bodyweight: one set at bodyweight, plus a light added-weight set once there is real added weight', () => {
    expect(w(0, 'Chin', range(6, 10), 5, true)).toEqual([[0, 5]]);
    expect(w(10, 'Chin', range(6, 10), 5, true)).toEqual([[0, 5]]);
    expect(w(45, 'Chin', range(6, 10), 5, true)).toEqual([[0, 5], [25, 3]]);
    expect(w(0, 'Dip', fixed(3), 5, true)).toEqual([[0, 3]]);
  });

  it('nothing without a working load', () => {
    expect(w(0, 'Squat', fixed(5))).toEqual([]);
  });
});
