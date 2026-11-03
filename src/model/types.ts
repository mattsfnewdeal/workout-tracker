import type { Suggestion } from '../engine/types';

export type Progression = 'single' | 'double';

export interface Exercise {
  id: string;
  name: string;
  /** Smallest load step for this exercise, in lb (e.g. 5 for a barbell, 2.5 with microplates). */
  loadIncrement: number;
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
  /** 6.5–10 in half steps. Default 8. */
  targetRpe: number;
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
}

/** Snapshot of one slot at the moment a session starts. */
export interface PlannedSlot {
  slotId: string;
  exerciseId: string;
  exerciseName: string;
  sets: number;
  increment: number;
  /** When the exercise was last logged (completed session), for the Today screen. */
  lastSessionAt?: number;
  suggestion: Suggestion;
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
