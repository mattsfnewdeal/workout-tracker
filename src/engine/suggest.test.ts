import { describe, expect, it } from 'vitest';
import { reasonText, suggest } from './suggest';
import type { LoggedSet, SlotParams, SuggestionReason } from './types';

const single: SlotParams = { progression: 'single', targetReps: 5, targetRpe: 8, increment: 5 };
const double: SlotParams = { progression: 'double', repMin: 6, repMax: 8, targetRpe: 8, increment: 5 };
const set = (load: number, reps: number, rpe: number | null, setNumber = 1): LoggedSet => ({ setNumber, load, reps, rpe });

const ALL_REASONS: SuggestionReason[] = [
  'first-session', 'double-progress', 'double-hold-add-reps', 'double-rpe-high', 'double-below-min',
  'single-progress', 'single-hold-rpe-high', 'single-hold-missed-reps', 'fallback-add-increment', 'fallback-hold',
];

describe('suggest', () => {
  it('first session has no load: the lifter picks it', () => {
    for (const p of [single, double]) {
      for (const last of [null, undefined, []]) {
        const s = suggest(p, last);
        expect(s.load).toBeNull();
        expect(s.reason).toBe('first-session');
        expect(s.confidence).toBe('normal');
        expect(s.basis).toBeNull();
      }
    }
    expect(suggest(double, null)).toMatchObject({ load: null, bigJump: false, e1rm: null, basis: null, repTarget: { kind: 'range', min: 6, max: 8, beat: null } });
  });

  it('treats a log with no set 1 as a first session', () => {
    const s = suggest(single, [set(225, 5, 8, 2)]);
    expect(s.reason).toBe('first-session');
    expect(s.load).toBeNull();
  });

  it('load is null for the first session and only then', () => {
    const cases: [SlotParams, LoggedSet[] | null][] = [
      [single, null],
      [single, [set(225, 5, 7), set(225, 5, null, 2), set(225, 5, null, 3)]],
      [single, [set(225, 5, 9.5), set(225, 5, null, 2), set(225, 5, null, 3)]],
      [single, [set(225, 5, 7), set(225, 5, null, 2), set(225, 4, null, 3)]],
      [double, [set(185, 9, 7)]],
      [double, [set(185, 7, 8)]],
      [double, [set(185, 7, 9.5)]],
      [double, [set(185, 5, 8)]],
      [single, [set(100, 13, 8), set(100, 13, 8, 2), set(100, 13, 8, 3)]],
      [double, [set(100, 7, null)]],
    ];
    const seen = new Set<SuggestionReason>();
    for (const [p, last] of cases) {
      const s = suggest(p, last);
      seen.add(s.reason);
      expect(s.load == null, s.reason).toBe(s.reason === 'first-session');
    }
    expect([...seen].sort()).toEqual([...ALL_REASONS].sort());
  });

  it('routes by progression type', () => {
    expect(suggest(single, [set(225, 5, 7), set(225, 5, null, 2), set(225, 5, null, 3)]).load).toBe(230);
    expect(suggest(double, [set(185, 9, 7)]).load).toBe(215);
  });

  it('has a label for every reason', () => {
    for (const r of ALL_REASONS) expect(reasonText(r).length).toBeGreaterThan(0);
  });
});
