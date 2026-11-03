import Dexie, { type EntityTable } from 'dexie';
import type { Exercise, MetaRow, Program, Session, SetLog } from '../model/types';

export class WorkoutDB extends Dexie {
  exercises!: EntityTable<Exercise, 'id'>;
  programs!: EntityTable<Program, 'id'>;
  sessions!: EntityTable<Session, 'id'>;
  setLogs!: EntityTable<SetLog, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor(name = 'workout-tracker') {
    super(name);
    this.version(1).stores({
      exercises: 'id, name',
      programs: 'id, status',
      sessions: 'id, completed, startedAt, finishedAt',
      setLogs: 'id, sessionId, exerciseId, [sessionId+slotId+setNumber]',
      meta: 'key',
    });
  }
}

export const db = new WorkoutDB();
