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
  /** Used until the exercise has a completed session. */
  startingLoad: number;
}

export interface Day {
  id: string;
  name: string;
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
  plan: PlannedSlot[];
}

export interface SetLog {
  id: string;
  sessionId: string;
  slotId: string;
  exerciseId: string;
  setNumber: number;
  load: number;
  reps?: number;
  rpe?: number;
  suggestedLoad: number;
}

export interface MetaRow {
  key: 'lastBackupAt';
  value: number;
}
