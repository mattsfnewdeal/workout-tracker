import { suggestBodyweight } from './bodyweight';
import { findSet1, firstSession } from './common';
import { suggestDouble } from './double';
import { suggestSingle } from './single';
import type { LoggedSet, SlotParams, Suggestion, SuggestionReason } from './types';

/**
 * Next-session suggestion for a slot, given the sets logged for its exercise
 * in that exercise's most recent completed session (any day, any program).
 */
export function suggest(p: SlotParams, last: LoggedSet[] | null | undefined): Suggestion {
  if (!last || last.length === 0 || !findSet1(last)) return firstSession(p);
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
  }
}
