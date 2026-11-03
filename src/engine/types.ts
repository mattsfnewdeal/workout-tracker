export type SlotParams =
  | { progression: 'single'; targetReps: number; targetRpe: number; increment: number }
  | { progression: 'double'; repMin: number; repMax: number; targetRpe: number; increment: number };

export type SingleParams = Extract<SlotParams, { progression: 'single' }>;
export type DoubleParams = Extract<SlotParams, { progression: 'double' }>;

export interface LoggedSet {
  setNumber: number;
  load: number;
  reps: number;
  rpe: number | null;
}

export type RepTarget =
  | { kind: 'fixed'; reps: number }
  | { kind: 'range'; min: number; max: number; /** last time's set-1 reps to beat, on hold branches */ beat: number | null };

export type SuggestionReason =
  | 'first-session'
  | 'double-progress'
  | 'double-hold-add-reps'
  | 'double-rpe-high'
  | 'double-below-min'
  | 'single-progress'
  | 'single-hold-rpe-high'
  | 'single-hold-missed-reps'
  | 'fallback-add-increment'
  | 'fallback-hold';

export interface Suggestion {
  /** null on the first session: there is no history, the lifter picks the load. */
  load: number | null;
  repTarget: RepTarget;
  targetRpe: number;
  confidence: 'normal' | 'low';
  /** Rounded load is more than 10% above the last logged set-1 load. */
  bigJump: boolean;
  reason: SuggestionReason;
  /** e1RM from the last set 1, or null when none could be computed. */
  e1rm: number | null;
  /** The logged set 1 the suggestion was built from. */
  basis: LoggedSet | null;
}
