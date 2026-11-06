import { describe, expect, it } from 'vitest';
import { classifySet } from './classify';
import type { RepTarget } from './types';

const fixed5: RepTarget = { kind: 'fixed', reps: 5 };
const range: RepTarget = { kind: 'range', min: 6, max: 8, beat: null };

describe('classifySet', () => {
  it('is pending until reps are logged', () => {
    expect(classifySet(fixed5, 8, undefined, 8)).toBe('pending');
  });
  it('good when reps hit and RPE within a point of the goal', () => {
    for (const rpe of [7, 7.5, 8, 8.5, 9]) expect(classifySet(fixed5, 8, 5, rpe)).toBe('good');
    expect(classifySet(fixed5, 8, 7, 8)).toBe('good'); // beat the target
    expect(classifySet(range, 8, 6, 8)).toBe('good');
    expect(classifySet(range, 8, 9, 8)).toBe('good'); // past the top of the range is still a hit
  });
  it('good on reps alone when no RPE was logged', () => {
    expect(classifySet(fixed5, 8, 5, undefined)).toBe('good');
    expect(classifySet(fixed5, 8, 4, undefined)).toBe('hard');
  });
  it('hard when reps fall short or RPE overshoots', () => {
    expect(classifySet(fixed5, 8, 4, 8)).toBe('hard');
    expect(classifySet(range, 8, 5, 7)).toBe('hard');
    expect(classifySet(fixed5, 8, 5, 9.5)).toBe('hard');
    expect(classifySet(fixed5, 8, 5, 10)).toBe('hard');
  });
  it('easy when reps hit but RPE is more than a point under the goal', () => {
    expect(classifySet(fixed5, 8, 5, 6.5)).toBe('easy');
    expect(classifySet(fixed5, 9, 5, 7.5)).toBe('easy');
    expect(classifySet(fixed5, 7, 5, 6.5)).toBe('good'); // goal 7: 6.5 is within a point
  });
  it('follows the slot goal, not a fixed band', () => {
    expect(classifySet(fixed5, 9, 5, 10)).toBe('good');
    expect(classifySet(fixed5, 6.5, 5, 8)).toBe('hard');
  });
});

describe('"<6"', () => {
  it('is easy against any goal, including 6', () => {
    const fixed = { kind: 'fixed' as const, reps: 5 };
    expect(classifySet(fixed, 6, 5, 5)).toBe('easy');
    expect(classifySet(fixed, 8, 5, 5)).toBe('easy');
    expect(classifySet(fixed, 6, 5, 6)).toBe('good');
    expect(classifySet(fixed, null, 5, 5)).toBe('good'); // no goal: reps alone
  });
});
