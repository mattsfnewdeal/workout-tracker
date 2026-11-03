import type { SetLog } from '../model/types';

/**
 * Which rows should follow a change to set 1's load. `basis` is the load the
 * linked later sets currently share — the prefilled suggestion, or whatever
 * set 1 last pushed to them (nothing at all on a fresh first session) — so the
 * link survives set 1 being cleared and retyped. A row the lifter edited to
 * something else never matches and is left alone. Only set 1 propagates.
 */
export function copyDownTargets(rows: SetLog[], changed: SetLog, basis: number | null, next: number | undefined): string[] {
  if (changed.setNumber !== 1 || next == null) return [];
  return rows.filter((o) => o.id !== changed.id && (o.load ?? null) === basis).map((o) => o.id);
}
