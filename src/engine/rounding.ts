export const BIG_JUMP_RATIO = 1.1;

function fix(n: number): number {
  return Number(n.toFixed(2));
}

/** Nearest multiple of `inc`. */
export function roundToIncrement(load: number, inc: number): number {
  if (!(inc > 0)) return fix(load);
  return fix(Math.round(load / inc) * inc);
}

/** Smallest multiple of `inc` strictly greater than `prev` (handles off-grid `prev`). */
export function nextIncrementAbove(prev: number, inc: number): number {
  if (!(inc > 0)) return fix(prev);
  return fix(Math.floor(prev / inc + 1e-9) * inc + inc);
}

/** Largest multiple of `inc` strictly less than `prev`, never below 0. */
export function nextIncrementBelow(prev: number, inc: number): number {
  if (!(inc > 0)) return fix(Math.max(0, prev));
  return fix(Math.max(0, Math.ceil(prev / inc - 1e-9) * inc - inc));
}

/**
 * Round a load that is supposed to be a progression. If rounding would erase
 * the jump, bump to the next increment above `prev` instead.
 */
export function roundProgress(raw: number, prev: number, inc: number): number {
  const r = roundToIncrement(raw, inc);
  return r > prev ? r : nextIncrementAbove(prev, inc);
}

/** True when the (rounded) next load is more than 10% above the previous one. */
export function isBigJump(next: number, prev: number): boolean {
  return prev > 0 && next / prev > BIG_JUMP_RATIO;
}
