import { describe, expect, it } from 'vitest';
import { suggestDouble } from './double';
import type { DoubleParams, LoggedSet } from './types';

const p: DoubleParams = { progression: 'double', repMin: 6, repMax: 8, targetRpe: 8, startingLoad: 135, increment: 5 };
const set = (load: number, reps: number, rpe: number | null, setNumber = 1): LoggedSet => ({ setNumber, load, reps, rpe });

describe('suggestDouble (6–8 @ goal 8, 5 lb)', () => {
  it('past the top at RPE ≤ cutoff → progress to repMin @ goal (spec example: 185×9@7 → 215)', () => {
    const s = suggestDouble(p, [set(185, 9, 7)]);
    expect(s.load).toBe(215);
    expect(s.reason).toBe('double-progress');
    expect(s.e1rm).toBeCloseTo(272.1, 1);
    expect(s.confidence).toBe('normal');
    expect(s.repTarget).toEqual({ kind: 'range', min: 6, max: 8, beat: null });
    expect(s.bigJump).toBe(true); // 215/185 = +16%
  });

  it('within the range at RPE ≤ cutoff → hold and beat last set 1', () => {
    const s = suggestDouble(p, [set(185, 7, 8)]);
    expect(s.load).toBe(185);
    expect(s.reason).toBe('double-hold-add-reps');
    expect(s.repTarget).toEqual({ kind: 'range', min: 6, max: 8, beat: 7 });
    expect(s.bigJump).toBe(false);
  });

  it('RPE above cutoff → recalc so the reps done land at goal (small drop)', () => {
    const s = suggestDouble(p, [set(185, 7, 9.5)]);
    expect(s.load).toBe(175); // e1 231.5 → 7@8 → 176.4
    expect(s.reason).toBe('double-rpe-high');
  });

  it('RPE above cutoff and past the top → clamp to repMax @ goal', () => {
    const s = suggestDouble(p, [set(185, 9, 9.5)]);
    // e1 = 185/0.751 = 246.3; 8@8 = 10 eff → ×0.739 = 182.0 → 180
    expect(s.load).toBe(180);
    expect(s.reason).toBe('double-rpe-high');
  });

  it('below repMin → recalc so repMin lands at goal', () => {
    const s = suggestDouble(p, [set(185, 5, 8)]);
    expect(s.load).toBe(180); // e1 228.1 → 6@8 → 179.3
    expect(s.reason).toBe('double-below-min');
  });

  it('below repMin wins over a high RPE', () => {
    const s = suggestDouble(p, [set(185, 4, 10)]);
    expect(s.reason).toBe('double-below-min');
    expect(s.load).toBe(165); // e1 207.4 → 6@8 → 163.0
  });

  it('bumps one increment when rounding would erase a progression', () => {
    // e1 = 200/pct(12) = 294.1; 6@8 → 231.2 → 230 > 200 fine. Craft a near-flat case:
    // 100×9@7 → e1 147.06; 6@8 → 115.6 → 115 (> 100). Use repMin 9 so target eff = 11 → 70.7%:
    const near: DoubleParams = { ...p, repMin: 9, repMax: 11 };
    const s = suggestDouble(near, [set(100, 12, 7)]); // 15 eff → 59.9% → e1 166.9; 9@8 = 11 eff → 70.7% → 118.0 → 120
    expect(s.load).toBe(120);
    expect(s.reason).toBe('double-progress');
  });

  it('only set 1 drives the calculation; later sets are ignored', () => {
    const s = suggestDouble(p, [set(185, 9, 7), set(185, 6, 9.5, 2), set(185, 5, 10, 3)]);
    expect(s.load).toBe(215);
  });

  it('a shared exercise uses this slot’s range against the other day’s sets', () => {
    // Day A logged 225×5@7 ×3 as a 3×5; slot B is 6–8: 5 < 6 → below-min → 6@8 from e1 286.3 → 225.0
    const s = suggestDouble(p, [set(225, 5, 7), set(225, 5, 7, 2), set(225, 5, 7, 3)]);
    expect(s.load).toBe(225);
    expect(s.reason).toBe('double-below-min');
  });

  it('falls back with low confidence when set 1 has no e1RM', () => {
    const over = suggestDouble(p, [set(100, 14, 7)]);
    expect(over.load).toBe(105);
    expect(over.confidence).toBe('low');
    expect(over.reason).toBe('fallback-add-increment');
    const noRpe = suggestDouble(p, [set(100, 7, null)]);
    expect(noRpe.load).toBe(100);
    expect(noRpe.reason).toBe('fallback-hold');
    expect(noRpe.repTarget).toEqual({ kind: 'range', min: 6, max: 8, beat: 7 });
  });
});
