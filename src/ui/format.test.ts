import { describe, expect, it } from 'vitest';
import type { Suggestion } from '../engine';
import { fmtLoad, fmtRepTarget, fmtSuggestion } from './format';

const base = (over: Partial<Suggestion>): Suggestion => ({
  load: null, repTarget: { kind: 'fixed', reps: 5 }, targetRpe: 8, confidence: 'normal', bigJump: false, reason: 'first-session', e1rm: null, basis: null, ...over,
});

describe('fmtSuggestion', () => {
  it('first session shows the rep target only, never a load', () => {
    expect(fmtSuggestion(base({}))).toBe('5 reps @ 8');
    expect(fmtSuggestion(base({ repTarget: { kind: 'range', min: 6, max: 8, beat: null } }))).toBe('6–8 reps @ 8');
  });
  it('with a load shows load × reps @ rpe', () => {
    expect(fmtSuggestion(base({ load: 215, repTarget: { kind: 'range', min: 6, max: 8, beat: 7 }, reason: 'double-hold-add-reps' }))).toBe('215 × 6–8 @ 8');
    expect(fmtSuggestion(base({ load: 232.5, reason: 'single-progress', targetRpe: 7 }))).toBe('232.5 × 5 @ 7');
  });
});

describe('fmtLoad / fmtRepTarget', () => {
  it('formats loads without float noise', () => {
    expect(fmtLoad(225)).toBe('225');
    expect(fmtLoad(212.5)).toBe('212.5');
    expect(fmtLoad(227.25)).toBe('227.25');
  });
  it('uses an en dash for ranges', () => {
    expect(fmtRepTarget({ kind: 'range', min: 8, max: 12, beat: null })).toBe('8–12');
    expect(fmtRepTarget({ kind: 'fixed', reps: 3 })).toBe('3');
  });
});
