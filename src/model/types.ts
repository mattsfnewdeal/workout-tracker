import type { Suggestion } from '../engine/types';

export type Progression = 'single' | 'double';

/**
 * How the next load is chosen. 'rpe' (default): from set 1's e1RM at the RPE goal (the v1 rules).
 * 'linear': add one increment when every set hits its target (fixed reps, or the top of the range);
 * hold on a miss; after two missed sessions in a row drop 10%. RPE is recorded but doesn't drive the load.
 */
export type ProgressionRule = 'rpe' | 'linear';

export interface Exercise {
  id: string;
  name: string;
  /** Smallest load step for this exercise, in lb (e.g. 5 for a barbell, 2.5 with microplates). */
  loadIncrement: number;
  /** Chins, dips: the logged load is added weight and may be 0. Absent = false. */
  bodyweight?: boolean;
  createdAt: number;
}

export interface Slot {
  id: string;
  exerciseId: string;
  sets: number;
  progression: Progression;
  /** single progression */
  targetReps?: number;
  /** double progression */
  repMin?: number;
  repMax?: number;
  /** 6.5–10 in half steps. Required for the 'rpe' rule (it sets the load). Optional for 'linear': only colours sets and the picker. Absent = no goal. */
  targetRpe?: number;
  /** Absent = 'rpe'. */
  rule?: ProgressionRule;
  /** Sets to run during the program's intro weeks (see Program.introWeeks). Absent = same as `sets`. */
  introSets?: number;
  /** Superset with the slot above it (A1/A2). Ignored on the first slot of a day. */
  supersetWithPrev?: boolean;
}

/** A checkbox-only warm-up item: no load, reps or RPE; the note carries anything like "3 × 4 with 4–6 kg". */
export interface WarmupItem {
  id: string;
  name: string;
  note?: string;
}

export interface Day {
  id: string;
  name: string;
  /** Absent on programs built before v1.3. */
  warmups?: WarmupItem[];
  slots: Slot[];
}

export type ProgramStatus = 'active' | 'archived';

export interface Program {
  id: string;
  name: string;
  days: Day[];
  /** Index into `days` of the next day to run. Advances only when a session is finished. */
  nextDayIndex: number;
  status: ProgramStatus;
  createdAt: number;
  archivedAt?: number;
  /** Slots with `introSets` run that many sets instead of `sets` until the intro weeks end. */
  introWeeks?: number;
  /** When the intro weeks start counting (local midnight). Absent = createdAt. Sessions before it are "week 0" and also run the intro counts. */
  introStartsAt?: number;
}

/** The sets / reps / RPE goal / rule of a slot without its identity or its place on the day. What a swap or add asks for. */
export type SlotSpec = Omit<Slot, 'id' | 'exerciseId' | 'introSets' | 'supersetWithPrev'>;

/** Whether a mid-session change stays in this session or is written to the program's day as well. */
export type ChangeScope = 'session' | 'program';

/** Recorded on a planned slot that was swapped in or added during the session, so the log screen can say so. */
export interface SlotChange {
  kind: 'swap' | 'add';
  scope: ChangeScope;
  /** On a swap: the name of the exercise that was replaced. */
  replaced?: string;
}

/** A suggested warm-up set: load and reps only, ticked off when done. Never logged, never in History. */
export interface WarmupSet {
  load: number;
  reps: number;
  done: boolean;
}

/** Snapshot of one slot at the moment a session starts (or when it is swapped / added mid-session). */
export interface PlannedSlot {
  slotId: string;
  exerciseId: string;
  exerciseName: string;
  sets: number;
  increment: number;
  /** Snapshot of the exercise's flag: a load of 0 (or none typed) is bodyweight. */
  bodyweight?: boolean;
  /** Absent = 'rpe'. */
  rule?: ProgressionRule;
  /** The slot's RPE goal for display and colouring; absent on a linear slot without one. */
  targetRpe?: number;
  /** When `sets` is the intro count, the full count it will return to. */
  fullSets?: number;
  /** Second or later exercise of a superset: logged in rounds with the slot before it. */
  supersetWithPrev?: boolean;
  /** When the exercise was last logged (completed session), for the Today screen. */
  lastSessionAt?: number;
  suggestion: Suggestion;
  /** Suggested warm-up sets, computed from the suggested working load. Absent on a first session (no load yet) and on sessions from before v1.5. */
  warmupSets?: WarmupSet[];
  /** Absent on slots that came from the program as planned. */
  change?: SlotChange;
}

/** Snapshot of a warm-up item for one session, with its checkbox. */
export interface WarmupLog {
  id: string;
  name: string;
  note?: string;
  done: boolean;
}

export interface Session {
  id: string;
  programId: string;
  dayId: string;
  dayIndex: number;
  dayName: string;
  startedAt: number;
  finishedAt?: number;
  /** 0 | 1 rather than boolean: IndexedDB can't index booleans. */
  completed: 0 | 1;
  /** Absent on sessions started before v1.3. Warm-ups never block Finish. */
  warmups?: WarmupLog[];
  plan: PlannedSlot[];
}

export interface SetLog {
  id: string;
  sessionId: string;
  slotId: string;
  exerciseId: string;
  setNumber: number;
  /** Absent (key deleted, never null) on a first session until the lifter types it; readers compare with == null. */
  load?: number;
  reps?: number;
  rpe?: number;
  suggestedLoad?: number;
}

export interface MetaRow {
  key: 'lastBackupAt';
  value: number;
}
