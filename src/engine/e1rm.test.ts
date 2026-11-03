import { describe, expect, it } from 'vitest';
import { e1rm, effectiveReps, loadFor } from './e1rm';

describe('e1rm', () => {
  it('effective reps = reps + (10 − RPE)', () => {
    expect(effectiveReps(9, 7)).toBe(12);
    expect(effectiveReps(5, 6.5)).toBe(8.5);
  });

  it('reproduces the spec examples', () => {
    expect(e1rm(185, 9, 7)).toBeCloseTo(272.1, 1);
    expect(e1rm(225, 5, 6.5)).toBeCloseTo(290.7, 1);
    expect(e1rm(225, 5, 7)).toBeCloseTo(286.3, 1);
    expect(e1rm(225, 5, 8)).toBeCloseTo(277.4, 1);
    expect(e1rm(225, 7, 7)).toBeCloseTo(304.5, 1);
    expect(e1rm(235, 7, 7)).toBeCloseTo(318.0, 1);
  });

  it('refuses sets over 12 reps or with a bad RPE', () => {
    expect(e1rm(100, 13, 8)).toBeNull();
    expect(e1rm(100, 0, 8)).toBeNull();
    expect(e1rm(100, 5, 6)).toBeNull();
    expect(e1rm(100, 5, 8.25)).toBeNull();
    expect(e1rm(0, 5, 8)).toBeNull();
  });
});

describe('loadFor', () => {
  it('reproduces the spec examples', () => {
    expect(loadFor(272.06, 6, 8)).toBeCloseTo(213.8, 1);
    expect(loadFor(290.7, 5, 8)).toBeCloseTo(235.8, 1);
    expect(loadFor(318.0, 5, 8)).toBeCloseTo(257.9, 1);
  });

  it('is null when the target lands off the chart', () => {
    expect(loadFor(300, 14, 8)).toBeNull(); // 16 effective reps
    expect(loadFor(300, 13, 8)).not.toBeNull(); // 15
    expect(loadFor(300, 12, 6.5)).not.toBeNull(); // 15.5
  });
});
