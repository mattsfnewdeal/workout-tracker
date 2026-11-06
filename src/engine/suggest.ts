import { suggestBodyweight } from './bodyweight';
import { findSet1, firstSession } from './common';
import { suggestLinear } from './linear';
import { suggestDouble } from './double';
import { suggestSingle } from './single';
import type { LoggedSet, SlotParams, Suggestion, SuggestionReason } from './types';

/**
 * Next-session suggestion for a slot, given the sets logged for its exercise
 * in that exercise's most recent completed session (any day, any program),
 * and for the linear rule the session before that (to spot two misses in a row).
 */
export function suggest(p: SlotParams, last: LoggedSet[] | null | undefined, previous?: LoggedSet[] | null): Suggestion {
  if (!last || last.length === 0 || !findSet1(last)) return firstSession(p);
  if (p.rule === 'linear') return suggestLinear(p, last, previous ?? null);
  if (p.bodyweight) return suggestBodyweight(p, last);
  return p.progression === 'single' ? suggestSingle(p, last) : suggestDouble(p, last);
}

export function reasonText(reason: SuggestionReason): string {
  switch (reason) {
    case 'first-session': return 'First session — log the weight you use';
    case 'double-progress': return 'Beat the top of the range — load up';
    case 'double-hold-add-reps': return 'Same load — beat last time’s reps';
    case 'double-rpe-high': return 'RPE too high — recalculated';
    case 'double-below-min': return 'Under the range — recalculated';
    case 'single-progress': return 'All sets clean — load up';
    case 'single-hold-rpe-high': return 'Set 1 RPE too high — hold';
    case 'single-hold-missed-reps': return 'Missed reps — hold until every set is clean';
    case 'fallback-add-increment': return 'No e1RM — add one increment';
    case 'fallback-hold': return 'No e1RM — hold';
    case 'linear-progress': return 'Every set hit the target — add one increment';
    case 'linear-hold-missed': return 'Missed reps — same load, get every set';
    case 'linear-hold-range': return 'Same load — get every set to the top of the range';
    case 'linear-deload': return 'Missed two sessions in a row — drop 10% and build back';
  }
}
