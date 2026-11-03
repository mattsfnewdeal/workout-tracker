import { describe, expect, it } from 'vitest';
import { suggestSingle } from './single';
import type { LoggedSet, SingleParams } from './types';

const p: SingleParams = { progression: 'single', targetReps: 5, targetRpe: 8, startingLoad: 135, increment: 5 };
const set = (load: number, reps: number, rpe: number | null, setNumber = 1): LoggedSet => ({ setNumber, load, reps, rpe });
const triple = (load: number, rpe: number, r1 = 5, r2 = 5, r3 = 5) => [set(load, r1, rpe), set(load, r2, null, 2), set(load, r3, null, 3)];

describe('suggestSingle (3×5 @ goal 8, 5 lb, last 225×5)', () => {
  it.each([
    [6.5, 235, 290.7],
    [7, 230, 286.3],
    [8, 230, 277.4], // raw 225.0 → +1% floor 227.25 → rounds to 225 → bump → 230
  ])('5 @ %s → %s', (rpe, load, e1) => {
    const s = suggestSingle(p, triple(225, rpe));
    expect(s.load).toBe(load);
    expect(s.reason).toBe('single-progress');
    expect(s.e1rm).toBeCloseTo(e1, 1);
    expect(s.bigJump).toBe(false);
    expect(s.repTarget).toEqual({ kind: 'fixed', reps: 5 });
  });

  it('beating the target reps gives a bigger jump (7 @ 7 → 245)', () => {
    const s = suggestSingle(p, triple(225, 7, 7, 5, 5));
    expect(s.load).toBe(245);
    expect(s.e1rm).toBeCloseTo(304.5, 1);
    expect(s.bigJump).toBe(false); // +8.9%
  });

  it('set 1 above the cutoff → hold', () => {
    const s = suggestSingle(p, triple(225, 9.5));
    expect(s.load).toBe(225);
    expect(s.reason).toBe('single-hold-rpe-high');
  });

  it('a later set missing target → hold even though set 1 was clean', () => {
    const s = suggestSingle(p, triple(225, 7, 5, 5, 4));
    expect(s.load).toBe(225);
    expect(s.reason).toBe('single-hold-missed-reps');
  });

  it('logged load overrides the suggestion (over-performing example → 260, big jump)', () => {
    // App suggested 230; lifter loaded 235 and got 7, 6, 6 with set 1 @ 7
    const s = suggestSingle(p, triple(235, 7, 7, 6, 6));
    expect(s.load).toBe(260);
    expect(s.e1rm).toBeCloseTo(318.0, 1);
    expect(s.bigJump).toBe(true); // 260/235 = +10.6% on the rounded load
  });

  it('+1% floor applies even when e1RM says a small drop', () => {
    // 5 @ 9 (cutoff): e1 = 225/.837 = 268.8; 5@8 → 218.0 → floor 227.25 → 225 → bump → 230
    const s = suggestSingle(p, triple(225, 9));
    expect(s.load).toBe(230);
    expect(s.reason).toBe('single-progress');
  });

  it('bump respects an off-grid previous load', () => {
    const s = suggestSingle(p, triple(227, 8)); // raw ≈ 227 → floor 229.27 → rounds 230 > 227 → 230
    expect(s.load).toBe(230);
  });
});

describe('suggestSingle with a per-slot RPE goal', () => {
  it('goal 7: cutoff 8, so 5 @ 8 progresses and 5 @ 8.5 holds', () => {
    const g7 = { ...p, targetRpe: 7 };
    const progress = suggestSingle(g7, triple(225, 8));
    expect(progress.reason).toBe('single-progress');
    expect(progress.load).toBe(230); // 277.4 × pct(8) = 218 → floor → bump
    expect(progress.targetRpe).toBe(7);
    const hold = suggestSingle(g7, triple(225, 8.5));
    expect(hold.reason).toBe('single-hold-rpe-high');
    expect(hold.load).toBe(225);
  });

  it('goal 9: cutoff caps at 10, so 5 @ 10 still progresses', () => {
    const g9 = { ...p, targetRpe: 9 };
    const s = suggestSingle(g9, triple(225, 10));
    expect(s.reason).toBe('single-progress');
    expect(s.load).toBe(230); // e1 260.7 × pct(6) = 218.2 → floor → bump
  });

  it('goal 6.5 at RPE 6.5: suggestion lands 5 @ 6.5', () => {
    const g65 = { ...p, targetRpe: 6.5 };
    const s = suggestSingle(g65, triple(225, 6.5));
    // e1 = 290.7; 5 @ 6.5 → 8.5 eff → ×.774 = 225.0 → floor 227.25 → bump → 230
    expect(s.load).toBe(230);
  });
});

describe('suggestSingle fallback', () => {
  it('sets over 12 reps → low-confidence +1 increment when every set hits target', () => {
    const s = suggestSingle(p, [set(100, 13, 8), set(100, 13, 8, 2), set(100, 13, 8, 3)]);
    expect(s.load).toBe(105);
    expect(s.confidence).toBe('low');
    expect(s.reason).toBe('fallback-add-increment');
    expect(s.e1rm).toBeNull();
  });

  it('target reps past the chart → low-confidence hold when a set misses', () => {
    const p15 = { ...p, targetReps: 15 };
    const s = suggestSingle(p15, [set(100, 13, 7), set(100, 13, 7, 2), set(100, 13, 7, 3)]);
    expect(s.load).toBe(100);
    expect(s.confidence).toBe('low');
    expect(s.reason).toBe('fallback-hold');
  });

  it('valid e1RM but target off the chart → fallback', () => {
    const p14 = { ...p, targetReps: 14 };
    const s = suggestSingle(p14, [set(100, 12, 7), set(100, 12, 7, 2), set(100, 12, 7, 3)]);
    expect(s.confidence).toBe('low');
    expect(s.reason).toBe('fallback-hold');
    expect(s.load).toBe(100);
  });
});
