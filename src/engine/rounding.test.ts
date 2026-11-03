import { describe, expect, it } from 'vitest';
import { isBigJump, nextIncrementAbove, roundProgress, roundToIncrement } from './rounding';

describe('roundToIncrement', () => {
  it('rounds the spec examples to the nearest 5', () => {
    expect(roundToIncrement(213.84, 5)).toBe(215);
    expect(roundToIncrement(232.16, 5)).toBe(230);
    expect(roundToIncrement(227.25, 5)).toBe(225);
    expect(roundToIncrement(246.9, 5)).toBe(245);
    expect(roundToIncrement(257.9, 5)).toBe(260);
  });
  it('handles 2.5 lb microplates without float noise', () => {
    expect(roundToIncrement(212.4, 2.5)).toBe(212.5);
    expect(roundToIncrement(0.1 + 0.2, 0.1)).toBe(0.3);
  });
});

describe('nextIncrementAbove', () => {
  it('is strictly above prev, even when prev is off-grid', () => {
    expect(nextIncrementAbove(225, 5)).toBe(230);
    expect(nextIncrementAbove(227, 5)).toBe(230);
    expect(nextIncrementAbove(230, 5)).toBe(235);
    expect(nextIncrementAbove(229.999, 5)).toBe(230);
  });
});

describe('roundProgress', () => {
  it('bumps when rounding would erase the jump', () => {
    expect(roundProgress(227.25, 225, 5)).toBe(230);
    expect(roundProgress(226, 225, 5)).toBe(230);
  });
  it('keeps the rounded value when it is already above prev', () => {
    expect(roundProgress(235.76, 225, 5)).toBe(235);
    expect(roundProgress(232.16, 225, 5)).toBe(230);
  });
});

describe('isBigJump', () => {
  it('flags only jumps over 10%, on the rounded load', () => {
    expect(isBigJump(260, 235)).toBe(true); // +10.6%
    expect(isBigJump(245, 225)).toBe(false); // +8.9%
    expect(isBigJump(220, 200)).toBe(false); // exactly 10%
    expect(isBigJump(225, 0)).toBe(false);
  });
});
