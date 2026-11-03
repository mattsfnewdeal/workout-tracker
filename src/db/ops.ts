import { DEFAULT_TARGET_RPE } from '../engine';
import type { Day, Exercise, PlannedSlot, Program, Session, SetLog, Slot } from '../model/types';
import { db, type WorkoutDB } from './db';
import { getInProgressSession } from './queries';

export const DEFAULT_INCREMENT = 5;

export function newId(): string {
  return crypto.randomUUID();
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Reuse an existing exercise by case-insensitive name so history continues; otherwise create it. */
export async function findOrCreateExercise(
  name: string,
  loadIncrement = DEFAULT_INCREMENT,
  d: WorkoutDB = db,
): Promise<Exercise> {
  const norm = normalizeName(name);
  if (!norm) throw new Error('Exercise name is required');
  const lower = norm.toLowerCase();
  const existing = (await d.exercises.toArray()).find((e) => e.name.toLowerCase() === lower);
  if (existing) return existing;
  const ex: Exercise = { id: newId(), name: norm, loadIncrement, createdAt: Date.now() };
  await d.exercises.add(ex);
  return ex;
}

export async function updateExercise(id: string, patch: Partial<Pick<Exercise, 'name' | 'loadIncrement'>>, d: WorkoutDB = db) {
  const clean: typeof patch = { ...patch };
  if (clean.name != null) clean.name = normalizeName(clean.name);
  await d.exercises.update(id, clean);
}

export function newDay(name: string): Day {
  return { id: newId(), name, slots: [] };
}

export function newSlot(exerciseId: string, partial: Partial<Slot> = {}): Slot {
  return {
    id: newId(),
    exerciseId,
    sets: 3,
    progression: 'single',
    targetReps: 5,
    targetRpe: DEFAULT_TARGET_RPE,
    ...partial,
  };
}

export function emptyProgram(name = 'My program'): Program {
  return {
    id: newId(),
    name,
    days: [newDay('Day A'), newDay('Day B')],
    nextDayIndex: 0,
    status: 'active',
    createdAt: Date.now(),
  };
}

/** Throws with a human-readable message when a program isn't valid to save. */
export function validateProgram(p: Program): void {
  if (!normalizeName(p.name)) throw new Error('Program needs a name');
  if (p.days.length === 0) throw new Error('Program needs at least one day');
  for (const day of p.days) {
    const seen = new Set<string>();
    for (const slot of day.slots) {
      if (seen.has(slot.exerciseId)) throw new Error(`${day.name}: the same exercise can't appear twice in one day`);
      seen.add(slot.exerciseId);
      if (!Number.isInteger(slot.sets) || slot.sets < 1) throw new Error(`${day.name}: sets must be at least 1`);
      if (slot.progression === 'single') {
        if (!Number.isInteger(slot.targetReps) || (slot.targetReps ?? 0) < 1) throw new Error(`${day.name}: target reps must be at least 1`);
      } else {
        const { repMin, repMax } = slot;
        if (!Number.isInteger(repMin) || !Number.isInteger(repMax) || (repMin ?? 0) < 1 || (repMax ?? 0) <= (repMin ?? 0)) {
          throw new Error(`${day.name}: rep range must be like 6–8`);
        }
      }
    }
  }
}

/** Save edits to a program. Clamps the day pointer if days were removed. */
export async function saveProgram(program: Program, d: WorkoutDB = db): Promise<void> {
  validateProgram(program);
  const next = program.days.length ? program.nextDayIndex % program.days.length : 0;
  await d.programs.put({ ...program, name: normalizeName(program.name), nextDayIndex: next });
}

/** Make `program` the active one, archiving whatever was active. Blocked while a session is in progress. */
export async function createProgram(program: Program, d: WorkoutDB = db): Promise<void> {
  validateProgram(program);
  await d.transaction('rw', d.programs, d.sessions, async () => {
    if (await getInProgressSession(d)) throw new Error('Finish or abandon the current session before starting a new program');
    const now = Date.now();
    const active = await d.programs.where('status').equals('active').toArray();
    for (const p of active) {
      if (p.id !== program.id) await d.programs.update(p.id, { status: 'archived', archivedAt: now });
    }
    await d.programs.put({ ...program, name: normalizeName(program.name), status: 'active', archivedAt: undefined });
  });
}

/** Create the session and pre-create every set row, prefilled with the suggested load when there is one. */
export async function startSession(program: Program, dayIndex: number, plan: PlannedSlot[], d: WorkoutDB = db): Promise<Session> {
  const day = program.days[dayIndex];
  if (!day) throw new Error('No such day');
  const session: Session = {
    id: newId(),
    programId: program.id,
    dayId: day.id,
    dayIndex,
    dayName: day.name,
    startedAt: Date.now(),
    completed: 0,
    plan,
  };
  const logs: SetLog[] = [];
  for (const slot of plan) {
    for (let n = 1; n <= slot.sets; n++) {
      const row: SetLog = { id: newId(), sessionId: session.id, slotId: slot.slotId, exerciseId: slot.exerciseId, setNumber: n };
      if (slot.suggestion.load != null) {
        row.load = slot.suggestion.load;
        row.suggestedLoad = slot.suggestion.load;
      }
      logs.push(row);
    }
  }
  await d.transaction('rw', d.sessions, d.setLogs, async () => {
    if (await getInProgressSession(d)) throw new Error('A session is already in progress');
    await d.sessions.add(session);
    await d.setLogs.bulkAdd(logs);
  });
  return session;
}

export type SetLogPatch = Partial<Pick<SetLog, 'load' | 'reps' | 'rpe'>>;

export function updateSetLog(id: string, patch: SetLogPatch, d: WorkoutDB = db): Promise<number> {
  return d.setLogs.update(id, patch);
}

export interface FinishCheck {
  /** Blocking problems, e.g. a slot with 2 of 3 sets logged or set 1 without RPE. */
  problems: string[];
  /** Exercise names with no sets logged; allowed after confirmation. */
  skipped: string[];
}

/** A slot is either fully logged (every set has reps, set 1 has RPE) or entirely skipped. */
export function checkFinish(session: Session, logs: SetLog[]): FinishCheck {
  const problems: string[] = [];
  const skipped: string[] = [];
  for (const slot of session.plan) {
    const rows = logs.filter((l) => l.slotId === slot.slotId);
    const logged = rows.filter((l) => l.reps != null);
    if (logged.length === 0) {
      skipped.push(slot.exerciseName);
      continue;
    }
    if (logged.length < slot.sets) problems.push(`${slot.exerciseName}: ${logged.length} of ${slot.sets} sets logged`);
    const set1 = rows.find((l) => l.setNumber === 1);
    if (set1 && set1.reps != null && set1.rpe == null) problems.push(`${slot.exerciseName}: set 1 needs an RPE`);
    for (const l of logged) {
      if (l.load == null) problems.push(`${slot.exerciseName} set ${l.setNumber}: enter the load`);
      else if (!(l.load > 0)) problems.push(`${slot.exerciseName} set ${l.setNumber}: load must be above 0`);
      if (!Number.isInteger(l.reps) || (l.reps ?? 0) < 0) problems.push(`${slot.exerciseName} set ${l.setNumber}: reps must be a whole number`);
    }
  }
  return { problems, skipped };
}

/** Save the session, drop unlogged rows, advance the A/B pointer. */
export async function finishSession(sessionId: string, d: WorkoutDB = db): Promise<void> {
  await d.transaction('rw', d.sessions, d.setLogs, d.programs, async () => {
    const session = await d.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.completed) return;
    const logs = await d.setLogs.where('sessionId').equals(sessionId).toArray();
    const { problems } = checkFinish(session, logs);
    if (problems.length) throw new Error(problems.join('\n'));
    const unlogged = logs.filter((l) => l.reps == null).map((l) => l.id);
    if (unlogged.length) await d.setLogs.bulkDelete(unlogged);
    await d.sessions.update(sessionId, { completed: 1, finishedAt: Date.now() });
    const program = await d.programs.get(session.programId);
    if (program && program.days.length) {
      await d.programs.update(program.id, { nextDayIndex: (session.dayIndex + 1) % program.days.length });
    }
  });
}

/** Delete the session and its rows. The pointer doesn't move. */
export async function abandonSession(sessionId: string, d: WorkoutDB = db): Promise<void> {
  await d.transaction('rw', d.sessions, d.setLogs, async () => {
    await d.setLogs.where('sessionId').equals(sessionId).delete();
    await d.sessions.delete(sessionId);
  });
}

export async function resetAll(d: WorkoutDB = db): Promise<void> {
  await d.transaction('rw', d.exercises, d.programs, d.sessions, d.setLogs, d.meta, async () => {
    await Promise.all([d.exercises.clear(), d.programs.clear(), d.sessions.clear(), d.setLogs.clear(), d.meta.clear()]);
  });
}
