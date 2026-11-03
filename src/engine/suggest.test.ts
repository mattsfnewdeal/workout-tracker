import { describe, expect, it } from 'vitest';
import { reasonText, suggest } from './suggest';
import type { LoggedSet, SlotParams, SuggestionReason } from './types';

const single: SlotParams = { progression: 'single', targetReps: 5, targetRpe: 8, startingLoad: 135, increment: 5 };
const double: SlotParams = { progression: 'double', repMin: 6, repMax: 8, targetRpe: 8, startingLoad: 95, increment: 5 };
const set = (load: number, reps: number, rpe: number | null, setNumber = 1): LoggedSet => ({ setNumber, load, reps, rpe });

describe('suggest', () => {
  it('first session uses the starting load with normal confidence', () => {
    for (const p of [single, double]) {
      for (const last of [null, undefined, []]) {
        const s = suggest(p, last);
        expect(s.load).toBe(p.startingLoad);
        expect(s.reason).toBe('first-session');
        expect(s.confidence).toBe('normal');
        expect(s.basis).toBeNull();
      }
    }
  });

  it('treats a log with no set 1 as a first session', () => {
    expect(suggest(single, [set(225, 5, 8, 2)]).reason).toBe('first-session');
  });

  it('routes by progression type', () => {
    expect(suggest(single, [set(225, 5, 7), set(225, 5, null, 2), set(225, 5, null, 3)]).load).toBe(230);
    expect(suggest(double, [set(185, 9, 7)]).load).toBe(215);
  });

  it('has a label for every reason', () => {
    const reasons: SuggestionReason[] = [
      'first-session', 'double-progress', 'double-hold-add-reps', 'double-rpe-high', 'double-below-min',
      'single-progress', 'single-hold-rpe-high', 'single-hold-missed-reps', 'fallback-add-increment', 'fallback-hold',
    ];
    for (const r of reasons) expect(reasonText(r).length).toBeGreaterThan(0);
  });
});
