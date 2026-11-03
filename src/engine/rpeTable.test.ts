import { describe, expect, it } from 'vitest';
import { cutoff, isOutsideWorkingRange, isValidRpe, pct, rpeValues } from './rpeTable';

/** Published Tuchscherer/RTS chart: rows = RPE, columns = reps 1..12, values = %1RM. */
const GRID: Record<string, number[]> = {
  '10':  [100.0, 95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0],
  '9.5': [97.8, 93.9, 90.7, 87.8, 85.0, 82.4, 79.9, 77.4, 75.1, 72.3, 69.4, 66.7],
  '9':   [95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3],
  '8.5': [93.9, 90.7, 87.8, 85.0, 82.4, 79.9, 77.4, 75.1, 72.3, 69.4, 66.7, 64.0],
  '8':   [92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3, 62.6],
  '7.5': [90.7, 87.8, 85.0, 82.4, 79.9, 77.4, 75.1, 72.3, 69.4, 66.7, 64.0, 61.3],
  '7':   [89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3, 62.6, 59.9],
  '6.5': [87.8, 85.0, 82.4, 79.9, 77.4, 75.1, 72.3, 69.4, 66.7, 64.0, 61.3, 58.6],
};

describe('pct', () => {
  it('returns the spec values at whole and half effective reps', () => {
    expect(pct(1)).toBeCloseTo(1.0, 10);
    expect(pct(1.5)).toBeCloseTo(0.978, 10);
    expect(pct(7)).toBeCloseTo(0.811, 10);
    expect(pct(8)).toBeCloseTo(0.786, 10);
    expect(pct(12)).toBeCloseTo(0.68, 10);
    expect(pct(15.5)).toBeCloseTo(0.586, 10);
  });

  it('is undefined off the chart or between half steps', () => {
    expect(pct(0.5)).toBeUndefined();
    expect(pct(0)).toBeUndefined();
    expect(pct(16)).toBeUndefined();
    expect(pct(7.25)).toBeUndefined();
  });

  it('matches every cell of the published 12-rep × RPE 6.5–10 grid via reps + (10 − RPE)', () => {
    for (const [rpeStr, row] of Object.entries(GRID)) {
      const rpe = Number(rpeStr);
      row.forEach((percent, i) => {
        const reps = i + 1;
        expect(pct(reps + (10 - rpe)), `reps ${reps} @ ${rpe}`).toBeCloseTo(percent / 100, 10);
      });
    }
  });
});

describe('rpe helpers', () => {
  it('accepts 6.5–10 in half steps only', () => {
    expect(rpeValues()).toEqual([6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]);
    expect(isValidRpe(8)).toBe(true);
    expect(isValidRpe(8.5)).toBe(true);
    expect(isValidRpe(6)).toBe(false);
    expect(isValidRpe(10.5)).toBe(false);
    expect(isValidRpe(8.25)).toBe(false);
  });

  it('flags sets outside RPE 7–9', () => {
    expect(isOutsideWorkingRange(6.5)).toBe(true);
    expect(isOutsideWorkingRange(7)).toBe(false);
    expect(isOutsideWorkingRange(9)).toBe(false);
    expect(isOutsideWorkingRange(9.5)).toBe(true);
  });

  it('cutoff is goal + 1 capped at 10', () => {
    expect(cutoff(8)).toBe(9);
    expect(cutoff(7)).toBe(8);
    expect(cutoff(9)).toBe(10);
    expect(cutoff(9.5)).toBe(10);
    expect(cutoff(10)).toBe(10);
  });
});
