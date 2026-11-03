import { describe, expect, it } from 'vitest';
import type { SetLog } from '../model/types';
import { copyDownTargets } from './copyDown';

const row = (n: number, load?: number): SetLog => ({ id: `r${n}`, sessionId: 's', slotId: 'slot', exerciseId: 'e', setNumber: n, ...(load == null ? {} : { load }) });

/** Mirror the log screen: apply one set-1 keystroke/edit and return the new rows and basis. */
function type(rows: SetLog[], basis: number | null, v: number | undefined) {
  const set1 = rows.find((r) => r.setNumber === 1)!;
  const targets = new Set(copyDownTargets(rows, set1, basis, v));
  const next = rows.map((r) => (r.id === set1.id || targets.has(r.id) ? { ...r, load: v } : r));
  return { rows: next, basis: v == null ? basis : v };
}
const loads = (s: { rows: SetLog[] }) => s.rows.map((r) => r.load);

describe('copyDownTargets', () => {
  it('first session: typing set 1 digit by digit fills the empty sets', () => {
    let s = { rows: [row(1), row(2), row(3)], basis: null as number | null };
    for (const v of [2, 22, 225]) s = type(s.rows, s.basis, v);
    expect(loads(s)).toEqual([225, 225, 225]);
  });

  it('clearing set 1 leaves the others; retyping it fills them again (no stray partial loads)', () => {
    let s = { rows: [row(1), row(2), row(3)], basis: null as number | null };
    for (const v of [2, 22, 225, 22, 2, undefined]) s = type(s.rows, s.basis, v);
    expect(loads(s)).toEqual([undefined, 2, 2]);
    for (const v of [1, 18, 185]) s = type(s.rows, s.basis, v);
    expect(loads(s)).toEqual([185, 185, 185]);
  });

  it('a later set the lifter edited is left alone', () => {
    let s = { rows: [row(1), row(2), row(3, 235)], basis: null as number | null };
    s = type(s.rows, s.basis, 230);
    expect(loads(s)).toEqual([230, 230, 235]);
  });

  it('second session: prefilled sets follow set 1', () => {
    let s = { rows: [row(1, 230), row(2, 230), row(3, 230)], basis: 230 as number | null };
    s = type(s.rows, s.basis, 235);
    expect(loads(s)).toEqual([235, 235, 235]);
  });

  it('only set 1 propagates, and clearing propagates nothing', () => {
    const rows = [row(1), row(2), row(3)];
    expect(copyDownTargets(rows, rows[1], null, 185)).toEqual([]);
    expect(copyDownTargets(rows, rows[0], null, undefined)).toEqual([]);
  });
});
